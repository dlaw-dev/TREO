import LightningModal from 'lightning/modal';
import { api, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

import saveTask from '@salesforce/apex/TaskUiController.saveTask';
import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';

import MATTER_NAME from '@salesforce/schema/NEOS_Matter__c.Name';
import TASK_OBJECT from '@salesforce/schema/Task';
import INTERNAL_EXTERNAL_TYPE_FIELD from '@salesforce/schema/Task.Internal_External_Type__c';
import TASK_SUBTYPE_FIELD from '@salesforce/schema/Task.Task_Subtype__c';

import TASK_REMINDER_OBJECT from '@salesforce/schema/Task_Reminder__c';
import REMINDER_TYPE_FIELD from '@salesforce/schema/Task_Reminder__c.Reminder_Type__c';

export default class TaskCreateModalAction extends LightningModal {

    @api recordId;

    subject = '';
    activityDate;
    status = 'Not Started';
    priority = 'Normal';
    description = '';

    taskSubtype = '';
    taskSubtypeIfOther = '';
    internalExternalType = '';

    @track selectedReminderTypes = [];

    /* =========================================================
       REMINDER METADATA (Dynamic Picklist)
    ========================================================= */

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
        return this.reminderPicklist?.data?.values || [];
    }

    get isReminderDisabled() {
        return !this.activityDate;
    }

    handleReminderChange(event) {
        this.selectedReminderTypes = event.detail.value;
    }

    /* =========================================================
       RELATED RECORD
    ========================================================= */

    @wire(getRecord, { recordId: '$recordId', fields: [MATTER_NAME] })
    matter;

    get recordName() {
        return this.matter?.data?.fields?.Name?.value;
    }

    get hasSelectedAssignee() {
        return this.selectedUsers.length > 0;
    }

    /* =========================================================
       TASK METADATA (Fixed Task Subtype)
    ========================================================= */

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
        return this.taskSubtypePicklist?.data?.values || [];
    }

    @wire(getPicklistValues, {
        recordTypeId: '$taskRecordTypeId',
        fieldApiName: INTERNAL_EXTERNAL_TYPE_FIELD
    })
    internalExternalTypePicklist;

    get internalExternalTypeOptions() {
        return this.internalExternalTypePicklist?.data?.values || [];
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

    /* =========================================================
       STATIC PICKLISTS
    ========================================================= */

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
            { label: 'Low', value: 'Low' },
            { label: 'Normal', value: 'Normal' },
            { label: 'High', value: 'High' }
        ];
    }

    /* =========================================================
       FIELD HANDLERS
    ========================================================= */

    handleSubject(e) { this.subject = e.target.value; }

    handleDueDate(e) {
        this.activityDate = e.target.value;

        // Clear reminders if due date removed
        if (!this.activityDate) {
            this.selectedReminderTypes = [];
        }
    }

    handleStatus(e) { this.status = e.target.value; }
    handlePriority(e) { this.priority = e.target.value; }
    handleDescription(e) { this.description = e.target.value; }
    handleTaskSubtype(e) {
        this.taskSubtype = e.detail.value;

        if (!this.showTaskSubtypeIfOther) {
            this.taskSubtypeIfOther = '';
        }
    }
    handleTaskSubtypeIfOther(e) { this.taskSubtypeIfOther = e.target.value; }
    handleInternalExternalType(e) { this.internalExternalType = e.detail.value; }

    /* =========================================================
       USER SEARCH
    ========================================================= */

    @track userResults = [];
    @track selectedUsers = [];
    selectedUserIds = new Set();
    userSearchTimeout;

    handleUserFocus() {
        this.performUserSearch('');
    }

    handleUserSearch(event) {
        const keyword = event.target.value;
        clearTimeout(this.userSearchTimeout);

        this.userSearchTimeout = setTimeout(() => {
            this.performUserSearch(keyword);
        }, 300);
    }

    async performUserSearch(keyword) {
        try {
            const results = await searchUsers({ keyword });

            this.userResults = results.filter(
                u => !this.selectedUserIds.has(u.Id)
            );

        } catch (error) {
            console.error(error);
        }
    }

    addUser(event) {
        const userId = event.currentTarget.dataset.id;
        const user = this.userResults.find(u => u.Id === userId);
        if (!user) return;

        this.selectedUsers = [{
            id: user.Id,
            name: user.Name
        }];

        this.selectedUserIds.clear();
        this.selectedUserIds.add(user.Id);
        this.userResults = [];
    }

    removeUser(event) {
        const userId = event.currentTarget.dataset.id;

        this.selectedUsers = this.selectedUsers.filter(
            u => u.id !== userId
        );

        this.selectedUserIds.delete(userId);
    }

    validateTaskSubtypeIfOther() {
        if (!this.showTaskSubtypeIfOther) {
            return true;
        }

        const input = this.template.querySelector(
            'lightning-input[data-id="taskSubtypeIfOther"]'
        );

        if (!input) {
            return true;
        }

        input.reportValidity();
        return input.checkValidity();
    }

    /* =========================================================
       SAVE
    ========================================================= */

    async handleSave() {
        try {

            if (!this.hasSelectedAssignee) {
                throw new Error('Please select an Assignee.');
            }

            if (!this.activityDate && this.selectedReminderTypes.length > 0) {
                throw new Error('Please set a Due Date before adding reminders.');
            }

            if (!this.validateTaskSubtypeIfOther()) {
                return;
            }

            const ownerId = this.selectedUsers[0].id;

            await saveTask({
                relatedId: this.recordId,
                ownerId: ownerId,
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

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Success',
                    message: 'Task created',
                    variant: 'success'
                })
            );

            this.close('success');

        } catch (error) {
            console.error(error);

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Error',
                    message: error?.body?.message || error.message,
                    variant: 'error'
                })
            );
        }
    }

    handleCancel() {
        this.close();
    }
}
