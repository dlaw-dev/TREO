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

export default class TaskCreateModalAction extends LightningModal {

    @api recordId;

    // Getter/setter pairs so values populate correctly whether the LWC modal
    // framework sets them before or after connectedCallback fires.
    _initialSubject;
    @api get initialSubject() { return this._initialSubject; }
    set initialSubject(val) { this._initialSubject = val; if (val != null) this.subject = val; }

    _initialDueDate;
    @api get initialDueDate() { return this._initialDueDate; }
    set initialDueDate(val) { this._initialDueDate = val; if (val != null) this.activityDate = val; }

    _initialPriority;
    @api get initialPriority() { return this._initialPriority; }
    set initialPriority(val) { this._initialPriority = val; if (val != null) this.priority = val; }

    _initialDescription;
    @api get initialDescription() { return this._initialDescription; }
    set initialDescription(val) { this._initialDescription = val; if (val != null) this.description = val; }

    _initialAssignees = [];
    @api get initialAssignees() { return this._initialAssignees; }
    set initialAssignees(val) {
        this._initialAssignees = val || [];
        const first = Array.isArray(this._initialAssignees) ? this._initialAssignees[0] : null;

        if (first?.id) {
            this.selectedUserIds = new Set([first.id]);
            this.selectedUsers = [{ id: first.id, name: first.name }];
        }
    }

    subject = '';
    activityDate;
    status = 'Open';
    priority = 'Normal';
    description = '';

    @track selectedReminderTypes = [];
    isReminderSet = false;

    isMoreDetailsOpen = false;

    isSaving = false;

    isSubjectSearchOpen = false;
    subjectDropdownStyle = '';
    subjectBlurTimeout;
    subjectDropdownInteractionTimeout;
    _isInteractingWithSubjectDropdown = false;

    assigneeDropdownStyle = '';

    activeTab = 'newTask';

    selectedTemplateId;
    isApplyingTemplate = false;

    @wire(MessageContext) messageContext;

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

    get reminderOptionRows() {
        return this.sortedReminderOptions.map(o => ({
            ...o,
            checked: this.selectedReminderTypes.includes(o.value)
        }));
    }

    get reminderOptionColumnLeft() {
        const rows = this.reminderOptionRows;
        return rows.slice(0, Math.ceil(rows.length / 2));
    }

    get reminderOptionColumnRight() {
        const rows = this.reminderOptionRows;
        return rows.slice(Math.ceil(rows.length / 2));
    }

    get isReminderDisabled() {
        return !this.activityDate;
    }

    handleReminderOptionToggle(e) {
        const value = e.target.dataset.value;

        this.selectedReminderTypes = e.target.checked
            ? [...this.selectedReminderTypes, value]
            : this.selectedReminderTypes.filter(v => v !== value);
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
       UI Helpers
    -------------------------- */

    get hasSelectedAssignee() {
        return this.selectedUsers.length > 0;
    }

    get isSaveDisabled() {
        return this.isSaving;
    }

    get moreDetailsIcon() {
        return this.isMoreDetailsOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    toggleMoreDetails() {
        this.isMoreDetailsOpen = !this.isMoreDetailsOpen;
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
                    ? `Fixed • ${item.assigneeLabel}`
                    : item.resolvedName
                        ? `Auto • ${item.resolvedName} (${item.assigneeLabel})`
                        : `Auto • ${item.assigneeLabel}`,
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
                message: 'Template applied',
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

    get filteredSubjectSuggestions() {
        const keyword = (this.subject || '').trim().toLowerCase();
        if (!keyword) return SUBJECT_SUGGESTIONS;
        return SUBJECT_SUGGESTIONS.filter(s => s.toLowerCase().includes(keyword));
    }

    get hasSubjectSuggestions() {
        return this.isSubjectSearchOpen && this.filteredSubjectSuggestions.length > 0;
    }

    openSubjectSearch() {
        clearTimeout(this.subjectBlurTimeout);
        this.isSubjectSearchOpen = true;
        this.subjectDropdownStyle = this.computeDropdownStyle('subject-search-container');
    }

    closeSubjectSearch() {
        this.isSubjectSearchOpen = false;
        clearTimeout(this.subjectBlurTimeout);
    }

    handleSubjectFocus() {
        this.openSubjectSearch();
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
        this.subject = e.currentTarget.dataset.value;
        this.closeSubjectSearch();

        // The input blurs (while still empty) just before this click handler
        // fills in the value, so lightning-input flags itself invalid on that
        // blur. Re-check validity once the new value has rendered so the
        // error clears without the user needing to click back into the field.
        Promise.resolve().then(() => {
            this.template.querySelector('lightning-input[data-id="subject-input"]')?.reportValidity();
        });
    }

    /* -------------------------
       Field Handlers
    -------------------------- */

    handleSubject = e => {
        this.subject = e.target.value;
        this.isSubjectSearchOpen = true;
    };
    handleDueDate = e => {
        this.activityDate = e.target.value;

        if (!this.activityDate) {
            this.selectedReminderTypes = [];
            this.isReminderSet = false;
        }
    };
    handleReminderSet = e => this.isReminderSet = e.target.checked;
    handlePriority = e => this.priority = e.target.value;
    handleDescription = e => this.description = e.target.value;

    /* -------------------------
       Attendees
    -------------------------- */

    @track userResults = [];
    @track selectedUsers = [];

    selectedUserIds = new Set();

    userSearchTimeout;
    userSearchKeyword = '';

    isUserSearchOpen = false;
    userSearchRequestId = 0;
    userBlurTimeout;
    searchDropdownInteractionTimeout;

    get hasUserResults() {
        return this.userResults.length > 0;
    }

    /* -------------------------
       Search
    -------------------------- */

    handleUserFocus() {
        if (this._skipNextUserFocus) {
            this._skipNextUserFocus = false;
            return;
        }
        clearTimeout(this.userBlurTimeout);
        this._lastUserFocusSearchAt = Date.now();
        this.searchUsersInternal(this.userSearchKeyword || '');
    }

    handleUserClick() {
        clearTimeout(this.userBlurTimeout);
        this._skipNextUserFocus = false;

        if (
            this.isUserSearchOpen &&
            this.userResults.length > 0 &&
            Date.now() - (this._lastUserFocusSearchAt || 0) < SEARCH_FOCUS_CLICK_WINDOW_MS
        ) {
            return;
        }

        this.searchUsersInternal(this.userSearchKeyword || '');
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
        clearTimeout(this.userSearchTimeout);

        const val = e.target.value;
        this.userSearchKeyword = val || '';

        this.userSearchTimeout = setTimeout(() => {
            this.searchUsersInternal(val || '');
        }, 300);
    }

    handleUserKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const keyword = e.target.value || '';
            this.userSearchKeyword = keyword;
            this.searchUsersInternal(keyword);
        }
    }

    async searchUsersInternal(keyword) {
        this.isUserSearchOpen = true;
        this.assigneeDropdownStyle = this.computeDropdownStyle('assignee-search-container');
        const requestId = (this.userSearchRequestId || 0) + 1;
        this.userSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (!this.isUserSearchOpen || requestId !== this.userSearchRequestId) return;

            this.userResults = results.filter(
                user => !this.selectedUserIds.has(user.Id)
            );
        } catch (err) {
            if (this.isUserSearchOpen && requestId === this.userSearchRequestId) {
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
        this.isUserSearchOpen = false;
        this.userSearchRequestId = (this.userSearchRequestId || 0) + 1;
        this.userResults = [];
        clearTimeout(this.userSearchTimeout);
    }

    /* -------------------------
       Attendee Selection
    -------------------------- */

    addUser(e) {
        const id = e.currentTarget.dataset.id;
        const u = this.userResults.find(x => x.Id === id);

        if (!u) return;

        this.addSelectedUser(u);
    }

    addSelectedUser(user) {
        this.selectedUserIds = new Set([user.Id]);
        this.selectedUsers = [{ id: user.Id, name: user.Name }];

        this.userSearchKeyword = '';
        this.closeUserSearch();
    }

    removeUser(e) {
        const id = e.target.dataset.id;

        this.selectedUserIds.delete(id);
        this.selectedUsers = this.selectedUsers.filter(u => u.id !== id);
    }

    /* -------------------------
       Validation
    -------------------------- */

    validateDueDate() {
        const input = this.template.querySelector(
            'lightning-input[data-id="dueDate"]'
        );

        if (!input) return true;

        input.reportValidity();
        return input.checkValidity();
    }

    /* -------------------------
       Save
    -------------------------- */

    async _performSave() {
        if (!this.validateDueDate()) {
            return false;
        }

        if (!this.hasSelectedAssignee) {
            throw new Error('Please select an Assignee.');
        }

        await saveTask({
            relatedId: this.recordId,
            ownerIds: this.selectedUsers.map(u => u.id),
            subject: this.subject,
            dueDate: this.activityDate,
            status: this.status,
            priority: this.priority,
            description: this.description,
            reminderTypes: this.selectedReminderTypes
        });

        return true;
    }

    async save() {
        if (this.isSaving) return;
        this.isSaving = true;
        try {
            const saved = await this._performSave();
            if (!saved) return;
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: 'Task created', variant: 'success' }));
            this.close('success');
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: e.body?.message || e.message, variant: 'error' }));
        } finally {
            this.isSaving = false;
        }
    }

    async saveAndNew() {
        if (this.isSaving) return;
        this.isSaving = true;
        try {
            const saved = await this._performSave();
            if (!saved) return;
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: 'Task created', variant: 'success' }));
            publish(this.messageContext, TASK_CHANGED, {});
            this.resetForNew();
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: e.body?.message || e.message, variant: 'error' }));
        } finally {
            this.isSaving = false;
        }
    }

    resetForNew() {
        this.subject                = '';
        this.activityDate           = undefined;
        this.status                 = 'Open';
        this.priority               = 'Normal';
        this.description            = '';
        this.selectedReminderTypes  = [];
        this.isReminderSet          = false;
        this.isMoreDetailsOpen      = false;
        this.selectedUsers          = [];
        this.selectedUserIds        = new Set();
        this.userResults            = [];
        this.userSearchKeyword      = '';
        this.closeUserSearch();
        this.closeSubjectSearch();
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