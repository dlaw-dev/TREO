import LightningModal from 'lightning/modal';
import { api, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import { publish, MessageContext } from 'lightning/messageService';
import { refreshApex } from '@salesforce/apex';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';

import saveTask from '@salesforce/apex/TaskUiController.saveTask';
import searchTasksForMatter from '@salesforce/apex/TaskUiController.searchTasksForMatter';
import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';
import getTemplates from '@salesforce/apex/SubtaskTemplateUiController.getTemplates';
import getMyCustomTemplates from '@salesforce/apex/SubtaskTemplateUiController.getMyCustomTemplates';
import getTemplateItems from '@salesforce/apex/SubtaskTemplateUiController.getTemplateItems';
import getMatterRoleAssignees from '@salesforce/apex/SubtaskTemplateUiController.getMatterRoleAssignees';
import applyTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.applyTemplate';
import saveCustomTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.saveCustomTemplate';
import deleteCustomTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.deleteCustomTemplate';

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

// The only "Dynamic Matter Field" options the self-serve builder exposes -
// a fixed, friendly picklist of the 3 role lookups on the Matter, instead of
// the admin-only free-form "any field" capability pre-built templates have.
const TEMPLATE_ROLE_OPTIONS = [
    { label: 'Choose a specific person…', value: 'person' },
    { label: 'Senior Attorney', value: 'Senior_Attorney__c' },
    { label: 'Associate Attorney', value: 'Associate_Attorney__c' },
    { label: 'LSS/Paralegal', value: 'LSS_Paralegal__c' }
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
        isMoreDetailsOpen: false,
        waitingOnTaskId: undefined,
        waitingOnTaskLabel: ''
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

    _activeWaitingRowId;
    waitingDropdownStyle = '';
    waitingSearchTimeout;
    waitingSearchKeyword = '';
    waitingSearchRequestId = 0;
    waitingBlurTimeout;
    waitingDropdownInteractionTimeout;
    _isInteractingWithWaitingDropdown = false;
    @track waitingResults = [];

    activeTab = 'newTask';

    selectedTemplateId;
    isApplyingTemplate = false;

    isPrebuiltSectionOpen = true;
    isMyTemplatesSectionOpen = true;

    isBuildingCustomTemplate = false;
    customTemplateName = '';
    _stepCounter = 1;
    @track customTemplateSteps = [{ _id: 'step-1', subject: '', assigneeMode: 'person', selectedUser: null }];
    isSavingCustomTemplate = false;

    _activeStepId;
    @track stepUserResults = [];
    stepSearchKeyword = '';
    stepDropdownStyle = '';
    stepSearchTimeout;
    stepBlurTimeout;
    stepSearchDropdownInteractionTimeout;
    _isInteractingWithStepDropdown = false;
    stepSearchRequestId = 0;

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

    get statusOptions() {
        return [
            { label: 'Open', value: 'Open' },
            { label: 'Waiting', value: 'Waiting' }
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
            const isWaitingActive = this._activeWaitingRowId === t._id;
            const reminderRows = this._reminderOptionRowsFor(t.selectedReminderTypes);

            return {
                ...t,
                displayIndex: index + 1,
                canRemove: this.draftTasks.length > 1,
                subjectContainerId: `subject-search-container-${t._id}`,
                assigneeContainerId: `assignee-search-container-${t._id}`,
                waitingContainerId: `waiting-search-container-${t._id}`,
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
                isStatusWaiting: t.status === 'Waiting',
                hasWaitingOnTask: !!t.waitingOnTaskId,
                hasWaitingResults: isWaitingActive && this.waitingResults.length > 0,
                waitingResults: isWaitingActive ? this.waitingResults : [],
                waitingSearchKeyword: isWaitingActive ? this.waitingSearchKeyword : '',
                waitingDropdownStyle: this.waitingDropdownStyle,
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

    get isSelectedTemplateCustom() {
        if (!this.selectedTemplateId) return false;
        const custom = this.wiredMyTemplatesResult?.data ?? [];
        return custom.some(t => t.id === this.selectedTemplateId);
    }

    get showPrebuiltPreview() {
        return this.hasSelectedTemplate && !this.isSelectedTemplateCustom;
    }

    get showMyTemplatesPreview() {
        return this.hasSelectedTemplate && this.isSelectedTemplateCustom;
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
       Collapsible sections
    -------------------------- */

    get prebuiltSectionIcon() {
        return this.isPrebuiltSectionOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }
    get myTemplatesSectionIcon() {
        return this.isMyTemplatesSectionOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }
    togglePrebuiltSection() {
        this.isPrebuiltSectionOpen = !this.isPrebuiltSectionOpen;
    }
    toggleMyTemplatesSection() {
        this.isMyTemplatesSectionOpen = !this.isMyTemplatesSectionOpen;
    }

    /* -------------------------
       My Templates (custom, user-built)
    -------------------------- */

    wiredMyTemplatesResult;
    @wire(getMyCustomTemplates)
    wiredMyTemplates(result) {
        this.wiredMyTemplatesResult = result;
    }

    get isMyTemplatesLoading() {
        return !this.wiredMyTemplatesResult?.data && !this.wiredMyTemplatesResult?.error;
    }

    get myTemplatesErrorMessage() {
        return this.wiredMyTemplatesResult?.error?.body?.message
            || this.wiredMyTemplatesResult?.error?.message
            || 'Something went wrong loading your templates.';
    }

    get hasMyTemplatesError() {
        return !!this.wiredMyTemplatesResult?.error;
    }

    get hasNoMyTemplates() {
        return !this.isMyTemplatesLoading && !this.hasMyTemplatesError && this.myTemplateCards.length === 0;
    }

    get myTemplateCards() {
        const templates = this.wiredMyTemplatesResult?.data ?? [];
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

    async handleDeleteCustomTemplate(event) {
        event.stopPropagation();
        const id = event.currentTarget.dataset.id;

        // eslint-disable-next-line no-alert
        if (!window.confirm('Delete this template? This cannot be undone.')) {
            return;
        }

        try {
            await deleteCustomTemplateApex({ templateId: id });
            if (this.selectedTemplateId === id) {
                this.selectedTemplateId = undefined;
            }
            await refreshApex(this.wiredMyTemplatesResult);
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        }
    }

    /* -------------------------
       Custom Template Builder

       Deliberately isolated from the New Task tab's own repeater rather
       than sharing its state - keeps this simple addition from touching
       already-working code. Subject has no autocomplete here (unlike the
       New Task tab) since a template step doesn't need ad hoc suggestions.
    -------------------------- */

    startBuildingCustomTemplate() {
        this.isBuildingCustomTemplate = true;
    }

    cancelBuildingCustomTemplate() {
        this.isBuildingCustomTemplate = false;
        this.customTemplateName = '';
        this._stepCounter = 1;
        this.customTemplateSteps = [{ _id: 'step-1', subject: '', assigneeMode: 'person', selectedUser: null }];
        this.closeStepSearch();
    }

    handleCustomTemplateNameChange(e) {
        this.customTemplateName = e.target.value;
    }

    handleStepSubjectChange(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.value;
        this.customTemplateSteps = this.customTemplateSteps.map(s => (s._id === rowId ? { ...s, subject: value } : s));
    }

    @wire(getMatterRoleAssignees, { matterId: '$recordId' })
    wiredMatterRoleAssignees;

    get templateRoleOptions() {
        return TEMPLATE_ROLE_OPTIONS;
    }

    _roleLabel(mode) {
        const found = TEMPLATE_ROLE_OPTIONS.find(o => o.value === mode);
        return found ? found.label : mode;
    }

    _roleAssigneeName(mode) {
        const data = this.wiredMatterRoleAssignees?.data;
        if (!data) return null;
        if (mode === 'Senior_Attorney__c') return data.seniorAttorneyName;
        if (mode === 'Associate_Attorney__c') return data.associateAttorneyName;
        if (mode === 'LSS_Paralegal__c') return data.lssParalegalName;
        return null;
    }

    get displayCustomTemplateSteps() {
        return this.customTemplateSteps.map((s, index) => {
            const isActive = this._activeStepId === s._id;
            const isPersonMode = s.assigneeMode === 'person';
            const isFirst = index === 0;
            const previousSubject = isFirst ? null : this.customTemplateSteps[index - 1].subject;

            let assigneeDisplayText;
            let assigneePillClass;
            if (isPersonMode) {
                assigneeDisplayText = s.selectedUser ? s.selectedUser.name : 'Choose an assignee';
                assigneePillClass = 'timeline-pill timeline-pill-fixed';
            } else {
                const roleName = this._roleAssigneeName(s.assigneeMode);
                const roleLabel = this._roleLabel(s.assigneeMode);
                assigneeDisplayText = roleName ? `${roleName} (${roleLabel})` : `${roleLabel} (not yet set on this Matter)`;
                assigneePillClass = 'timeline-pill timeline-pill-auto';
            }

            return {
                ...s,
                displayIndex: index + 1,
                isLast: index === this.customTemplateSteps.length - 1,
                canRemove: this.customTemplateSteps.length > 1,
                assigneeContainerId: `step-assignee-search-container-${s._id}`,
                isPersonMode,
                hasSelectedAssignee: !!s.selectedUser,
                hasUserResults: isActive && this.stepUserResults.length > 0,
                userResults: isActive ? this.stepUserResults : [],
                userSearchKeyword: isActive ? this.stepSearchKeyword : '',
                stepDropdownStyle: this.stepDropdownStyle,
                timingLabel: isFirst ? 'Starts immediately' : `Waits for "${previousSubject || '…'}"`,
                timingPillClass: isFirst ? 'timeline-pill timeline-pill-immediate' : 'timeline-pill timeline-pill-waiting',
                assigneeDisplayText,
                assigneePillClass
            };
        });
    }

    _isStepIncomplete(s) {
        if (!s.subject || !s.subject.trim()) return true;
        if (s.assigneeMode === 'person') return !s.selectedUser;
        return false;
    }

    get isSaveTemplateDisabled() {
        return this.isSavingCustomTemplate
            || !this.customTemplateName || !this.customTemplateName.trim()
            || this.customTemplateSteps.some(s => this._isStepIncomplete(s));
    }

    handleStepAssigneeModeChange(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.detail.value;
        this.customTemplateSteps = this.customTemplateSteps.map(s => (s._id === rowId
            ? { ...s, assigneeMode: value, selectedUser: value === 'person' ? s.selectedUser : null }
            : s));
    }

    addStepRow() {
        this._stepCounter++;
        this.customTemplateSteps = [...this.customTemplateSteps, {
            _id: `step-${this._stepCounter}`,
            subject: '',
            assigneeMode: 'person',
            selectedUser: null
        }];
    }

    removeStepRow(event) {
        const rowId = event.currentTarget.dataset.id;
        this.customTemplateSteps = this.customTemplateSteps.filter(s => s._id !== rowId);
        if (this.customTemplateSteps.length === 0) {
            this.addStepRow();
        }
    }

    handleStepAssigneeFocus(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.stepBlurTimeout);
        const keyword = this._activeStepId === rowId ? (this.stepSearchKeyword || '') : '';
        this.searchUsersForStep(rowId, keyword);
    }

    handleStepAssigneeBlur() {
        if (this._isInteractingWithStepDropdown) return;

        clearTimeout(this.stepBlurTimeout);
        this.stepBlurTimeout = setTimeout(() => {
            this.closeStepSearch();
        }, SEARCH_BLUR_CLOSE_DELAY_MS);
    }

    handleStepDropdownMouseDown() {
        this._isInteractingWithStepDropdown = true;
        clearTimeout(this.stepSearchDropdownInteractionTimeout);
        this.stepSearchDropdownInteractionTimeout = setTimeout(() => {
            this._isInteractingWithStepDropdown = false;
        }, 0);
    }

    handleStepAssigneeSearch(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.stepSearchTimeout);

        const val = e.target.value;
        this.stepSearchKeyword = val || '';
        this._activeStepId = rowId;

        this.stepSearchTimeout = setTimeout(() => {
            this.searchUsersForStep(rowId, val || '');
        }, 300);
    }

    handleStepAssigneeKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rowId = e.currentTarget.dataset.id;
            const keyword = e.target.value || '';
            this.stepSearchKeyword = keyword;
            this.searchUsersForStep(rowId, keyword);
        }
    }

    async searchUsersForStep(rowId, keyword) {
        this._activeStepId = rowId;
        this.stepSearchKeyword = keyword;
        this.stepDropdownStyle = this.computeDropdownStyle(`step-assignee-search-container-${rowId}`);
        const requestId = (this.stepSearchRequestId || 0) + 1;
        this.stepSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (this._activeStepId !== rowId || requestId !== this.stepSearchRequestId) return;

            this.stepUserResults = results;
        } catch (err) {
            if (this._activeStepId === rowId && requestId === this.stepSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load users',
                    message: err?.body?.message || 'An error occurred while searching users.',
                    variant: 'error'
                }));
                this.stepUserResults = [];
            }
        }
    }

    selectStepAssignee(e) {
        const rowId = this._activeStepId;
        const id = e.currentTarget.dataset.id;
        const u = this.stepUserResults.find(x => x.Id === id);

        if (!u || !rowId) return;

        this.customTemplateSteps = this.customTemplateSteps.map(s => (s._id === rowId
            ? { ...s, selectedUser: { id: u.Id, name: u.Name } }
            : s));

        this.closeStepSearch();
    }

    removeStepAssignee(e) {
        const rowId = e.target.dataset.rowId;
        this.customTemplateSteps = this.customTemplateSteps.map(s => (s._id === rowId ? { ...s, selectedUser: null } : s));
    }

    closeStepSearch() {
        this._activeStepId = undefined;
        this.stepSearchRequestId = (this.stepSearchRequestId || 0) + 1;
        this.stepUserResults = [];
        this.stepSearchKeyword = '';
        clearTimeout(this.stepSearchTimeout);
    }

    get debugStepsSummary() {
        return this.customTemplateSteps
            .map((s, i) => `#${i + 1} id=${s._id} subject=[${s.subject}] user=${s.selectedUser ? s.selectedUser.name : 'none'}`)
            .join(' | ');
    }

    async saveCustomTemplate() {
        if (this.isSavingCustomTemplate) return;

        if (!this.customTemplateName || !this.customTemplateName.trim()) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Please give the template a name.',
                variant: 'error'
            }));
            return;
        }

        for (let i = 0; i < this.customTemplateSteps.length; i++) {
            const s = this.customTemplateSteps[i];
            if (!s.subject || !s.subject.trim()) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Error',
                    message: `Step ${i + 1} needs a subject. [DEBUG raw=${JSON.stringify(s.subject)} type=${typeof s.subject} stepsLen=${this.customTemplateSteps.length} rawStep=${JSON.stringify(s)}]`,
                    variant: 'error'
                }));
                return;
            }
            if (s.assigneeMode === 'person' && !s.selectedUser) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Error',
                    message: `Step ${i + 1} needs an assignee.`,
                    variant: 'error'
                }));
                return;
            }
        }

        this.isSavingCustomTemplate = true;

        try {
            await saveCustomTemplateApex({
                name: this.customTemplateName,
                steps: this.customTemplateSteps.map(s => ({
                    subject: s.subject,
                    assigneeType: s.assigneeMode === 'person' ? 'Static User' : 'Dynamic Matter Field',
                    assigneeId: s.assigneeMode === 'person' ? s.selectedUser?.id : null,
                    dynamicField: s.assigneeMode === 'person' ? null : s.assigneeMode
                }))
            });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Template saved',
                variant: 'success'
            }));
            await refreshApex(this.wiredMyTemplatesResult);
            this.cancelBuildingCustomTemplate();
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this.isSavingCustomTemplate = false;
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

    handleStatus(e) {
        const rowId = e.currentTarget.dataset.id;
        const value = e.target.value;
        this.draftTasks = this.draftTasks.map(t => {
            if (t._id !== rowId) return t;
            const updated = { ...t, status: value };
            if (value !== 'Waiting') {
                updated.waitingOnTaskId = undefined;
                updated.waitingOnTaskLabel = '';
            }
            return updated;
        });
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
        this.closeWaitingSearch();
        this.closeStepSearch();
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
       Waiting On Task (only shown when a row's Status = Waiting)
    -------------------------- */

    openWaitingSearch(rowId) {
        clearTimeout(this.waitingBlurTimeout);
        this._activeWaitingRowId = rowId;
        this.waitingDropdownStyle = this.computeDropdownStyle(`waiting-search-container-${rowId}`);
    }

    closeWaitingSearch() {
        this._activeWaitingRowId = undefined;
        this.waitingSearchRequestId = (this.waitingSearchRequestId || 0) + 1;
        this.waitingResults = [];
        this.waitingSearchKeyword = '';
        clearTimeout(this.waitingSearchTimeout);
    }

    handleWaitingFocus(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.waitingBlurTimeout);
        const keyword = this._activeWaitingRowId === rowId ? (this.waitingSearchKeyword || '') : '';
        this.searchTasksInternal(rowId, keyword);
    }

    handleWaitingBlur() {
        if (this._isInteractingWithWaitingDropdown) return;

        clearTimeout(this.waitingBlurTimeout);
        this.waitingBlurTimeout = setTimeout(() => {
            this.closeWaitingSearch();
        }, SEARCH_BLUR_CLOSE_DELAY_MS);
    }

    handleWaitingDropdownMouseDown() {
        this._isInteractingWithWaitingDropdown = true;
        clearTimeout(this.waitingDropdownInteractionTimeout);
        this.waitingDropdownInteractionTimeout = setTimeout(() => {
            this._isInteractingWithWaitingDropdown = false;
        }, 0);
    }

    handleWaitingSearch(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.waitingSearchTimeout);

        const val = e.target.value;
        this.waitingSearchKeyword = val || '';
        this._activeWaitingRowId = rowId;

        this.waitingSearchTimeout = setTimeout(() => {
            this.searchTasksInternal(rowId, val || '');
        }, 300);
    }

    handleWaitingKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rowId = e.currentTarget.dataset.id;
            const keyword = e.target.value || '';
            this.waitingSearchKeyword = keyword;
            this.searchTasksInternal(rowId, keyword);
        }
    }

    _formatShortDate(dateStr) {
        const d = new Date(`${dateStr}T00:00:00`);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    _taskMetaLabel(task) {
        const owner = task.Owner ? task.Owner.Name : 'Unassigned';
        const due = task.ActivityDate ? `Due ${this._formatShortDate(task.ActivityDate)}` : 'No due date';
        const parts = [owner, due];
        if (task.Priority === 'High') parts.push('High priority');
        return parts.join(' · ');
    }

    async searchTasksInternal(rowId, keyword) {
        this._activeWaitingRowId = rowId;
        this.waitingSearchKeyword = keyword;
        this.waitingDropdownStyle = this.computeDropdownStyle(`waiting-search-container-${rowId}`);
        const requestId = (this.waitingSearchRequestId || 0) + 1;
        this.waitingSearchRequestId = requestId;

        try {
            const results = await searchTasksForMatter({ matterId: this.recordId, keyword });

            if (this._activeWaitingRowId !== rowId || requestId !== this.waitingSearchRequestId) return;

            this.waitingResults = results.map(r => ({ ...r, metaLabel: this._taskMetaLabel(r) }));
        } catch (err) {
            if (this._activeWaitingRowId === rowId && requestId === this.waitingSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load tasks',
                    message: err?.body?.message || 'An error occurred while searching tasks.',
                    variant: 'error'
                }));
                this.waitingResults = [];
            }
        }
    }

    selectWaitingOnTask(e) {
        const rowId = this._activeWaitingRowId;
        const id = e.currentTarget.dataset.id;
        const task = this.waitingResults.find(x => x.Id === id);

        if (!task || !rowId) return;

        const label = `${task.Subject} — ${this._taskMetaLabel(task)}`;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, waitingOnTaskId: task.Id, waitingOnTaskLabel: label }
            : t));

        this.closeWaitingSearch();
    }

    clearWaitingOnTask(e) {
        const rowId = e.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, waitingOnTaskId: undefined, waitingOnTaskLabel: '' }
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

        if (this.draftTasks.some(t => t.status === 'Waiting' && !t.waitingOnTaskId)) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Please select which task each Waiting task is waiting on.',
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
                reminderTypes: t.selectedReminderTypes,
                waitingOnTaskId: t.status === 'Waiting' ? (t.waitingOnTaskId || null) : null
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
        clearTimeout(this.waitingSearchTimeout);
        clearTimeout(this.waitingBlurTimeout);
        clearTimeout(this.waitingDropdownInteractionTimeout);
        clearTimeout(this.stepSearchTimeout);
        clearTimeout(this.stepBlurTimeout);
        clearTimeout(this.stepSearchDropdownInteractionTimeout);
    }

    handleCancel() {
        this.close();
    }
}
