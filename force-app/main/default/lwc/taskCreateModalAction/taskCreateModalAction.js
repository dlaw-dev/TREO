import LightningModal from 'lightning/modal';
import { api, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import { publish, MessageContext } from 'lightning/messageService';
import { refreshApex } from '@salesforce/apex';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';

import saveTask from '@salesforce/apex/TaskUiController.saveTask';
import updateTask from '@salesforce/apex/TaskUiController.updateTask';
import getTaskForEdit from '@salesforce/apex/TaskUiController.getTaskForEdit';
import searchTasksForMatter from '@salesforce/apex/TaskUiController.searchTasksForMatter';
import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';
import getTemplates from '@salesforce/apex/SubtaskTemplateUiController.getTemplates';
import getMyCustomTemplates from '@salesforce/apex/SubtaskTemplateUiController.getMyCustomTemplates';
import isCurrentUserAdmin from '@salesforce/apex/SubtaskTemplateUiController.isCurrentUserAdmin';
import getTemplateItems from '@salesforce/apex/SubtaskTemplateUiController.getTemplateItems';
import getMatterRoleAssignees from '@salesforce/apex/SubtaskTemplateUiController.getMatterRoleAssignees';
import applyTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.applyTemplate';
import saveCustomTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.saveCustomTemplateFromUi';
import deleteCustomTemplateApex from '@salesforce/apex/SubtaskTemplateUiController.deleteCustomTemplate';

import MATTER_NAME from '@salesforce/schema/NEOS_Matter__c.Name';
import TASK_OBJECT from '@salesforce/schema/Task';

import TASK_REMINDER_OBJECT from '@salesforce/schema/Task_Reminder__c';
import REMINDER_TYPE_FIELD from '@salesforce/schema/Task_Reminder__c.Reminder_Type__c';

const SEARCH_FOCUS_CLICK_WINDOW_MS = 200;
// Matches .search-dropdown's max-height in CSS.
const DROPDOWN_MAX_HEIGHT_PX = 200;
const DROPDOWN_EDGE_MARGIN_PX = 8;
const DROPDOWN_MIN_HEIGHT_PX = 60;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const SUBJECT_SUGGESTIONS = [
    'Calendar',
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
        waitingOnDraftId: undefined,
        waitingOnTaskLabel: '',
        isChainStep: false,
        chainPredecessorSubject: '',
        selectedReviewer: null,
        reviewFeedback: '',
        stagedFiles: [],
        fileWarning: '',
        isDragOver: false,
        existingAttachments: []
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

    // Setting this puts the modal into Edit/Reassign mode: a single row,
    // pre-filled from the real Task record (not from whatever summary
    // fields the calling list view already had), saved via updateTask
    // instead of the normal insert-only saveTask loop.
    _existingTaskId;
    @api get existingTaskId() { return this._existingTaskId; }
    set existingTaskId(val) {
        this._existingTaskId = val;
        if (val) { this._loadExistingTask(val); }
    }

    get isEditMode() { return !!this._existingTaskId; }

    isLoadingExisting = false;

    async _loadExistingTask(taskId) {
        this.isLoadingExisting = true;
        try {
            const dto = await getTaskForEdit({ taskId });
            this._patchFirstRow({
                subject: dto.subject,
                activityDate: dto.dueDate,
                status: dto.status,
                priority: dto.priority,
                description: dto.description || '',
                selectedUserIds: new Set(dto.ownerId ? [dto.ownerId] : []),
                selectedUsers: dto.ownerId ? [{ id: dto.ownerId, name: dto.ownerName }] : [],
                waitingOnTaskId: dto.waitingOnTaskId,
                waitingOnTaskLabel: dto.waitingOnTaskSubject || '',
                isChainStep: !!dto.isChainStep,
                chainPredecessorSubject: dto.chainPredecessorSubject || '',
                selectedReviewer: dto.reviewerId ? { id: dto.reviewerId, name: dto.reviewerName } : null,
                reviewFeedback: dto.reviewFeedback || '',
                existingAttachments: (dto.attachments || []).map(a => ({
                    ...a,
                    viewUrl: `/lightning/r/ContentDocument/${a.contentDocumentId}/view`
                }))
            });
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error loading task',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this.isLoadingExisting = false;
        }
    }

    _taskCounter = 1;
    @track draftTasks = [blankTaskRow('1')];

    isSaving = false;

    _activeSubjectRowId;

    _activeAssigneeRowId;

    _activeWaitingRowId;
    waitingSearchTimeout;
    waitingSearchKeyword = '';
    waitingSearchRequestId = 0;
    @track waitingResults = [];

    _activeReviewerRowId;
    reviewerSearchTimeout;
    reviewerSearchKeyword = '';
    reviewerSearchRequestId = 0;
    @track reviewerResults = [];

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
    stepSearchTimeout;
    stepSearchRequestId = 0;

    @wire(MessageContext) messageContext;

    /* -------------------------
       Dropdown Portal

       Search dropdowns (Subject/Assignee/Waiting On/step-assignee) render
       into a single node moved to document.body - the same technique
       Salesforce's own base components (e.g. the Due Date picker) use to
       escape lightning-modal-body's clipping. LWC doesn't manage this
       node's children (lwc:dom="manual" in the template), so we build/
       tear down its content by hand instead of through the template.
    -------------------------- */

    _portalEl;
    _portalMounted = false;
    _portalScrollListener;

    renderedCallback() {
        this._mountPortal();
    }

    _mountPortal() {
        if (this._portalMounted) return;
        this._portalEl = this.template.querySelector('.dropdown-portal');
        if (!this._portalEl) return;
        document.body.appendChild(this._portalEl);
        // Prevent mousedown anywhere in the dropdown (buttons, padding,
        // scrollbar) from blurring the field that opened it - selection
        // itself is handled by each item's own click listener.
        this._portalEl.addEventListener('mousedown', (evt) => evt.preventDefault());
        this._portalMounted = true;
    }

    _unmountPortal() {
        if (this._portalEl && this._portalEl.parentNode) {
            this._portalEl.parentNode.removeChild(this._portalEl);
        }
        this._portalMounted = false;
        this._detachPortalScrollGuard();
    }

    // dataId: the search-container's data-id, used to find the field to anchor to.
    // items: array of arbitrary result objects.
    // buildItem(buttonEl, item): populate the button's content for one item.
    // onSelect(item): called when an item is chosen.
    _showPortal(dataId, items, buildItem, onSelect) {
        this._mountPortal();
        const el = this._portalEl;
        const container = this.template.querySelector(`[data-id="${dataId}"]`);
        if (!el || !container || !items || items.length === 0) {
            this._hidePortal();
            return;
        }

        const rect = container.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_EDGE_MARGIN_PX;
        const spaceAbove = rect.top - DROPDOWN_EDGE_MARGIN_PX;
        const flipUp = spaceBelow < DROPDOWN_MAX_HEIGHT_PX && spaceAbove > spaceBelow;
        const available = flipUp ? spaceAbove : spaceBelow;
        const maxHeight = Math.max(DROPDOWN_MIN_HEIGHT_PX, Math.min(DROPDOWN_MAX_HEIGHT_PX, available));

        el.innerHTML = '';
        el.style.position = 'fixed';
        el.style.left = `${rect.left}px`;
        el.style.width = `${rect.width}px`;
        el.style.maxHeight = `${maxHeight}px`;
        if (flipUp) {
            el.style.top = 'auto';
            el.style.bottom = `${window.innerHeight - rect.top + DROPDOWN_EDGE_MARGIN_PX}px`;
        } else {
            el.style.bottom = 'auto';
            el.style.top = `${rect.bottom + DROPDOWN_EDGE_MARGIN_PX}px`;
        }
        el.style.display = 'block';

        items.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dropdown-item';
            buildItem(btn, item);
            btn.addEventListener('click', () => onSelect(item));
            el.appendChild(btn);
        });

        this._attachPortalScrollGuard();
    }

    _hidePortal() {
        if (this._portalEl) {
            this._portalEl.style.display = 'none';
            this._portalEl.innerHTML = '';
        }
        this._detachPortalScrollGuard();
    }

    // A portaled dropdown can't move with the field if the modal body
    // scrolls underneath it, so just close it - matches how most native
    // and combobox-library dropdowns behave on scroll.
    _attachPortalScrollGuard() {
        if (this._portalScrollListener) return;
        this._portalScrollListener = () => this.handleModalOutsideSearchClick();
        window.addEventListener('scroll', this._portalScrollListener, true);
        window.addEventListener('resize', this._portalScrollListener);
    }

    _detachPortalScrollGuard() {
        if (!this._portalScrollListener) return;
        window.removeEventListener('scroll', this._portalScrollListener, true);
        window.removeEventListener('resize', this._portalScrollListener);
        this._portalScrollListener = undefined;
    }

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
        const base = [
            { label: 'Open', value: 'Open' },
            { label: 'Waiting', value: 'Waiting' }
        ];

        // A reassigned task may have been created outside this modal (or by
        // an older version of it) with a Status this dropdown doesn't offer -
        // add it so the combobox doesn't silently blank out an unrecognized
        // existing value.
        if (this.isEditMode) {
            const current = this.draftTasks[0]?.status;
            if (current && !base.some(o => o.value === current)) {
                base.push({ label: current, value: current });
            }
        }

        return base;
    }

    get modalTitle() {
        return this.isEditMode ? 'Edit/Reassign Task' : 'New Task';
    }

    get requireWaitingOnTask() {
        return !this.isEditMode;
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
            const isAssigneeActive = this._activeAssigneeRowId === t._id;
            const isWaitingActive = this._activeWaitingRowId === t._id;
            const isReviewerActive = this._activeReviewerRowId === t._id;
            const reminderRows = this._reminderOptionRowsFor(t.selectedReminderTypes);

            return {
                ...t,
                displayIndex: index + 1,
                canRemove: this.draftTasks.length > 1,
                subjectContainerId: `subject-search-container-${t._id}`,
                assigneeContainerId: `assignee-search-container-${t._id}`,
                waitingContainerId: `waiting-search-container-${t._id}`,
                reviewerContainerId: `reviewer-search-container-${t._id}`,
                hasSelectedAssignee: t.selectedUsers.length > 0,
                hasSelectedReviewer: !!t.selectedReviewer,
                hasReviewFeedback: !!t.reviewFeedback,
                isReminderDisabled: !t.activityDate,
                moreDetailsIcon: t.isMoreDetailsOpen ? 'utility:chevrondown' : 'utility:chevronright',
                userSearchKeyword: isAssigneeActive ? this.userSearchKeyword : '',
                isStatusWaiting: t.status === 'Waiting',
                hasWaitingOnTask: !!t.waitingOnTaskId || !!t.waitingOnDraftId,
                chainWaitingLabel: t.chainPredecessorSubject
                    ? `Part of a task chain — waiting on "${t.chainPredecessorSubject}"`
                    : 'Part of a task chain — waiting on an earlier step',
                waitingSearchKeyword: isWaitingActive ? this.waitingSearchKeyword : '',
                reviewerSearchKeyword: isReviewerActive ? this.reviewerSearchKeyword : '',
                // Earlier rows in this same batch aren't saved yet, so they can't
                // be found via searchTasksForMatter - offer them directly instead.
                // Only rows ABOVE this one are eligible, since saveAll() saves
                // top to bottom and a row needs its dependency's real Id already
                // resolved by the time it's its turn to save.
                otherDraftOptions: this.draftTasks.slice(0, index).map((ot, oi) => ({
                    _id: ot._id,
                    title: `Task ${oi + 1}${ot.subject ? ': ' + ot.subject : ''}`,
                    metaLabel: this._draftMetaLabel(ot)
                })),
                hasOtherDraftOptions: index > 0,
                reminderOptionColumnLeft: reminderRows.slice(0, Math.ceil(reminderRows.length / 2)),
                reminderOptionColumnRight: reminderRows.slice(Math.ceil(reminderRows.length / 2)),
                dropZoneClass: t.isDragOver ? 'drop-zone drop-zone--active' : 'drop-zone',
                hasStagedFiles: t.stagedFiles.length > 0,
                attachBannerText: t.stagedFiles.length === 1 ? '1 file attached' : `${t.stagedFiles.length} files attached`,
                hasExistingAttachments: t.existingAttachments.length > 0
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
        if (this.isEditMode) return 'Save Changes';
        const n = this.draftTasks.length;
        return n > 1 ? `Create ${n} Tasks` : 'Create Task';
    }

    addTaskRow() {
        this._taskCounter++;
        this.draftTasks = [...this.draftTasks, blankTaskRow(String(this._taskCounter))];
    }

    removeTaskRow(event) {
        const rowId = event.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks
            .filter(t => t._id !== rowId)
            .map(t => (t.waitingOnDraftId === rowId
                ? { ...t, waitingOnDraftId: undefined, waitingOnTaskLabel: '' }
                : t));
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

        // How many items depend on the same predecessor - more than one
        // means those steps open together (branching), which the numbered
        // markers below would otherwise make look like a strict sequence.
        const siblingCountBySubject = new Map();
        for (const item of items) {
            if (!item.dependsOnSubject) continue;
            siblingCountBySubject.set(
                item.dependsOnSubject,
                (siblingCountBySubject.get(item.dependsOnSubject) || 0) + 1
            );
        }

        return items.map((item, index) => {
            // Sourced from the template's real Depends_On_Step__c edge, not
            // "whatever's listed right above it" - more than one step can
            // depend on the very same earlier step (branching).
            const isImmediate = !item.dependsOnSubject;
            const siblingCount = isImmediate ? 0 : (siblingCountBySubject.get(item.dependsOnSubject) || 1);
            const timingBase = isImmediate ? 'Starts immediately' : `Waits for "${item.dependsOnSubject}"`;
            const othersCount = siblingCount - 1;
            const timingLabel = othersCount > 0
                ? `${timingBase} — opens together with ${othersCount} other step${othersCount === 1 ? '' : 's'}`
                : timingBase;

            return {
                id: item.id,
                displayIndex: index + 1,
                subject: item.subject,
                description: item.description,
                timingLabel,
                timingPillClass: isImmediate
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
       My Templates (custom, user-built) - admin-only
    -------------------------- */

    wiredIsAdminResult;
    @wire(isCurrentUserAdmin)
    wiredIsAdmin(result) {
        this.wiredIsAdminResult = result;
    }

    get isAdmin() {
        return this.wiredIsAdminResult?.data === true;
    }

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
                userSearchKeyword: isActive ? this.stepSearchKeyword : '',
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
        const keyword = this._activeStepId === rowId ? (this.stepSearchKeyword || '') : '';
        this.searchUsersForStep(rowId, keyword);
    }

    handleStepAssigneeBlur() {
        this.closeStepSearch();
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
        const requestId = (this.stepSearchRequestId || 0) + 1;
        this.stepSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (this._activeStepId !== rowId || requestId !== this.stepSearchRequestId) return;

            this.stepUserResults = results;
            this._refreshStepPortal(rowId);
        } catch (err) {
            if (this._activeStepId === rowId && requestId === this.stepSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load users',
                    message: err?.body?.message || 'An error occurred while searching users.',
                    variant: 'error'
                }));
                this.stepUserResults = [];
                this._refreshStepPortal(rowId);
            }
        }
    }

    _refreshStepPortal(rowId) {
        this._showPortal(
            `step-assignee-search-container-${rowId}`,
            this.stepUserResults,
            (btn, u) => { btn.textContent = u.Name; },
            (u) => this._selectStepAssignee(rowId, u)
        );
    }

    _selectStepAssignee(rowId, u) {
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
        this._hidePortal();
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
                    message: `Step ${i + 1} needs a subject.`,
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
                stepsJson: JSON.stringify(this.customTemplateSteps.map(s => ({
                    subject: s.subject,
                    assigneeType: s.assigneeMode === 'person' ? 'Static User' : 'Dynamic Matter Field',
                    assigneeId: s.assigneeMode === 'person' ? s.selectedUser?.id : null,
                    dynamicField: s.assigneeMode === 'person' ? null : s.assigneeMode
                })))
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
       Subject Suggestions
    -------------------------- */

    openSubjectSearch(rowId) {
        this._activeSubjectRowId = rowId;
        this._refreshSubjectPortal(rowId);
    }

    closeSubjectSearch() {
        this._activeSubjectRowId = undefined;
        this._hidePortal();
    }

    handleSubjectFocus(e) {
        this.openSubjectSearch(e.currentTarget.dataset.id);
    }

    handleSubjectBlur() {
        this.closeSubjectSearch();
    }

    _refreshSubjectPortal(rowId) {
        const row = this.draftTasks.find(t => t._id === rowId);
        const suggestions = this._suggestionsFor(row ? row.subject : '');
        this._showPortal(
            `subject-search-container-${rowId}`,
            suggestions,
            (btn, s) => { btn.textContent = s; },
            (s) => this._selectSubjectSuggestion(rowId, s)
        );
    }

    _selectSubjectSuggestion(rowId, value) {
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, subject: value } : t));
        this.closeSubjectSearch();

        // The input blurs (while still empty) just before this fills in the
        // value, so lightning-input flags itself invalid on that blur.
        // Re-check validity once the new value has rendered so the error
        // clears without the user needing to click back into the field.
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
        this._refreshSubjectPortal(rowId);
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
                updated.waitingOnDraftId = undefined;
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
        this._lastUserFocusSearchAt = Date.now();
        const keyword = this._activeAssigneeRowId === rowId ? (this.userSearchKeyword || '') : '';
        this.searchUsersInternal(rowId, keyword);
    }

    handleUserClick(e) {
        const rowId = e.currentTarget.dataset.id;
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
        this.closeUserSearch();
    }

    handleSearchAreaClick(e) {
        e.stopPropagation();
    }

    handleModalOutsideSearchClick() {
        this.closeUserSearch();
        this.closeSubjectSearch();
        this.closeWaitingSearch();
        this.closeStepSearch();
        this.closeReviewerSearch();
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
        const requestId = (this.userSearchRequestId || 0) + 1;
        this.userSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (this._activeAssigneeRowId !== rowId || requestId !== this.userSearchRequestId) return;

            const row = this.draftTasks.find(t => t._id === rowId);
            const selectedIds = row ? row.selectedUserIds : new Set();
            this.userResults = results.filter(user => !selectedIds.has(user.Id));
            this._refreshAssigneePortal(rowId);
        } catch (err) {
            if (this._activeAssigneeRowId === rowId && requestId === this.userSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load users',
                    message: err?.body?.message || 'An error occurred while searching users.',
                    variant: 'error'
                }));
                this.userResults = [];
                this._refreshAssigneePortal(rowId);
            }
        }
    }

    _refreshAssigneePortal(rowId) {
        this._showPortal(
            `assignee-search-container-${rowId}`,
            this.userResults,
            (btn, u) => { btn.textContent = u.Name; },
            (u) => this._addUser(rowId, u)
        );
    }

    closeUserSearch() {
        this._activeAssigneeRowId = undefined;
        this.userSearchRequestId = (this.userSearchRequestId || 0) + 1;
        this.userResults = [];
        this.userSearchKeyword = '';
        clearTimeout(this.userSearchTimeout);
        this._hidePortal();
    }

    /* -------------------------
       Attendee Selection
    -------------------------- */

    _addUser(rowId, u) {
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
       Attachments (drag & drop) - same pattern as eventCreateModalActionRefactor,
       scoped per row via data-id since a batch can hold several draft tasks,
       each carrying its own files.
    -------------------------- */

    handleDropZoneClick(e) {
        const rowId = e.currentTarget.dataset.id;
        this.template.querySelector(`input[data-file-input-id="${rowId}"]`)?.click();
    }

    handleDragOver(e) {
        e.preventDefault();
        const rowId = e.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, isDragOver: true } : t));
    }

    handleDragLeave(e) {
        const rowId = e.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, isDragOver: false } : t));
    }

    handleDrop(e) {
        e.preventDefault();
        const rowId = e.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, isDragOver: false } : t));
        this._processFiles(rowId, Array.from(e.dataTransfer.files));
    }

    handleFileChange(e) {
        const rowId = e.currentTarget.dataset.id;
        this._processFiles(rowId, Array.from(e.target.files));
    }

    handleRemoveStagedFile(e) {
        const rowId = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        const row = this.draftTasks.find(t => t._id === rowId);
        const removed = row?.stagedFiles.find(f => f.name === name);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);

        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, stagedFiles: t.stagedFiles.filter(f => f.name !== name) }
            : t));
    }

    // Read files immediately on selection - before LWS wraps File objects in
    // a reactive proxy that blocks FileReader. Stores base64 directly so
    // saveAll()/the edit-mode save can pass them straight to Apex. Also
    // stamps a local blob preview URL so a dropped file can be viewed
    // before it's actually saved as a real Salesforce File.
    _processFiles(rowId, files) {
        const row = this.draftTasks.find(t => t._id === rowId);
        if (!row) return;

        const oversized = files.filter(f => f.size > MAX_FILE_BYTES);
        const valid = files.filter(f => f.size <= MAX_FILE_BYTES);
        const fileWarning = oversized.length > 0
            ? `File(s) exceed the 5 MB limit and were removed: ${oversized.map(f => f.name).join(', ')}`
            : '';
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, fileWarning } : t));

        if (valid.length === 0) return;

        const existingNames = new Set(row.stagedFiles.map(f => f.name));
        const toRead = valid.filter(f => !existingNames.has(f.name));
        if (toRead.length === 0) return;

        // Built defensively, file by file - a single file's Blob URL failing
        // (seen for some non-image types under certain browser/security-
        // extension configurations) used to throw out of the surrounding
        // .map() and abort the whole batch before the Promise.all below ever
        // ran, silently dropping every file in the drop/selection with no
        // error surfaced anywhere.
        const previewUrlByName = new Map();
        toRead.forEach(f => {
            try {
                previewUrlByName.set(f.name, URL.createObjectURL(f));
            } catch (e) {
                console.error('taskCreateModalAction: could not create preview URL for', f.name, e);
            }
        });

        Promise.all(
            toRead.map(f => this._readFileAsBase64(f).catch(e => {
                console.error('taskCreateModalAction: could not read file', f.name, e);
                return { _failed: true, name: f.name };
            }))
        ).then(results => {
            const failed = results.filter(r => r._failed);
            const succeeded = results.filter(r => !r._failed)
                .map(r => ({ ...r, previewUrl: previewUrlByName.get(r.name) }));
            this.draftTasks = this.draftTasks.map(t => {
                if (t._id !== rowId) return t;
                const stagedFiles = succeeded.length > 0 ? [...t.stagedFiles, ...succeeded] : t.stagedFiles;
                const nextWarning = failed.length > 0
                    ? `Failed to read: ${failed.map(f => f.name).join(', ')}`
                    : t.fileWarning;
                return { ...t, stagedFiles, fileWarning: nextWarning };
            });

            // A toast alongside the existing inline warning text - the inline
            // text lives below a drop zone that's easy to miss, and this
            // exact silent-failure symptom (no banner, no visible error) is
            // what's currently being investigated.
            if (failed.length > 0) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not attach file(s)',
                    message: `Failed to read: ${failed.map(f => f.name).join(', ')}`,
                    variant: 'error'
                }));
            }
        }).catch(e => {
            console.error('taskCreateModalAction: unexpected error processing files', e);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not attach file(s)',
                message: e?.message || 'An unexpected error occurred while attaching the file(s). Check the browser console for details.',
                variant: 'error'
            }));
        });
    }

    _readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: file.name,
                base64Data: reader.result.split(',')[1],
                contentType: file.type || 'application/octet-stream'
            });
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /* -------------------------
       Waiting On Task (only shown when a row's Status = Waiting)
    -------------------------- */

    // Dead entry point kept as-is (pre-existing, unused) - handleWaitingFocus
    // calls searchTasksInternal directly instead.
    openWaitingSearch(rowId) {
        this._activeWaitingRowId = rowId;
    }

    closeWaitingSearch() {
        this._activeWaitingRowId = undefined;
        this.waitingSearchRequestId = (this.waitingSearchRequestId || 0) + 1;
        this.waitingResults = [];
        this.waitingSearchKeyword = '';
        clearTimeout(this.waitingSearchTimeout);
        this._hidePortal();
    }

    handleWaitingFocus(e) {
        const rowId = e.currentTarget.dataset.id;
        const keyword = this._activeWaitingRowId === rowId ? (this.waitingSearchKeyword || '') : '';
        this.searchTasksInternal(rowId, keyword);
    }

    handleWaitingBlur() {
        this.closeWaitingSearch();
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

    // Same shape as _taskMetaLabel(), but for an in-progress draft row rather
    // than an already-saved Task record.
    _draftMetaLabel(draft) {
        const owner = draft.selectedUsers && draft.selectedUsers.length > 0 ? draft.selectedUsers[0].name : 'Unassigned';
        const due = draft.activityDate ? `Due ${this._formatShortDate(draft.activityDate)}` : 'No due date';
        const parts = [owner, due];
        if (draft.priority === 'High') parts.push('High priority');
        return parts.join(' · ');
    }

    async searchTasksInternal(rowId, keyword) {
        this._activeWaitingRowId = rowId;
        this.waitingSearchKeyword = keyword;
        const requestId = (this.waitingSearchRequestId || 0) + 1;
        this.waitingSearchRequestId = requestId;

        try {
            const results = await searchTasksForMatter({ matterId: this.recordId, keyword });

            if (this._activeWaitingRowId !== rowId || requestId !== this.waitingSearchRequestId) return;

            this.waitingResults = results.map(r => ({ ...r, metaLabel: this._taskMetaLabel(r) }));
            this._refreshWaitingPortal(rowId);
        } catch (err) {
            if (this._activeWaitingRowId === rowId && requestId === this.waitingSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load tasks',
                    message: err?.body?.message || 'An error occurred while searching tasks.',
                    variant: 'error'
                }));
                this.waitingResults = [];
                this._refreshWaitingPortal(rowId);
            }
        }
    }

    _refreshWaitingPortal(rowId) {
        this._showPortal(
            `waiting-search-container-${rowId}`,
            this.waitingResults,
            (btn, task) => {
                btn.classList.add('dropdown-item--task');
                const title = document.createElement('span');
                title.className = 'dropdown-item-title';
                title.textContent = task.Subject;
                const meta = document.createElement('span');
                meta.className = 'dropdown-item-meta';
                meta.textContent = task.metaLabel;
                btn.appendChild(title);
                btn.appendChild(meta);
            },
            (task) => this._selectWaitingOnTask(rowId, task)
        );
    }

    _selectWaitingOnTask(rowId, task) {
        const label = `${task.Subject} — ${task.metaLabel}`;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, waitingOnTaskId: task.Id, waitingOnDraftId: undefined, waitingOnTaskLabel: label }
            : t));

        this.closeWaitingSearch();
    }

    // Lets a row wait on another draft task in the same batch, which won't
    // have a real Id yet - see saveAll() for how this gets resolved on save.
    selectWaitingOnDraft(e) {
        const rowId = e.currentTarget.dataset.id;
        const draftId = e.currentTarget.dataset.draftId;
        const index = this.draftTasks.findIndex(t => t._id === draftId);
        const target = index >= 0 ? this.draftTasks[index] : null;

        if (!target) return;

        const title = `Task ${index + 1}${target.subject ? ': ' + target.subject : ''}`;
        const label = `${title} — ${this._draftMetaLabel(target)}`;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, waitingOnDraftId: draftId, waitingOnTaskId: undefined, waitingOnTaskLabel: label }
            : t));

        this.closeWaitingSearch();
    }

    clearWaitingOnTask(e) {
        const rowId = e.currentTarget.dataset.id;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, waitingOnTaskId: undefined, waitingOnDraftId: undefined, waitingOnTaskLabel: '' }
            : t));
    }

    /* -------------------------
       Reviewer (optional) - same search-a-person pattern as Assignee.
       When set, completing this task sends it to this person for review
       instead of marking it Completed outright.
    -------------------------- */

    handleReviewerFocus(e) {
        const rowId = e.currentTarget.dataset.id;
        const keyword = this._activeReviewerRowId === rowId ? (this.reviewerSearchKeyword || '') : '';
        this.searchReviewerInternal(rowId, keyword);
    }

    handleReviewerBlur() {
        this.closeReviewerSearch();
    }

    handleReviewerSearch(e) {
        const rowId = e.currentTarget.dataset.id;
        clearTimeout(this.reviewerSearchTimeout);

        const val = e.target.value;
        this.reviewerSearchKeyword = val || '';
        this._activeReviewerRowId = rowId;

        this.reviewerSearchTimeout = setTimeout(() => {
            this.searchReviewerInternal(rowId, val || '');
        }, 300);
    }

    handleReviewerKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rowId = e.currentTarget.dataset.id;
            const keyword = e.target.value || '';
            this.reviewerSearchKeyword = keyword;
            this.searchReviewerInternal(rowId, keyword);
        }
    }

    async searchReviewerInternal(rowId, keyword) {
        this._activeReviewerRowId = rowId;
        this.reviewerSearchKeyword = keyword;
        const requestId = (this.reviewerSearchRequestId || 0) + 1;
        this.reviewerSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (this._activeReviewerRowId !== rowId || requestId !== this.reviewerSearchRequestId) return;

            this.reviewerResults = results;
            this._refreshReviewerPortal(rowId);
        } catch (err) {
            if (this._activeReviewerRowId === rowId && requestId === this.reviewerSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load users',
                    message: err?.body?.message || 'An error occurred while searching users.',
                    variant: 'error'
                }));
                this.reviewerResults = [];
                this._refreshReviewerPortal(rowId);
            }
        }
    }

    _refreshReviewerPortal(rowId) {
        this._showPortal(
            `reviewer-search-container-${rowId}`,
            this.reviewerResults,
            (btn, u) => { btn.textContent = u.Name; },
            (u) => this._selectReviewer(rowId, u)
        );
    }

    closeReviewerSearch() {
        this._activeReviewerRowId = undefined;
        this.reviewerSearchRequestId = (this.reviewerSearchRequestId || 0) + 1;
        this.reviewerResults = [];
        this.reviewerSearchKeyword = '';
        clearTimeout(this.reviewerSearchTimeout);
        this._hidePortal();
    }

    _selectReviewer(rowId, u) {
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId
            ? { ...t, selectedReviewer: { id: u.Id, name: u.Name } }
            : t));
        this.closeReviewerSearch();
    }

    removeReviewer(e) {
        const rowId = e.target.dataset.rowId;
        this.draftTasks = this.draftTasks.map(t => (t._id === rowId ? { ...t, selectedReviewer: null } : t));
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

        // Only enforced when newly creating a Waiting task here - an existing
        // task being edited/reassigned may already be Waiting for reasons
        // outside this field (e.g. a subtask-template chain step), and
        // shouldn't be forced to backfill an unrelated ad hoc dependency
        // just to save an edit to its owner/subject/due date/etc.
        if (!this.isEditMode && this.draftTasks.some(t => t.status === 'Waiting' && !t.waitingOnTaskId && !t.waitingOnDraftId)) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Please select which task each Waiting task is waiting on.',
                variant: 'error'
            }));
            return;
        }

        if (this.isEditMode) {
            await this._saveEdit();
            return;
        }

        this.isSaving = true;
        try {
            // Saved one at a time, top to bottom, rather than in parallel -
            // a task waiting on another draft task earlier in this same batch
            // needs that task's real Id, which only exists once it's saved.
            const savedIdByDraftId = new Map();
            const results = [];

            for (const t of this.draftTasks) {
                if (t.status === 'Waiting' && t.waitingOnDraftId && !savedIdByDraftId.has(t.waitingOnDraftId)) {
                    results.push({ status: 'rejected', reason: { message: 'The task it depends on could not be created.' } });
                    continue;
                }

                const waitingOnTaskId = t.status === 'Waiting'
                    ? (t.waitingOnDraftId ? savedIdByDraftId.get(t.waitingOnDraftId) : (t.waitingOnTaskId || null))
                    : null;

                try {
                    const newId = await saveTask({
                        relatedId: this.recordId,
                        ownerIds: t.selectedUsers.map(u => u.id),
                        subject: t.subject,
                        dueDate: t.activityDate,
                        status: t.status,
                        priority: t.priority,
                        description: t.description,
                        reminderTypes: t.selectedReminderTypes,
                        waitingOnTaskId,
                        attachments: t.stagedFiles,
                        reviewerId: t.selectedReviewer?.id || null
                    });
                    savedIdByDraftId.set(t._id, newId);
                    results.push({ status: 'fulfilled', value: newId });
                } catch (e) {
                    results.push({ status: 'rejected', reason: e });
                }
            }

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

    async _saveEdit() {
        const t = this.draftTasks[0];
        const waitingOnTaskId = t.status === 'Waiting' ? (t.waitingOnTaskId || null) : null;

        this.isSaving = true;
        try {
            await updateTask({
                taskId: this._existingTaskId,
                ownerId: t.selectedUsers[0]?.id,
                subject: t.subject,
                dueDate: t.activityDate,
                status: t.status,
                priority: t.priority,
                description: t.description,
                waitingOnTaskId,
                newAttachments: t.stagedFiles,
                reviewerId: t.selectedReviewer?.id || null
            });

            publish(this.messageContext, TASK_CHANGED, {});

            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Task updated',
                variant: 'success'
            }));
            this.close('success');
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message || 'Please try again.',
                variant: 'error'
            }));
        } finally {
            this.isSaving = false;
        }
    }

    disconnectedCallback() {
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.waitingSearchTimeout);
        clearTimeout(this.stepSearchTimeout);
        clearTimeout(this.reviewerSearchTimeout);
        this._unmountPortal();
        this.draftTasks.forEach(t => t.stagedFiles.forEach(f => {
            if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
        }));
    }

    handleCancel() {
        this.close();
    }
}
