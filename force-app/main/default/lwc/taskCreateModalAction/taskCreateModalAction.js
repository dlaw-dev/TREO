import LightningModal from 'lightning/modal';
import { api, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import { publish, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';

import saveTask from '@salesforce/apex/TaskUiController.saveTask';
import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';
import getTemplates from '@salesforce/apex/SubtaskTemplateUiController.getTemplates';
import getTemplateItems from '@salesforce/apex/SubtaskTemplateUiController.getTemplateItems';
import applyTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.applyTemplate';

import MATTER_NAME from '@salesforce/schema/NEOS_Matter__c.Name';
import TASK_OBJECT from '@salesforce/schema/Task';

import TASK_REMINDER_OBJECT from '@salesforce/schema/Task_Reminder__c';
import REMINDER_TYPE_FIELD from '@salesforce/schema/Task_Reminder__c.Reminder_Type__c';

const SEARCH_FOCUS_CLICK_WINDOW_MS = 200;
const SEARCH_BLUR_CLOSE_DELAY_MS = 150;
const DROPDOWN_VERTICAL_OFFSET_PX = 4;

const SUBJECT_SUGGESTIONS = [
    'Call Client',
    'Call Court',
    "Call Court's Clerk",
    'Call OC',
    'Draft Complaint',
    'Draft Discovery',
    'Draft Document',
    'Draft FAC',
    'Draft Informal Discovery',
    'Draft Mediation Brief',
    'Draft PAGA letter',
    'F/u with Client',
    'F/u with Mediator',
    'F/u with OC',
    'File Documents',
    'Prepare Case Comparison Chart',
    'Review Calendar',
    'Review File',
    'Other'
];

const REMINDER_DAY_OF_SORT_BASE = 100000;

// The uiObjectInfoApi picklist wire doesn't reliably preserve the picklist's
// defined order, so reminder options are re-sorted by parsing their label
// into a "days before due date" offset (furthest before sorts first).
function reminderSortKey(label) {
    if (!label) return 0;

    const dayOfMatch = label.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*Day Of$/i);
    if (dayOfMatch) {
        let hour = parseInt(dayOfMatch[1], 10);
        const minute = parseInt(dayOfMatch[2], 10);
        const isPM = /PM/i.test(dayOfMatch[3]);
        if (isPM && hour !== 12) hour += 12;
        if (!isPM && hour === 12) hour = 0;
        return REMINDER_DAY_OF_SORT_BASE + hour * 60 + minute;
    }

    const monthMatch = label.match(/^(\d+)\s*Months?\s*Before$/i);
    if (monthMatch) return -parseInt(monthMatch[1], 10) * 30;

    const weekMatch = label.match(/^(\d+)\s*Weeks?\s*Before$/i);
    if (weekMatch) return -parseInt(weekMatch[1], 10) * 7;

    const dayMatch = label.match(/^(\d+)\s*Days?\s*Before$/i);
    if (dayMatch) return -parseInt(dayMatch[1], 10);

    return 0;
}

const TEMPLATE_ICON_RULES = [
    { keywords: ['attorney', 'assignment'], icon: 'utility:user' },
    { keywords: ['complaint'], icon: 'utility:description' },
    { keywords: ['letter', 'lwda'], icon: 'utility:email' }
];
const DEFAULT_TEMPLATE_ICON = 'utility:routing_offline';

function iconForTemplateName(name) {
    const lower = (name || '').toLowerCase();
    const match = TEMPLATE_ICON_RULES.find(rule => rule.keywords.some(kw => lower.includes(kw)));
    return match ? match.icon : DEFAULT_TEMPLATE_ICON;
}

function blankTaskRow(id) {
    return {
        _id: id,
        subject: '',
        activityDate: undefined,
        status: 'Open',
        priority: 'Normal',
        description: '',
        selectedUsers: [],
        selectedUserIds: new Set(),
        selectedReminderTypes: [],
        isReminderSet: false,
        isMoreDetailsOpen: false
    };
}

export default class TaskCreateModalAction extends LightningModal {

    @api recordId;

    // Getter/setter pairs so values populate correctly whether the LWC modal
    // framework sets them before or after connectedCallback fires. draftTasks
    // is initialized synchronously as a class field, so patching row 0 here
    // is safe no matter when these setters run.
    _initialSubject;
    @api get initialSubject() { return this._initialSubject; }
    set initialSubject(val) { this._initialSubject = val; if (val != null) this._patchFirstRow({ subject: val }); }

    _initialDueDate;
    @api get initialDueDate() { return this._initialDueDate; }
    set initialDueDate(val) { this._initialDueDate = val; if (val != null) this._patchFirstRow({ activityDate: val }); }

    _initialPriority;
    @api get initialPriority() { return this._initialPriority; }
    set initialPriority(val) { this._initialPriority = val; if (val != null) this._patchFirstRow({ priority: val }); }

    _initialDescription;
    @api get initialDescription() { return this._initialDescription; }
    set initialDescription(val) { this._initialDescription = val; if (val != null) this._patchFirstRow({ description: val }); }

    _initialAssignees = [];
    @api get initialAssignees() { return this._initialAssignees; }
    set initialAssignees(val) {
        this._initialAssignees = val || [];
        const first = Array.isArray(this._initialAssignees) ? this._initialAssignees[0] : null;

        if (first?.id) {
            this._patchFirstRow({
                selectedUserIds: new Set([first.id]),
                selectedUsers: [{ id: first.id, name: first.name }]
            });
        }
    }

    _taskCounter = 1;
    @track draftTasks = [blankTaskRow('1')];

    isSaving = false;

    _activeSubjectRowId;
    subjectDropdownStyle = '';
    subjectBlurTimeout;
    subjectDropdownInteractionTimeout;
    _isInteractingWithSubjectDropdown = false;

    _activeAssigneeRowId;
    assigneeDropdownStyle = '';

    activeTab = 'newTask';

    selectedTemplateId;
    isApplyingTemplate = false;

    @wire(MessageContext) messageContext;

    _patchFirstRow(patch) {
        this.draftTasks = this.draftTasks.map((t, i) => (i === 0 ? { ...t, ...patch } : t));
    }

    /* -------------------------
       Related Record
    -------------------------- */

    @wire(getRecord, { recordId: '$recordId', fields: [MATTER_NAME] })
    wiredMatter(result) {
        this.matter = result;
    }

    get recordName() {
        return this.matter?.data?.fields?.Name?.value;
    }

    /* -------------------------
       Reminder Metadata
    -------------------------- */

    @wire(getObjectInfo, { objectApiName: TASK_REMINDER_OBJECT })
    reminderMetadata;

    get reminderRecordTypeId() {
        return this.reminderMetadata?.data?.defaultRecordTypeId || '012000000000000AAA';
    }

    @wire(getPicklistValues, {
        recordTypeId: '$reminderRecordTypeId',
        fieldApiName: REMINDER_TYPE_FIELD
    })
    reminderPicklist;

    get reminderOptions() {
        return this.reminderPicklist?.data?.values ?? [];
    }

    get sortedReminderOptions() {
        return [...this.reminderOptions].sort(
            (a, b) => reminderSortKey(a.value) - reminderSortKey(b.value)
        );
    }

    _reminderOptionRowsFor(selectedTypes) {
        return this.sortedReminderOptions.map(o => ({
            ...o,
            checked: selectedTypes.includes(o.value)
        }));
    }

    handleReminderOptionToggle(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.dataset.value;
        const checked = e.target.checked;

        this.draftTasks = this.draftTasks.map(t => {
            if (t._id !== rowId) return t;
            const types = checked
                ? [...t.selectedReminderTypes, value]
                : t.selectedReminderTypes.filter(v => v !== value);
            return { ...t, selectedReminderTypes: types };
        });
    }

    /* -------------------------
       Task Metadata
    -------------------------- */

    @wire(getObjectInfo, { objectApiName: TASK_OBJECT })
    taskMetadata;

    get taskRecordTypeId() {
        return this.taskMetadata?.data?.defaultRecordTypeId || '012000000000000AAA';
    }

    /* -------------------------
       Static Picklists
    -------------------------- */

    get priorityOptions() {
        return [
            { label: 'Normal', value: 'Normal' },
            { label: 'High', value: 'High' }
        ];
    }

    /* -------------------------
       Draft task rows (repeater)
    -------------------------- */

    _suggestionsFor(subjectValue) {
        const keyword = (subjectValue || '').trim().toLowerCase();
        if (!keyword) return SUBJECT_SUGGESTIONS;
        return SUBJECT_SUGGESTIONS.filter(s => s.toLowerCase().includes(keyword));
    }

    get displayTasks() {
        return this.draftTasks.map((t, index) => {
            const suggestions = this._suggestionsFor(t.subject);
            const isSubjectActive = this._activeSubjectRowId === t._id;
            const isAssigneeActive = this._activeAssigneeRowId === t._id;
            const reminderRows = this._reminderOptionRowsFor(t.selectedReminderTypes);

            return {
                ...t,
                displayIndex: index + 1,
                canRemove: this.draftTasks.length > 1,
                subjectContainerId: `subject-search-container-${t._id}`,
                assigneeContainerId: `assignee-search-container-${t._id}`,
                hasSelectedAssignee: t.selectedUsers.length > 0,
                isReminderDisabled: !t.activityDate,
                moreDetailsIcon: t.isMoreDetailsOpen ? 'utility:chevrondown' : 'utility:chevronright',
                filteredSubjectSuggestions: suggestions,
                hasSubjectSuggestions: isSubjectActive && suggestions.length > 0,
                subjectDropdownStyle: this.subjectDropdownStyle,
                hasUserResults: isAssigneeActive && this.userResults.length > 0,
                userResults: isAssigneeActive ? this.userResults : [],
                userSearchKeyword: isAssigneeActive ? this.userSearchKeyword : '',
                assigneeDropdownStyle: this.assigneeDropdownStyle,
                reminderOptionColumnLeft: reminderRows.slice(0, Math.ceil(reminderRows.length / 2)),
                reminderOptionColumnRight: reminderRows.slice(Math.ceil(reminderRows.length / 2))
            };
        });
    }

    get hasMultipleTasks() {
        return this.draftTasks.length > 1;
    }

    get isSaveDisabled() {
        return this.isSaving;
    }

    get saveLabel() {
        if (this.isSaving) return 'Saving…';
        const n = this.draftTasks.length;
        return n > 1 ? `Create ${n} Tasks` : 'Create Task';
    }

    addTaskRow() {
        this._taskCounter++;
        this.draftTasks = [...this.draftTasks, blankTaskRow(String(this._taskCounter))];
    }

    removeTaskRow(event) {
        const rowId = event.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.filter(t => t._id !== rowId);
        if (this.draftTasks.length === 0) {
            this.addTaskRow();
        }
    }

    toggleMoreDetails(event) {
        const rowId = event.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.map(t =>
            t._id === rowId ? { ...t, isMoreDetailsOpen: !t.isMoreDetailsOpen } : t
        );
    }

    /* -------------------------
       Tabs
    -------------------------- */

    get isNewTaskTab() {
        return this.activeTab === 'newTask';
    }

    get isUseTemplateTab() {
        return this.activeTab === 'useTemplate';
    }

    get newTaskTabClass() {
        return this.isNewTaskTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get useTemplateTabClass() {
        return this.isUseTemplateTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    handleTabClick(event) {
        this.activeTab = event.currentTarget.dataset.tab;
    }

    /* -------------------------
       Use Template
    -------------------------- */

    @wire(getTemplates)
    wiredTemplates;

    get isTemplatesLoading() {
        return !this.wiredTemplates?.data && !this.wiredTemplates?.error;
    }

    get templatesErrorMessage() {
        return this.wiredTemplates?.error?.body?.message
            || this.wiredTemplates?.error?.message
            || 'Something went wrong loading templates.';
    }

    get hasTemplatesError() {
        return !!this.wiredTemplates?.error;
    }

    get hasNoTemplates() {
        return !this.isTemplatesLoading && !this.hasTemplatesError && this.templateCards.length === 0;
    }

    get templateCards() {
        const templates = this.wiredTemplates?.data ?? [];
        return templates.map(t => ({
            id: t.id,
            name: t.name,
            icon: iconForTemplateName(t.name),
            stepLabel: `${t.stepCount} step${t.stepCount === 1 ? '' : 's'}`,
            pressed: t.id === this.selectedTemplateId,
            cardClass: t.id === this.selectedTemplateId
                ? 'template-card template-card-selected'
                : 'template-card'
        }));
    }

    @wire(getTemplateItems, { templateId: '$selectedTemplateId', matterId: '$recordId' })
    wiredTemplateItems;

    get templatePreviewSummary() {
        const items = this.wiredTemplateItems?.data ?? [];
        if (items.length === 0) return '';

        const people = new Set(
            items.map(i => (i.assigneeType === 'Static User' ? i.assigneeLabel : (i.resolvedName || i.assigneeLabel)))
        );

        const stepWord = items.length === 1 ? 'step' : 'steps';
        const peopleWord = people.size === 1 ? 'person' : 'people';
        return `${items.length} ${stepWord} · ${people.size} ${peopleWord} involved`;
    }

    get hasSelectedTemplate() {
        return !!this.selectedTemplateId;
    }

    get isTemplateItemsLoading() {
        return this.hasSelectedTemplate && !this.wiredTemplateItems?.data && !this.wiredTemplateItems?.error;
    }

    get hasTemplateItemsError() {
        return !!this.wiredTemplateItems?.error;
    }

    get templateItemsErrorMessage() {
        return this.wiredTemplateItems?.error?.body?.message
            || this.wiredTemplateItems?.error?.message
            || 'Something went wrong loading this template.';
    }

    get templateItemRows() {
        const items = this.wiredTemplateItems?.data ?? [];

        return items.map((item, index) => {
            const isFirst = index === 0;
            const previousSubject = isFirst ? null : items[index - 1].subject;

            return {
                id: item.id,
                displayIndex: index + 1,
                subject: item.subject,
                description: item.description,
                isLast: index === items.length - 1,
                timingLabel: isFirst ? 'Starts immediately' : `Waits for "${previousSubject}"`,
                timingPillClass: isFirst
                    ? 'timeline-pill timeline-pill-immediate'
                    : 'timeline-pill timeline-pill-waiting',
                assigneeText: item.assigneeType === 'Static User'
                    ? item.assigneeLabel
                    : item.resolvedName
                        ? `${item.resolvedName} (${item.assigneeLabel})`
                        : item.assigneeLabel,
                assigneePillClass: item.assigneeType === 'Static User'
                    ? 'timeline-pill timeline-pill-fixed'
                    : 'timeline-pill timeline-pill-auto'
            };
        });
    }

    get isApplyTemplateDisabled() {
        return !this.selectedTemplateId || this.isApplyingTemplate;
    }

    handleTemplateCardClick(event) {
        const id = event.currentTarget.dataset.id;
        this.selectedTemplateId = this.selectedTemplateId === id ? undefined : id;
    }

    async applyTemplate() {
        if (this.isApplyingTemplate) return;
        this.isApplyingTemplate = true;

        try {
            await applyTemplateApex({ templateId: this.selectedTemplateId, matterId: this.recordId });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Tasks created',
                variant: 'success'
            }));
            publish(this.messageContext, TASK_CHANGED, {});
            this.close('success');
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this.isApplyingTemplate = false;
        }
    }

    /* -------------------------
       Dropdown Positioning

       Search dropdowns render fixed-position so they escape
       lightning-modal-body's internal scroll clipping.
    -------------------------- */

    computeDropdownStyle(dataId) {
        const container = this.template.querySelector(`[data-id="${dataId}"]`);
        if (!container) return '';

        const rect = container.getBoundingClientRect();
        return `position:fixed; top:${rect.bottom + DROPDOWN_VERTICAL_OFFSET_PX}px; left:${rect.left}px; width:${rect.width}px;`;
    }

    /* -------------------------
       Subject Suggestions
    -------------------------- */

    openSubjectSearch(rowId) {
        clearTimeout(this.subjectBlurTimeout);
        this._activeSubjectRowId = rowId;
        this.subjectDropdownStyle = this.computeDropdownStyle(`subject-search-container-${rowId}`);
    }

    closeSubjectSearch() {
        this._activeSubjectRowId = undefined;
        clearTimeout(this.subjectBlurTimeout);
    }

    handleSubjectFocus(e) {
        this.openSubjectSearch(e.currentTarget.dataset.id);
    }

    handleSubjectBlur() {
        if (this._isInteractingWithSubjectDropdown) return;

        clearTimeout(this.subjectBlurTimeout);
        this.subjectBlurTimeout = setTimeout(() => {
            this.closeSubjectSearch();
        }, SEARCH_BLUR_CLOSE_DELAY_MS);
    }

    handleSubjectDropdownMouseDown() {
        this._isInteractingWithSubjectDropdown = true;
        clearTimeout(this.subjectDropdownInteractionTimeout);
        this.subjectDropdownInteractionTimeout = setTimeout(() => {
            this._isInteractingWithSubjectDropdown = false;
        }, 0);
    }

    selectSubjectSuggestion(e) {
        const rowId = this._activeSubjectRowId;
        const value = e.currentTarget.dataset.value;
        if (!rowId) return;

        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, subject: value } : t));
        this.closeSubjectSearch();

        // The input blurs (while still empty) just before this click handler
        // fills in the value, so lightning-input flags itself invalid on that
        // blur. Re-check validity once the new value has rendered so the
        // error clears without the user needing to click back into the field.
        Promise.resolve().then(() => {
            this.template.querySelector(`lightning-input[data-role="subject-input"][data-id="${rowId}"]`)?.reportValidity();
        });
    }

    /* -------------------------
       Field Handlers
    -------------------------- */

    handleSubject(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.value;
        this._activeSubjectRowId = rowId;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, subject: value } : t));
    }

    handleDueDate(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.value;

        this.draftTasks = this.draftTasks.map(t => {
            if (t._id !== rowId) return t;
            const updated = { ...t, activityDate: value };
            if (!value) {
                updated.selectedReminderTypes = [];
                updated.isReminderSet = false;
            }
            return updated;
        });
    }

    handleReminderSet(e) {
        const rowId = e.currentTarget.dataset.id;
        const checked = e.target.checked;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, isReminderSet: checked } : t));
    }

    handlePriority(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.value;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, priority: value } : t));
    }

    handleDescription(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.value;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, description: value } : t));
    }

    /* -------------------------
       Attendees
    -------------------------- */

    @track userResults = [];

    userSearchTimeout;
    userSearchKeyword = '';

    userSearchRequestId = 0;
    userBlurTimeout;
    searchDropdownInteractionTimeout;
    _isInteractingWithSearchDropdown = false;
    _skipNextUserFocus = false;
    _lastUserFocusSearchAt = 0;

    /* -------------------------
       Search
    -------------------------- */

    handleUserFocus(e) {
        const rowId = e.currentTarget.dataset.id;
        if (this._skipNextUserFocus) {
            this._skipNextUserFocus = false;
            return;
        }
        clearTimeout(this.userBlurTimeout);
        this._lastUserFocusSearchAt = Date.now();
        const keyword = this._activeAssigneeRowId === rowId ? (this.userSearchKeyword || '') : '';
        this.searchUsersInternal(rowId, keyword);
    }

    handleUserClick(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.userBlurTimeout);
        this._skipNextUserFocus = false;

        if (
            this._activeAssigneeRowId === rowId &&
            this.userResults.length > 0 &&
            Date.now() - (this._lastUserFocusSearchAt || 0) < SEARCH_FOCUS_CLICK_WINDOW_MS
        ) {
            return;
        }

        const keyword = this._activeAssigneeRowId === rowId ? (this.userSearchKeyword || '') : '';
        this.searchUsersInternal(rowId, keyword);
    }

    handleUserBlur() {
        if (this._isInteractingWithSearchDropdown) return;

        clearTimeout(this.userBlurTimeout);
        this.userBlurTimeout = setTimeout(() => {
            this.closeUserSearch();
        }, SEARCH_BLUR_CLOSE_DELAY_MS);
    }

    handleSearchDropdownMouseDown() {
        this._isInteractingWithSearchDropdown = true;
        clearTimeout(this.searchDropdownInteractionTimeout);
        this.searchDropdownInteractionTimeout = setTimeout(() => {
            this._isInteractingWithSearchDropdown = false;
        }, 0);
    }

    handleSearchAreaClick(e) {
        e.stopPropagation();
    }

    handleModalOutsideSearchClick() {
        this.closeUserSearch();
        this.closeSubjectSearch();
    }

    handleUserSearch(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.userSearchTimeout);

        const val = e.target.value;
        this.userSearchKeyword = val || '';
        this._activeAssigneeRowId = rowId;

        this.userSearchTimeout = setTimeout(() => {
            this.searchUsersInternal(rowId, val || '');
        }, 300);
    }

    handleUserKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rowId = e.currentTarget.dataset.id;
            const keyword = e.target.value || '';
            this.userSearchKeyword = keyword;
            this.searchUsersInternal(rowId, keyword);
        }
    }

    async searchUsersInternal(rowId, keyword) {
        this._activeAssigneeRowId = rowId;
        this.userSearchKeyword = keyword;
        this.assigneeDropdownStyle = this.computeDropdownStyle(`assignee-search-container-${rowId}`);
        const requestId = (this.userSearchRequestId || 0) + 1;
        this.userSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (this._activeAssigneeRowId !== rowId || requestId !== this.userSearchRequestId) return;

            const row = this.draftTasks.find(t => t._id === rowId);
            const selectedIds = row ? row.selectedUserIds : new Set();
            this.userResults = results.filter(user => !selectedIds.has(user.Id));
        } catch (err) {
            if (this._activeAssigneeRowId === rowId && requestId === this.userSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load users',
                    message: err?.body?.message || 'An error occurred while searching users.',
                    variant: 'error'
                }));
                this.userResults = [];
            }
        }
    }

    closeUserSearch() {
        this._activeAssigneeRowId = undefined;
        this.userSearchRequestId = (this.userSearchRequestId || 0) + 1;
        this.userResults = [];
        this.userSearchKeyword = '';
        clearTimeout(this.userSearchTimeout);
    }

    /* -------------------------
       Attendee Selection
    -------------------------- */

    addUser(e) {
        const rowId = this._activeAssigneeRowId;
        const id = e.currentTarget.dataset.id;
        const u = this.userResults.find(x => x.Id === id);

        if (!u || !rowId) return;

        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, selectedUserIds: new Set([u.Id]), selectedUsers: [{ id: u.Id, name: u.Name }] }
            : t));

        this.userSearchKeyword = '';
        this.closeUserSearch();
    }

    removeUser(e) {
        const rowId = e.target.dataset.rowId;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, selectedUsers: [], selectedUserIds: new Set() }
            : t));
    }

    /* -------------------------
       Validation
    -------------------------- */

    _validateDueDates() {
        const inputs = this.template.querySelectorAll('lightning-input[data-role="dueDate"]');
        let allValid = true;
        inputs.forEach(input => {
            input.reportValidity();
            if (!input.checkValidity()) allValid = false;
        });
        return allValid;
    }

    /* -------------------------
       Save
    -------------------------- */

    async saveAll() {
        if (this.isSaving) return;

        if (!this._validateDueDates()) {
            return;
        }

        if (this.draftTasks.some(t => t.selectedUsers.length === 0)) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Please select an Assignee for every task.',
                variant: 'error'
            }));
            return;
        }

        this.isSaving = true;
        try {
            const results = await Promise.allSettled(this.draftTasks.map(t => saveTask({
                relatedId: this.recordId,
                ownerIds: t.selectedUsers.map(u => u.id),
                subject: t.subject,
                dueDate: t.activityDate,
                status: t.status,
                priority: t.priority,
                description: t.description,
                reminderTypes: t.selectedReminderTypes
            })));

            const failedRows   = this.draftTasks.filter((t, i) => results[i].status === 'rejected');
            const successCount = results.length - failedRows.length;

            if (successCount > 0) {
                publish(this.messageContext, TASK_CHANGED, {});
            }

            if (failedRows.length === 0) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Success',
                    message: successCount === 1 ? 'Task created' : `${successCount} tasks created`,
                    variant: 'success'
                }));
                this.close('success');
            } else {
                const firstFailure = results.find(r => r.status === 'rejected');
                this.dispatchEvent(new ShowToastEvent({
                    title: successCount > 0 ? 'Some tasks were not created' : 'Error',
                    message: `${successCount} of ${results.length} task${results.length === 1 ? '' : 's'} created. `
                        + (firstFailure.reason?.body?.message || firstFailure.reason?.message || 'Please check the remaining task(s) and try again.'),
                    variant: successCount > 0 ? 'warning' : 'error'
                }));
                this.draftTasks = failedRows;
            }
        } finally {
            this.isSaving = false;
        }
    }

    disconnectedCallback() {
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.userBlurTimeout);
        clearTimeout(this.searchDropdownInteractionTimeout);
        clearTimeout(this.subjectBlurTimeout);
        clearTimeout(this.subjectDropdownInteractionTimeout);
    }

    handleCancel() {
        this.close();
    }
}
