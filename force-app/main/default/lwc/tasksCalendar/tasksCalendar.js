import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import { refreshApex } from '@salesforce/apex';
import { subscribe, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import CURRENT_USER_ID from '@salesforce/user/Id';

import getTasksForMatter from '@salesforce/apex/TaskCalendarController.getTasksForMatter';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';

export default class TasksCalendar extends NavigationMixin(LightningElement) {

    @api recordId; // NEOS_Matter__c Id

    tasks = [];
    displayTasks = [];
    isLoading = true;
    error;
    wiredResult;

    _taskFilter     = '90';
    _showCompleted  = false;
    _searchTerm     = '';
    _priorityFilter = '';
    _sortField      = '';
    _sortDir        = 'asc';

    @wire(MessageContext) messageContext;

    connectedCallback() {
        subscribe(this.messageContext, TASK_CHANGED, () => {
            refreshApex(this.wiredResult);
        });
    }

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
        this._rebuild();
    }

    get hasError() {
        return !!this.error;
    }

    get errorMessage() {
        return this.error?.body?.message || this.error?.message || 'Something went wrong loading tasks.';
    }

    // ---------- Date helpers ----------
    get todayStart() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    toLocalDateStart(activityDate) {
        return activityDate ? new Date(`${activityDate}T00:00:00`) : null;
    }

    // ---------- Range filtering / sorting ----------
    _filterByRange(list) {
        const today = this.todayStart;
        const cutoff = new Date(today);
        if (this._taskFilter === 'week') {
            cutoff.setDate(today.getDate() + (6 - today.getDay()));
        } else if (this._taskFilter === 'month') {
            cutoff.setDate(today.getDate() + 30);
        } else {
            cutoff.setDate(today.getDate() + parseInt(this._taskFilter, 10));
        }
        return list.filter(t => !t.ActivityDate || this.toLocalDateStart(t.ActivityDate) <= cutoff);
    }

    _dueInfo(task, today) {
        if (task.Status === 'Completed') {
            return { label: 'Completed', cls: 'due-badge due-badge--done' };
        }
        if (!task.ActivityDate) {
            return { label: 'No Due Date', cls: 'due-badge due-badge--default' };
        }
        const due  = this.toLocalDateStart(task.ActivityDate);
        const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
        if (diff < 0)   return { label: 'Overdue',         cls: 'due-badge due-badge--overdue' };
        if (diff === 0) return { label: 'Due Today',       cls: 'due-badge due-badge--today' };
        if (diff === 1) return { label: 'Due Tomorrow',    cls: 'due-badge due-badge--tomorrow' };
        if (diff <= 7)  return { label: `Due in ${diff}d`, cls: 'due-badge due-badge--soon' };
        return {
            label: `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            cls:   'due-badge due-badge--default'
        };
    }

    _decorate(list) {
        const today = this.todayStart;
        return list.map(t => {
            const { label, cls } = this._dueInfo(t, today);
            const isAssignee = t.OwnerId === CURRENT_USER_ID;
            const isCompleted = t.Status === 'Completed';
            const isWaiting   = t.Status === 'Waiting';
            return {
                ...t,
                isCompleted,
                isWaiting,
                dueLabel:        label,
                dueBadgeClass:   cls,
                rowClass:        isCompleted ? 'tasks-row tasks-row--completed' : 'tasks-row',
                isAssignee,
                showMarkDone:    !isCompleted && !isWaiting,
                disableMarkDone: !isAssignee,
                markDoneTitle:   isAssignee ? 'Mark as complete' : `Only ${t.OwnerName || 'the assignee'} can complete this task`
            };
        });
    }

    _matchesSearch(t) {
        if (!this._searchTerm) return true;
        return [t.Subject, t.Priority, t.ActivityDate, t.OwnerName]
            .some(v => (v || '').toString().toLowerCase().includes(this._searchTerm));
    }

    _sortList(list) {
        if (!this._sortField) return list;
        const field = this._sortField;
        const dir   = this._sortDir === 'desc' ? -1 : 1;
        return [...list].sort((a, b) => {
            if (field === 'ActivityDate') {
                const av = a.ActivityDate ? this.toLocalDateStart(a.ActivityDate).getTime() : Infinity;
                const bv = b.ActivityDate ? this.toLocalDateStart(b.ActivityDate).getTime() : Infinity;
                return (av - bv) * dir;
            }
            const av = (a[field] || '').toString().toLowerCase();
            const bv = (b[field] || '').toString().toLowerCase();
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        });
    }

    _rebuild() {
        const ranged   = this._filterByRange(this.tasks || []);
        const visible  = this._showCompleted ? ranged : ranged.filter(t => t.Status !== 'Completed');
        const filtered = visible
            .filter(t => !this._priorityFilter || t.Priority === this._priorityFilter)
            .filter(t => this._matchesSearch(t));
        this.displayTasks = this._decorate(this._sortList(filtered));
    }

    get hasTasks() {
        return this.displayTasks.length > 0;
    }

    get tasksHeader() {
        const n = this.displayTasks.length;
        const labels = { week: 'This Week', month: '1 Month', '90': '3 Months', '180': '6 Months', '270': '9 Months', '360': '12 Months' };
        return `Tasks — ${labels[this._taskFilter] || 'This Week'}${n > 0 ? ` (${n})` : ''}`;
    }

    get tasksEmptyMessage() {
        const labels = { week: 'this week', month: 'in the next month', '90': 'in the next 3 months', '180': 'in the next 6 months', '270': 'in the next 9 months', '360': 'in the next 12 months' };
        const scope = this._showCompleted ? 'tasks' : 'open tasks';
        return `No ${scope} ${labels[this._taskFilter] || 'in this period'}`;
    }

    get priorityFilters() {
        const priorities = [...new Set((this.tasks || []).map(t => t.Priority).filter(Boolean))].sort();
        return priorities.map(p => ({ key: p, label: p }));
    }

    // ---------- Date-range filter bar ----------
    get taskFilterWeekClass()  { return 'task-filter-btn' + (this._taskFilter === 'week'  ? ' task-filter-btn--active' : ''); }
    get taskFilter1MClass()    { return 'task-filter-btn' + (this._taskFilter === 'month' ? ' task-filter-btn--active' : ''); }
    get taskFilter3MClass()    { return 'task-filter-btn' + (this._taskFilter === '90'    ? ' task-filter-btn--active' : ''); }
    get taskFilter6MClass()    { return 'task-filter-btn' + (this._taskFilter === '180'   ? ' task-filter-btn--active' : ''); }
    get taskFilter9MClass()    { return 'task-filter-btn' + (this._taskFilter === '270'   ? ' task-filter-btn--active' : ''); }
    get taskFilter12MClass()   { return 'task-filter-btn' + (this._taskFilter === '360'   ? ' task-filter-btn--active' : ''); }

    // ---------- Open / All (completed-visibility) toggle ----------
    get showOpenClass() { return 'task-filter-btn' + (!this._showCompleted ? ' task-filter-btn--active' : ''); }
    get showAllClass()  { return 'task-filter-btn' + (this._showCompleted  ? ' task-filter-btn--active' : ''); }

    handleToggleShowCompleted() {
        this._showCompleted = !this._showCompleted;
        this._rebuild();
    }

    // ---------- Sort icons ----------
    _sortIconFor(field) {
        if (this._sortField !== field) return '';
        return this._sortDir === 'asc' ? ' ▲' : ' ▼';
    }
    get subjectSortIcon()  { return this._sortIconFor('Subject'); }
    get prioritySortIcon() { return this._sortIconFor('Priority'); }
    get dueSortIcon()      { return this._sortIconFor('ActivityDate'); }
    get assigneeSortIcon() { return this._sortIconFor('OwnerName'); }

    // ---------- Handlers ----------
    handleTaskFilter(event) {
        this._taskFilter = event.currentTarget.dataset.filter;
        this._rebuild();
    }

    handleSearch(event) {
        this._searchTerm = (event.target.value || '').trim().toLowerCase();
        this._rebuild();
    }

    handlePriorityFilter(event) {
        this._priorityFilter = event.target.value;
        this._rebuild();
    }

    handleSort(event) {
        const field = event.currentTarget.dataset.field;
        if (this._sortField === field) {
            this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this._sortField = field;
            this._sortDir   = 'asc';
        }
        this._rebuild();
    }

    handleSubjectClick(event) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: event.currentTarget.dataset.id,
                objectApiName: 'Task',
                actionName: 'view'
            }
        });
    }

    handleTaskCompleteBtn(event) {
        const row = (this.tasks || []).find(t => t.Id === event.currentTarget.dataset.id);
        if (!row || row.OwnerId !== CURRENT_USER_ID || row.Status === 'Waiting') {
            return;
        }
        // eslint-disable-next-line no-alert
        if (!window.confirm(`Mark "${row.Subject}" as complete?`)) {
            return;
        }
        this.handleCompleteTask(row);
    }

    handleDuplicateBtn(event) {
        const row = (this.tasks || []).find(t => t.Id === event.currentTarget.dataset.id);
        if (row) {
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