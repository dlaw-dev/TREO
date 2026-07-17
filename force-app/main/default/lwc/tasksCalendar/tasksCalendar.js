import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadStyle } from 'lightning/platformResourceLoader';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import { refreshApex } from '@salesforce/apex';
import { subscribe, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import TASKS_CALENDAR_STYLES from '@salesforce/resourceUrl/tasksCalendarStyles';

import getTasksForMatter from '@salesforce/apex/TaskCalendarController.getTasksForMatter';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';

// Base Lightning components (lightning-button, used for the Subject cell)
// render in their own shadow DOM, so a CSS class from this component can't
// reach their label text. A combining-character overlay strikes the text
// itself, so it survives regardless of shadow boundaries.
const STRIKETHROUGH_COMBINING_CHAR = '\u0336'; // COMBINING LONG STROKE OVERLAY

function strikeThroughText(text) {
    if (!text) return text;
    return Array.from(text)
        .map((ch) => ch + STRIKETHROUGH_COMBINING_CHAR)
        .join('');
}

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

        // cellAttributes.class only ever reaches elements lightning-datatable
        // itself renders directly - the Subject cell's lightning-button
        // renders its label in a further-nested shadow root that a scoped
        // component stylesheet can never select into, no matter the class
        // name. loadStyle injects this as a genuine unscoped <style> tag,
        // and CSS custom properties (unlike selectors) inherit through
        // shadow boundaries, so the button's own styling hooks pick it up.
        loadStyle(this, TASKS_CALENDAR_STYLES).catch((error) => {
            // eslint-disable-next-line no-console
            console.error('Could not load tasksCalendar styles', error);
        });
    }

    columns = [
        {
            label: 'Subject',
            fieldName: 'Subject',
            type: 'button',
            typeAttributes: {
                label: { fieldName: 'displaySubject' },
                name: 'open_record',
                variant: 'base'
            },
            cellAttributes: { class: { fieldName: 'subjectDimClass' } }
        },
        {
            label: 'Due Date',
            fieldName: 'ActivityDate',
            type: 'date-local',
            cellAttributes: { class: { fieldName: 'dimCellClass' } }
        },
        {
            label: 'Status',
            fieldName: 'Status',
            type: 'text',
            cellAttributes: { class: { fieldName: 'dimCellClass' } }
        },
        {
            label: 'Priority',
            fieldName: 'Priority',
            type: 'text',
            cellAttributes: { class: { fieldName: 'dimCellClass' } }
        },
        {
            label: 'Assignee',
            fieldName: 'OwnerName',
            type: 'text',
            cellAttributes: { class: { fieldName: 'dimCellClass' } }
        },
        {
            type: 'action',
            typeAttributes: {
                rowActions: (row, doneCallback) => {
                    const actions = [];
                    if (row.Status !== 'Completed') {
                        actions.push({ label: 'Complete', name: 'complete' });
                    }
                    actions.push({ label: 'Duplicate', name: 'duplicate' });
                    doneCallback(actions);
                }
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

    // Completed tasks get their own tab and are struck through wherever
    // else they still appear (All Tasks) - Upcoming/Past/No Due Date are
    // meant to answer "what's still actionable," so completed items are
    // excluded from those three entirely rather than cluttering them.
    get decoratedTasks() {
        return (this.tasks || []).map(t => ({
            ...t,
            displaySubject: t.Status === 'Completed' ? strikeThroughText(t.Subject) : t.Subject,
            // A custom class in this component's own CSS can't reach these
            // cells - they're rendered deep inside lightning-datatable's own
            // shadow tree. slds-text-color_weak is a real global SLDS
            // utility class, so it actually takes effect there.
            dimCellClass: t.Status === 'Completed' ? 'slds-text-color_weak' : '',
            // The Subject cell is a nested lightning-button, one shadow root
            // further in - slds-text-color_weak alone won't reach its label,
            // so it gets the styling-hook class loaded via tasksCalendarStyles.
            subjectDimClass: t.Status === 'Completed' ? 'completed-task-subject' : ''
        }));
    }

    get openTasks() {
        return this.decoratedTasks.filter(t => t.Status !== 'Completed');
    }

    get completedTasks() {
        return this.decoratedTasks.filter(t => t.Status === 'Completed');
    }

    get tasksWithDeadline() {
        return this.openTasks.filter(t => !!t.ActivityDate);
    }

    get tasksNoDeadline() {
        return this.openTasks.filter(t => !t.ActivityDate);
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
        const allWithDeadline = this.decoratedTasks.filter(t => !!t.ActivityDate);
        const allNoDeadline = this.decoratedTasks.filter(t => !t.ActivityDate);
        return [...this.sortByDateAsc(allWithDeadline), ...allNoDeadline];
    }

    get completedTasksSorted() {
        return this.sortByDateDesc(this.completedTasks);
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

    get completedCount() {
        return this.completedTasks.length;
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

    get completedTabLabel() {
        return `Completed (${this.completedCount})`;
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