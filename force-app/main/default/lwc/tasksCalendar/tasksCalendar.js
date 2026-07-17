import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import { refreshApex } from '@salesforce/apex';
import { subscribe, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';

import getTasksForMatter from '@salesforce/apex/TaskCalendarController.getTasksForMatter';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';

export default class TasksCalendar extends NavigationMixin(LightningElement) {

    @api recordId; // NEOS_Matter__c Id

    tasks = [];
    isLoading = true;
    error;
    wiredResult;

    @wire(MessageContext) messageContext;

    connectedCallback() {
        subscribe(this.messageContext, TASK_CHANGED, () => {
            refreshApex(this.wiredResult);
        });
    }

    columns = [
        {
            label: 'Subject',
            fieldName: 'Subject',
            type: 'button',
            typeAttributes: {
                label: { fieldName: 'Subject' },
                name: 'open_record',
                variant: 'base'
            }
        },
        { label: 'Due Date', fieldName: 'ActivityDate', type: 'date-local' },
        { label: 'Status',      fieldName: 'Status',    type: 'text' },
        { label: 'Priority',    fieldName: 'Priority',  type: 'text' },
        { label: 'Assignee',    fieldName: 'OwnerName', type: 'text' },
        {
            type: 'action',
            typeAttributes: {
                rowActions: [
                    { label: 'Complete',  name: 'complete' },
                    { label: 'Duplicate', name: 'duplicate' }
                ]
            }
        }
    ];

    // ---------- Wire ----------
    @wire(getTasksForMatter, { parentId: '$recordId' })
    wiredTasks(result) {
        this.wiredResult = result;
        const { data, error } = result;

        this.isLoading = false;

        if (data) {
            this.tasks = data;
            this.error = undefined;
        } else if (error) {
            this.tasks = [];
            this.error = error;
            console.error('Error loading tasks', error);
        }
    }

    // ---------- Row Action ----------
    handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;

        if (actionName === 'open_record') {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: {
                    recordId: row.Id,
                    objectApiName: 'Task',
                    actionName: 'view'
                }
            });
        } else if (actionName === 'complete') {
            this.handleCompleteTask(row);
        } else if (actionName === 'duplicate') {
            this.handleDuplicateTask(row);
        }
    }

    async handleCompleteTask(row) {
        try {
            await completeTask({ taskId: row.Id });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Task marked as Completed',
                variant: 'success'
            }));
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        }
    }

    async handleDuplicateTask(row) {
        const result = await TaskCreateModalAction.open({
            size: 'medium',
            recordId: this.recordId,
            initialSubject:              row.Subject,
            initialDueDate:              row.ActivityDate,
            initialPriority:             row.Priority,
            initialDescription:          row.Description,
            initialAssignees:            row.OwnerId ? [{ id: row.OwnerId, name: row.OwnerName }] : []
        });

        if (result === 'success') {
            await refreshApex(this.wiredResult);
        }
    }

    // ---------- Date helpers ----------
    get todayStart() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    toLocalDateStart(activityDate) {
        if (!activityDate) {
            return null;
        }
        return new Date(`${activityDate}T00:00:00`);
    }

    // ---------- Task groupings ----------
    get tasksWithDeadline() {
        return (this.tasks || []).filter(t => !!t.ActivityDate);
    }

    get tasksNoDeadline() {
        return (this.tasks || []).filter(t => !t.ActivityDate);
    }

    get upcomingTasks() {
        const today = this.todayStart;
        return this.tasksWithDeadline.filter(
            t => this.toLocalDateStart(t.ActivityDate) >= today
        );
    }

    get pastTasks() {
        const today = this.todayStart;
        return this.tasksWithDeadline.filter(
            t => this.toLocalDateStart(t.ActivityDate) < today
        );
    }

    // ---------- Sorting ----------
    sortByDateAsc(list) {
        return [...list].sort((a, b) =>
            (a.ActivityDate || '').localeCompare(b.ActivityDate || '')
        );
    }

    sortByDateDesc(list) {
        return [...list].sort((a, b) =>
            (b.ActivityDate || '').localeCompare(a.ActivityDate || '')
        );
    }

    get upcomingTasksSorted() {
        return this.sortByDateAsc(this.upcomingTasks);
    }

    get pastTasksSorted() {
        return this.sortByDateDesc(this.pastTasks);
    }

    get allTasksSorted() {
        const withDeadlineSorted = this.sortByDateAsc(this.tasksWithDeadline);
        return [...withDeadlineSorted, ...(this.tasksNoDeadline || [])];
    }

    // ---------- Counts ----------
    get allCount() {
        return (this.tasks || []).length;
    }

    get upcomingCount() {
        return this.upcomingTasks.length;
    }

    get pastCount() {
        return this.pastTasks.length;
    }

    get noDeadlineCount() {
        return this.tasksNoDeadline.length;
    }

    // ---------- Tab Labels ----------
    get allTabLabel() {
        return `All Tasks (${this.allCount})`;
    }

    get upcomingTabLabel() {
        return `Upcoming Tasks (${this.upcomingCount})`;
    }

    get pastTabLabel() {
        return `Past Tasks (${this.pastCount})`;
    }

    get noDeadlineTabLabel() {
        return `No Due Date (${this.noDeadlineCount})`;
    }

    // ---------- Actions ----------
    async handleRefresh() {
        await refreshApex(this.wiredResult);
    }

    async handleNewTask() {
        const result = await TaskCreateModalAction.open({
            size: 'medium',
            recordId: this.recordId
        });

        if (result === 'success') {
            await refreshApex(this.wiredResult);
        }
    }
}