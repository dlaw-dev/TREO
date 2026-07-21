import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import { refreshApex } from '@salesforce/apex';
import { subscribe, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';

import getTasksForMatter from '@salesforce/apex/TaskCalendarController.getTasksForMatter';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';

const GROUP_LABELS = {
    all:        'All',
    upcoming:   'Upcoming',
    past:       'Past',
    noDeadline: 'No Due Date',
    completed:  'Completed'
};

export default class TasksCalendar extends NavigationMixin(LightningElement) {

    @api recordId; // NEOS_Matter__c Id

    tasks = [];
    displayTasks = [];
    isLoading = true;
    error;
    wiredResult;

    _activeGroup    = 'all';
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

    // ---------- Grouping / filtering / sorting ----------
    _groupTasks(list) {
        const today = this.todayStart;
        switch (this._activeGroup) {
            case 'completed':
                return list.filter(t => t.Status === 'Completed');
            case 'noDeadline':
                return list.filter(t => t.Status !== 'Completed' && !t.ActivityDate);
            case 'upcoming':
                return list.filter(t => t.Status !== 'Completed' && t.ActivityDate && this.toLocalDateStart(t.ActivityDate) >= today);
            case 'past':
                return list.filter(t => t.Status !== 'Completed' && t.ActivityDate && this.toLocalDateStart(t.ActivityDate) < today);
            default:
                return list;
        }
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
            return {
                ...t,
                isCompleted:   t.Status === 'Completed',
                dueLabel:      label,
                dueBadgeClass: cls,
                rowClass:      t.Status === 'Completed' ? 'tasks-row tasks-row--completed' : 'tasks-row'
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
        const grouped  = this._groupTasks(this.tasks || []);
        const filtered = grouped
            .filter(t => !this._priorityFilter || t.Priority === this._priorityFilter)
            .filter(t => this._matchesSearch(t));
        this.displayTasks = this._decorate(this._sortList(filtered));
    }

    get hasTasks() {
        return this.displayTasks.length > 0;
    }

    get tasksHeader() {
        const n = this.displayTasks.length;
        return `Tasks — ${GROUP_LABELS[this._activeGroup]}${n > 0 ? ` (${n})` : ''}`;
    }

    get tasksEmptyMessage() {
        const labels = {
            all:        'on this Matter',
            upcoming:   'upcoming',
            past:       'past due',
            noDeadline: 'without a due date',
            completed:  'completed yet'
        };
        return `No tasks ${labels[this._activeGroup] || ''}`;
    }

    get priorityFilters() {
        const priorities = [...new Set((this.tasks || []).map(t => t.Priority).filter(Boolean))].sort();
        return priorities.map(p => ({ key: p, label: p }));
    }

    // ---------- Group filter bar ----------
    get groupCounts() {
        const tasks       = this.tasks || [];
        const today       = this.todayStart;
        const open        = tasks.filter(t => t.Status !== 'Completed');
        const withDueDate = open.filter(t => !!t.ActivityDate);
        return {
            all:        tasks.length,
            upcoming:   withDueDate.filter(t => this.toLocalDateStart(t.ActivityDate) >= today).length,
            past:       withDueDate.filter(t => this.toLocalDateStart(t.ActivityDate) < today).length,
            noDeadline: open.filter(t => !t.ActivityDate).length,
            completed:  tasks.filter(t => t.Status === 'Completed').length
        };
    }

    get groupAllLabel()        { return `All (${this.groupCounts.all})`; }
    get groupUpcomingLabel()   { return `Upcoming (${this.groupCounts.upcoming})`; }
    get groupPastLabel()       { return `Past (${this.groupCounts.past})`; }
    get groupNoDeadlineLabel() { return `No Due Date (${this.groupCounts.noDeadline})`; }
    get groupCompletedLabel()  { return `Completed (${this.groupCounts.completed})`; }

    _groupClass(group) {
        return 'task-filter-btn' + (this._activeGroup === group ? ' task-filter-btn--active' : '');
    }
    get groupAllClass()        { return this._groupClass('all'); }
    get groupUpcomingClass()   { return this._groupClass('upcoming'); }
    get groupPastClass()       { return this._groupClass('past'); }
    get groupNoDeadlineClass() { return this._groupClass('noDeadline'); }
    get groupCompletedClass()  { return this._groupClass('completed'); }

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
    handleGroupFilter(event) {
        this._activeGroup = event.currentTarget.dataset.group;
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
        if (row) {
            this.handleCompleteTask(row);
        }
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