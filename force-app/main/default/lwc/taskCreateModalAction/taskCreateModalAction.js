import LightningModal from 'lightning/modal';
import { api, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import { publish, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';

import saveTask from '@salesforce/apex/TaskUiController.saveTask';
import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';
import searchGroups from '@salesforce/apex/EventAttendeeUiController.searchGroups';
import getGroupUsers from '@salesforce/apex/EventAttendeeUiController.getGroupUsers';

import MATTER_NAME from '@salesforce/schema/NEOS_Matter__c.Name';
import TASK_OBJECT from '@salesforce/schema/Task';
import INTERNAL_EXTERNAL_TYPE_FIELD from '@salesforce/schema/Task.Internal_External_Type__c';
import TASK_SUBTYPE_FIELD from '@salesforce/schema/Task.Task_Subtype__c';

import TASK_REMINDER_OBJECT from '@salesforce/schema/Task_Reminder__c';
import REMINDER_TYPE_FIELD from '@salesforce/schema/Task_Reminder__c.Reminder_Type__c';

const SEARCH_FOCUS_CLICK_WINDOW_MS = 200;
const SEARCH_BLUR_CLOSE_DELAY_MS = 150;

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

    _initialStatus;
    @api get initialStatus() { return this._initialStatus; }
    set initialStatus(val) { this._initialStatus = val; if (val != null) this.status = val; }

    _initialPriority;
    @api get initialPriority() { return this._initialPriority; }
    set initialPriority(val) { this._initialPriority = val; if (val != null) this.priority = val; }

    _initialDescription;
    @api get initialDescription() { return this._initialDescription; }
    set initialDescription(val) { this._initialDescription = val; if (val != null) this.description = val; }

    _initialTaskSubtype;
    @api get initialTaskSubtype() { return this._initialTaskSubtype; }
    set initialTaskSubtype(val) { this._initialTaskSubtype = val; if (val != null) this.taskSubtype = val; }

    _initialTaskSubtypeIfOther;
    @api get initialTaskSubtypeIfOther() { return this._initialTaskSubtypeIfOther; }
    set initialTaskSubtypeIfOther(val) { this._initialTaskSubtypeIfOther = val; if (val != null) this.taskSubtypeIfOther = val; }

    _initialInternalExternalType;
    @api get initialInternalExternalType() { return this._initialInternalExternalType; }
    set initialInternalExternalType(val) { this._initialInternalExternalType = val; if (val != null) this.internalExternalType = val; }

    _initialAssignees = [];
    @api get initialAssignees() { return this._initialAssignees; }
    set initialAssignees(val) {
        this._initialAssignees = val || [];
        if (Array.isArray(this._initialAssignees)) {
            for (const a of this._initialAssignees) {
                if (a.id && !this.selectedUserIds.has(a.id)) {
                    this.selectedUserIds.add(a.id);
                    this.selectedUsers = [...this.selectedUsers, { id: a.id, name: a.name }];
                }
            }
        }
    }

    subject = '';
    activityDate;
    status = 'Not Started';
    priority = 'Normal';
    description = '';

    taskSubtype = '';
    taskSubtypeIfOther = '';
    internalExternalType = '';

    @track selectedReminderTypes = [];

    isSaving = false;

    @wire(MessageContext) messageContext;

    /* -------------------------
       Related Record
    -------------------------- */

    @wire(getRecord, { recordId: '$recordId', fields: [MATTER_NAME] })
    matter;

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

    get isReminderDisabled() {
        return !this.activityDate;
    }

    handleReminderChange(event) {
        this.selectedReminderTypes = event.detail.value;
    }

    /* -------------------------
       Task Metadata
    -------------------------- */

    @wire(getObjectInfo, { objectApiName: TASK_OBJECT })
    taskMetadata;

    get taskRecordTypeId() {
        return this.taskMetadata?.data?.defaultRecordTypeId || '012000000000000AAA';
    }

    @wire(getPicklistValues, {
        recordTypeId: '$taskRecordTypeId',
        fieldApiName: TASK_SUBTYPE_FIELD
    })
    taskSubtypePicklist;

    get taskSubtypeOptions() {
        return this.taskSubtypePicklist?.data?.values ?? [];
    }

    @wire(getPicklistValues, {
        recordTypeId: '$taskRecordTypeId',
        fieldApiName: INTERNAL_EXTERNAL_TYPE_FIELD
    })
    internalExternalTypePicklist;

    get internalExternalTypeOptions() {
        return this.internalExternalTypePicklist?.data?.values ?? [];
    }

    get selectedTaskSubtypeOption() {
        return this.taskSubtypeOptions.find(
            option => option.value === this.taskSubtype
        );
    }

    get showTaskSubtypeIfOther() {
        const selectedValue = (this.taskSubtype || '').trim().toLowerCase();
        const selectedLabel = (
            this.selectedTaskSubtypeOption?.label || ''
        ).trim().toLowerCase();

        return selectedValue === 'other' || selectedLabel === 'other';
    }

    /* -------------------------
       Static Picklists
    -------------------------- */

    get statusOptions() {
        return [
            { label: 'Not Started', value: 'Not Started' },
            { label: 'In Progress', value: 'In Progress' },
            { label: 'Open', value: 'Open' },
            { label: 'Completed', value: 'Completed' }
        ];
    }

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

    /* -------------------------
       Field Handlers
    -------------------------- */

    handleSubject = e => this.subject = e.target.value;
    handleDueDate = e => {
        this.activityDate = e.target.value;

        if (!this.activityDate) {
            this.selectedReminderTypes = [];
        }
    };
    handleStatus = e => this.status = e.target.value;
    handlePriority = e => this.priority = e.target.value;
    handleDescription = e => this.description = e.target.value;
    handleTaskSubtype = e => {
        this.taskSubtype = e.detail.value;

        if (!this.showTaskSubtypeIfOther) {
            this.taskSubtypeIfOther = '';
        }
    };
    handleTaskSubtypeIfOther = e => this.taskSubtypeIfOther = e.target.value;
    handleInternalExternalType = e => this.internalExternalType = e.detail.value;

    /* -------------------------
       Attendees
    -------------------------- */

    @track userResults = [];
    @track groupResults = [];
    @track selectedUsers = [];

    selectedUserIds = new Set();
    isSavingSearch = false;

    userSearchTimeout;
    groupSearchTimeout;
    userSearchKeyword = '';
    groupSearchKeyword = '';

    isUserSearchOpen = false;
    isGroupSearchOpen = false;
    userSearchRequestId = 0;
    groupSearchRequestId = 0;
    userBlurTimeout;
    groupBlurTimeout;
    searchDropdownInteractionTimeout;

    get hasUserResults() {
        return this.userResults.length > 0;
    }

    get hasGroupResults() {
        return this.groupResults.length > 0;
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

    handleGroupFocus() {
        if (this._skipNextGroupFocus) {
            this._skipNextGroupFocus = false;
            return;
        }
        clearTimeout(this.groupBlurTimeout);
        this._lastGroupFocusSearchAt = Date.now();
        this.searchGroupsInternal(this.groupSearchKeyword || '');
    }

    handleGroupClick() {
        clearTimeout(this.groupBlurTimeout);
        this._skipNextGroupFocus = false;

        if (
            this.isGroupSearchOpen &&
            this.groupResults.length > 0 &&
            Date.now() - (this._lastGroupFocusSearchAt || 0) < SEARCH_FOCUS_CLICK_WINDOW_MS
        ) {
            return;
        }

        this.searchGroupsInternal(this.groupSearchKeyword || '');
    }

    handleGroupBlur() {
        if (this._isInteractingWithSearchDropdown) return;

        clearTimeout(this.groupBlurTimeout);
        this.groupBlurTimeout = setTimeout(() => {
            this.closeGroupSearch();
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
        this.closeGroupSearch();
    }

    handleUserSearch(e) {
        clearTimeout(this.userSearchTimeout);

        const val = e.target.value;
        this.userSearchKeyword = val || '';

        this.userSearchTimeout = setTimeout(() => {
            this.searchUsersInternal(val || '');
        }, 300);
    }

    handleGroupSearch(e) {
        clearTimeout(this.groupSearchTimeout);

        const val = e.target.value;
        this.groupSearchKeyword = val || '';

        this.groupSearchTimeout = setTimeout(() => {
            this.searchGroupsInternal(val || '');
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

    handleGroupKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const keyword = e.target.value || '';
            this.groupSearchKeyword = keyword;
            this.searchGroupsInternal(keyword);
        }
    }

    async searchUsersInternal(keyword) {
        this.isUserSearchOpen = true;
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

    async searchGroupsInternal(keyword) {
        this.isGroupSearchOpen = true;
        const requestId = (this.groupSearchRequestId || 0) + 1;
        this.groupSearchRequestId = requestId;

        const existingGroupsById = new Map(
            this.groupResults.map(group => [group.Id, group])
        );

        try {
            const results = await searchGroups({ keyword });

            if (!this.isGroupSearchOpen || requestId !== this.groupSearchRequestId) return;

            this.groupResults = results.map(group =>
                this.buildGroupResult(group, existingGroupsById.get(group.Id))
            );

            this.syncGroupMembersSelection();
        } catch (err) {
            if (this.isGroupSearchOpen && requestId === this.groupSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load groups',
                    message: err?.body?.message || 'An error occurred while searching groups.',
                    variant: 'error'
                }));
                this.groupResults = [];
            }
        }
    }

    closeUserSearch() {
        this.isUserSearchOpen = false;
        this.userSearchRequestId = (this.userSearchRequestId || 0) + 1;
        this.userResults = [];
        clearTimeout(this.userSearchTimeout);
    }

    closeGroupSearch() {
        this.isGroupSearchOpen = false;
        this.groupSearchRequestId = (this.groupSearchRequestId || 0) + 1;
        this.groupResults = [];
        clearTimeout(this.groupSearchTimeout);
    }

    /* -------------------------
       Attendee Selection
    -------------------------- */

    addUser(e) {
        const id = e.currentTarget.dataset.id;

        if (this.selectedUserIds.has(id)) return;

        const u = this.userResults.find(x => x.Id === id);

        if (!u) return;

        this.addSelectedUser(u, true);
    }

    addUserFromGroup(e) {
        const userId = e.currentTarget.dataset.id;

        if (this.selectedUserIds.has(userId)) return;

        let user;

        for (const group of this.groupResults) {
            user = (group.members || []).find(member => member.Id === userId);
            if (user) break;
        }

        if (!user) return;

        this.addSelectedUser(user);
    }

    addSelectedUser(user, keepUserSearchOpen = false) {
        this.selectedUserIds.add(user.Id);

        this.selectedUsers = [...this.selectedUsers, { id: user.Id, name: user.Name }];

        this.syncGroupMembersSelection();

        if (keepUserSearchOpen) {
            this.userSearchKeyword = '';
            this.closeUserSearch();
        } else {
            this.closeUserSearch();
        }
    }

    removeUser(e) {
        const id = e.target.dataset.id;

        this.selectedUserIds.delete(id);
        this.selectedUsers = this.selectedUsers.filter(u => u.id !== id);

        this.syncGroupMembersSelection();
    }

    async toggleGroupMembers(e) {
        const id = e.currentTarget.dataset.id;
        const group = this.groupResults.find(item => item.Id === id);

        if (!group) return;

        if (group.membersLoaded) {
            this.updateGroupResult(id, {
                isExpanded: !group.isExpanded,
                memberToggleLabel: group.isExpanded ? 'Show users' : 'Hide users'
            });
            return;
        }

        this.updateGroupResult(id, {
            isExpanded: true,
            isLoadingMembers: true,
            memberToggleLabel: 'Hide users'
        });

        try {
            const members = await getGroupUsers({ groupId: id });

            this.updateGroupResult(id, {
                members: members.map(member => this.buildGroupMember(member)),
                membersLoaded: true,
                isLoadingMembers: false,
                showNoMembers: members.length === 0
            });
        } catch (error) {
            this.updateGroupResult(id, {
                isExpanded: false,
                isLoadingMembers: false,
                memberToggleLabel: 'Show users'
            });

            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: error?.body?.message || error.message,
                variant: 'error'
            }));
        }
    }

    buildGroupResult(group, existingGroup) {
        return {
            ...group,
            isExpanded: existingGroup?.isExpanded || false,
            isLoadingMembers: false,
            membersLoaded: existingGroup?.membersLoaded || false,
            members: (existingGroup?.members || []).map(member => this.buildGroupMember(member)),
            memberToggleLabel: existingGroup?.isExpanded ? 'Hide users' : 'Show users',
            showNoMembers: existingGroup?.showNoMembers || false
        };
    }

    buildGroupMember(member) {
        const isSelected = this.selectedUserIds.has(member.Id);

        return {
            ...member,
            isSelected,
            actionLabel: isSelected ? 'Selected' : 'Add'
        };
    }

    updateGroupResult(id, changes) {
        this.groupResults = this.groupResults.map(group =>
            group.Id === id ? { ...group, ...changes } : group
        );
    }

    syncGroupMembersSelection() {
        this.groupResults = this.groupResults.map(group => ({
            ...group,
            members: (group.members || []).map(member => this.buildGroupMember(member)),
            showNoMembers: group.membersLoaded && (group.members || []).length === 0
        }));
    }

    /* -------------------------
       Validation
    -------------------------- */

    validateTaskSubtypeIfOther() {
        if (!this.showTaskSubtypeIfOther) {
            return true;
        }

        const input = this.template.querySelector(
            'lightning-input[data-id="taskSubtypeIfOther"]'
        );

        if (!input) return true;

        input.reportValidity();
        return input.checkValidity();
    }

    /* -------------------------
       Save
    -------------------------- */

    async _performSave() {
        if (!this.hasSelectedAssignee) {
            throw new Error('Please select an Assignee.');
        }

        if (!this.activityDate && this.selectedReminderTypes.length > 0) {
            throw new Error('Please set a Due Date before adding reminders.');
        }

        if (!this.validateTaskSubtypeIfOther()) {
            return false;
        }

        await saveTask({
            relatedId: this.recordId,
            ownerIds: this.selectedUsers.map(u => u.id),
            subject: this.subject,
            dueDate: this.activityDate,
            status: this.status,
            priority: this.priority,
            description: this.description,
            taskSubtype: this.taskSubtype,
            taskSubtypeIfOther: this.taskSubtypeIfOther,
            internalExternalType: this.internalExternalType,
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
        this.status                 = 'Not Started';
        this.priority               = 'Normal';
        this.description            = '';
        this.taskSubtype            = '';
        this.taskSubtypeIfOther     = '';
        this.internalExternalType   = '';
        this.selectedReminderTypes  = [];
        this.selectedUsers          = [];
        this.selectedUserIds        = new Set();
        this.userResults            = [];
        this.groupResults           = [];
        this.userSearchKeyword      = '';
        this.groupSearchKeyword     = '';
        this.closeUserSearch();
        this.closeGroupSearch();
    }

    disconnectedCallback() {
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.groupSearchTimeout);
        clearTimeout(this.userBlurTimeout);
        clearTimeout(this.groupBlurTimeout);
        clearTimeout(this.searchDropdownInteractionTimeout);
    }

    handleCancel() {
        this.close();
    }
}
