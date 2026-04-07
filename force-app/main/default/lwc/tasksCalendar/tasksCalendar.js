import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import { refreshApex } from '@salesforce/apex';

import getTasksForMatter from '@salesforce/apex/TaskCalendarController.getTasksForMatter';

export default class TasksCalendar extends NavigationMixin(LightningElement) {

    @api recordId; // NEOS_Matter__c Id

    tasks = [];
    isLoading = true;
    error;
    wiredResult;

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
        {
    label: 'Due Date',
    fieldName: 'ActivityDate',
    type: 'date-local'
},
        { label: 'Status', fieldName: 'Status', type: 'text' },

        // Task Subtype
        { label: 'Task Subtype', fieldName: 'TaskSubtype', type: 'text' },

        // Priority (moved after subtype)
        { label: 'Priority', fieldName: 'Priority', type: 'text' },

        // Assignee
        { label: 'Assignee', fieldName: 'OwnerName', type: 'text' }
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