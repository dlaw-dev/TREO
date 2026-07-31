import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import LogTimeEntryModal from 'c/logTimeEntryModal';
import { refreshApex } from '@salesforce/apex';
import { subscribe, unsubscribe, publish, MessageContext } from 'lightning/messageService';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import CURRENT_USER_ID from '@salesforce/user/Id';

import getTasksForMatter from '@salesforce/apex/TaskCalendarController.getTasksForMatter';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';
import bypassTask from '@salesforce/apex/TaskUiController.bypassTask';
import approveTask from '@salesforce/apex/TaskUiController.approveTask';
import sendBackTask from '@salesforce/apex/TaskUiController.sendBackTask';

// Matches Task.Review_Feedback__c's actual field length - truncating here
// avoids a raw DML "value too large" error surfacing after the prompt has
// already closed and the typed reason is gone.
const REVIEW_FEEDBACK_MAX_LENGTH = 255;

export default class TasksCalendar extends NavigationMixin(LightningElement) {

    @api recordId; // NEOS_Matter__c Id

    tasks = [];
    displayTasks = [];
    isLoading = true;
    isRefreshing = false;
    error;
    wiredResult;

    _taskFilter     = '90';
    _showCompleted  = false;
    _searchTerm     = '';
    _priorityFilter = '';
    _sortField      = '';
    _sortDir        = 'asc';

    // Guards Mark Done/Skip against a double-click or slow-network double
    // submission - both actions remove the row from view once they resolve,
    // but a second click fired before that happens would otherwise send a
    // second, redundant completeTask/bypassTask call.
    _actionInFlightIds = new Set();

    subscription;

    @wire(MessageContext) messageContext;

    _boundCloseAttachmentMenu;

    connectedCallback() {
        if (!this.subscription) {
            this.subscription = subscribe(this.messageContext, TASK_CHANGED, () => {
                refreshApex(this.wiredResult);
            });
        }

        // handleAttachmentClick already stops propagation on the triggering
        // click, so this only ever fires for a genuine outside click.
        this._boundCloseAttachmentMenu = () => this.closeAttachmentMenu();
        window.addEventListener('click', this._boundCloseAttachmentMenu);
    }

    disconnectedCallback() {
        if (this.subscription) {
            unsubscribe(this.subscription);
            this.subscription = null;
        }

        if (this._boundCloseAttachmentMenu) {
            window.removeEventListener('click', this._boundCloseAttachmentMenu);
            this._boundCloseAttachmentMenu = null;
        }
    }

    closeAttachmentMenu() {
        if (!this.displayTasks.some(t => t.isAttachmentMenuOpen)) return;
        this.displayTasks = this.displayTasks.map(t => ({ ...t, isAttachmentMenuOpen: false }));
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
            const isBypassed = isCompleted && !!t.IsBypassed;
            const isWaiting   = t.Status === 'Waiting';
            const isPendingReview = t.Status === 'Pending Review';
            const isReviewer = !!t.ReviewerId && t.ReviewerId === CURRENT_USER_ID;
            const hasReviewer = !!t.ReviewerId;
            const canReassign = !isCompleted && !isPendingReview && (t.OwnerId === CURRENT_USER_ID || t.CreatedById === CURRENT_USER_ID);
            const isActionInFlight = this._actionInFlightIds.has(t.Id);
            const waitingTitle = t.WaitingOnSubject
                ? `Waiting on "${t.WaitingOnSubject}"${t.WaitingOnOwnerName ? ` (${t.WaitingOnOwnerName})` : ''}`
                : "Waiting on a prior step in this task's chain";
            const attachments = (t.AttachmentDtos || []).map(a => ({
                ...a,
                viewUrl: `/lightning/r/ContentDocument/${a.contentDocumentId}/view`
            }));
            return {
                ...t,
                isCompleted,
                isBypassed,
                isWaiting,
                isPendingReview,
                waitingTitle,
                reviewFeedbackTitle: [
                    t.ReviewerName ? `Pending review by ${t.ReviewerName}` : null,
                    t.ReviewFeedback ? `Last sent back: "${t.ReviewFeedback}"` : null
                ].filter(Boolean).join(' — ') || null,
                dueLabel:        label,
                dueBadgeClass:   cls,
                rowClass:        isCompleted ? 'tasks-row tasks-row--completed' : 'tasks-row',
                isAssignee,
                // Once a step is pending someone else's review, the
                // assignee has nothing left to do until it comes back -
                // same reasoning as excluding Waiting.
                showMarkDone:    !isCompleted && !isWaiting && !isPendingReview,
                disableMarkDone: !isAssignee || isActionInFlight,
                // Completing a reviewed task doesn't actually finish it - it
                // hands off to the Reviewer - so the button should say that
                // plainly rather than claim "Mark Done" and then not do that.
                markDoneLabel:   hasReviewer ? 'Send to Review' : 'Mark Done',
                markDoneTitle:   isAssignee
                    ? (hasReviewer ? `Send to ${t.ReviewerName || 'the Reviewer'} for review` : 'Mark as complete')
                    : `Only ${t.OwnerName || 'the assignee'} can complete this task`,
                canReassign,
                showSkip:        !isCompleted && !isWaiting && !isPendingReview && !!t.IsChainStep && canReassign,
                disableSkip:     isActionInFlight,
                showApprove:     isPendingReview && isReviewer,
                showSendBack:    isPendingReview && isReviewer,
                disableApprove:  isActionInFlight,
                disableSendBack: isActionInFlight,
                attachments,
                hasAttachments:  attachments.length > 0,
                attachmentTitle: attachments.length === 1 ? '1 attachment' : `${attachments.length} attachments`,
                isAttachmentMenuOpen: false
            };
        });
    }

    _matchesSearch(t) {
        if (!this._searchTerm) return true;
        return [t.Subject, t.Priority, t.ActivityDate, t.OwnerName]
            .some(v => (v || '').toString().toLowerCase().includes(this._searchTerm));
    }

    _sortList(list) {
        if (!this._sortField) {
            // Default order (no column header clicked yet): upcoming tasks
            // first, soonest due date at top, with completed tasks pushed
            // to the bottom rather than interleaved among open ones.
            return [...list].sort((a, b) => {
                const aDone = a.Status === 'Completed';
                const bDone = b.Status === 'Completed';
                if (aDone !== bDone) return aDone ? 1 : -1;

                const av = a.ActivityDate ? this.toLocalDateStart(a.ActivityDate).getTime() : Infinity;
                const bv = b.ActivityDate ? this.toLocalDateStart(b.ActivityDate).getTime() : Infinity;
                return av - bv;
            });
        }
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

    _ariaSortFor(field) {
        if (this._sortField !== field) return 'none';
        return this._sortDir === 'asc' ? 'ascending' : 'descending';
    }
    get subjectAriaSort()  { return this._ariaSortFor('Subject'); }
    get priorityAriaSort() { return this._ariaSortFor('Priority'); }
    get dueAriaSort()      { return this._ariaSortFor('ActivityDate'); }
    get assigneeAriaSort() { return this._ariaSortFor('OwnerName'); }

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

    handleSortKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.handleSort(event);
        }
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
        const taskId = event.currentTarget.dataset.id;
        if (this._actionInFlightIds.has(taskId)) return;

        const row = (this.tasks || []).find(t => t.Id === taskId);
        if (!row || row.OwnerId !== CURRENT_USER_ID || row.Status === 'Waiting') {
            return;
        }
        // eslint-disable-next-line no-alert
        if (!window.confirm(`Mark "${row.Subject}" as complete?`)) {
            return;
        }
        this.handleCompleteTask(row);
    }

    async handleCompleteTask(row) {
        this._actionInFlightIds.add(row.Id);
        this._rebuild();
        try {
            await completeTask({ taskId: row.Id });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Task marked as Completed',
                variant: 'success'
            }));
            // Notifies other surfaces (e.g. the Task Hub utility) so they
            // refresh too instead of showing a now-stale task list.
            publish(this.messageContext, TASK_CHANGED, {});
            await refreshApex(this.wiredResult);

            // Optional, skippable prompt to log time against this Matter
            // for the work just finished.
            await LogTimeEntryModal.open({
                size: 'small',
                matterId: this.recordId,
                taskSubject: row.Subject
            });
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this._actionInFlightIds.delete(row.Id);
            this._rebuild();
        }
    }

    async handleBypass(event) {
        const taskId = event.currentTarget.dataset.id;
        if (this._actionInFlightIds.has(taskId)) return;

        const row = (this.tasks || []).find(t => t.Id === taskId);
        if (!row) return;

        // eslint-disable-next-line no-alert
        if (!window.confirm(`Skip "${row.Subject}" without completing it? Any step(s) that depend on it will still activate.`)) {
            return;
        }

        this._actionInFlightIds.add(taskId);
        this._rebuild();
        try {
            await bypassTask({ taskId });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Step skipped',
                message: `"${row.Subject}" was skipped.`,
                variant: 'success'
            }));
            publish(this.messageContext, TASK_CHANGED, {});
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this._actionInFlightIds.delete(taskId);
            this._rebuild();
        }
    }

    async handleApprove(event) {
        const taskId = event.currentTarget.dataset.id;
        if (this._actionInFlightIds.has(taskId)) return;

        const row = (this.tasks || []).find(t => t.Id === taskId);
        if (!row) return;

        this._actionInFlightIds.add(taskId);
        this._rebuild();
        try {
            const finishedChain = await approveTask({ taskId });
            this.dispatchEvent(new ShowToastEvent(
                finishedChain
                    ? { title: '🎉 Chain complete!', message: 'Every step in this task chain is done.', variant: 'success' }
                    : { title: 'Approved', message: `"${row.Subject}" was approved.`, variant: 'success' }
            ));
            publish(this.messageContext, TASK_CHANGED, {});
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not approve task',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this._actionInFlightIds.delete(taskId);
            this._rebuild();
        }
    }

    async handleSendBack(event) {
        const taskId = event.currentTarget.dataset.id;
        if (this._actionInFlightIds.has(taskId)) return;

        const row = (this.tasks || []).find(t => t.Id === taskId);
        if (!row) return;

        // eslint-disable-next-line no-alert
        const reason = window.prompt(`Send "${row.Subject}" back to ${row.OwnerName || 'the assignee'}? Let them know why (optional):`);
        if (reason === null) return; // cancelled

        this._actionInFlightIds.add(taskId);
        this._rebuild();
        try {
            await sendBackTask({ taskId, reason: reason.slice(0, REVIEW_FEEDBACK_MAX_LENGTH) });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Sent back',
                message: `"${row.Subject}" was sent back to ${row.OwnerName || 'the assignee'}.`,
                variant: 'success'
            }));
            publish(this.messageContext, TASK_CHANGED, {});
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not send task back',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this._actionInFlightIds.delete(taskId);
            this._rebuild();
        }
    }

    // ---------- Actions ----------
    get refreshBtnLabel() {
        return this.isRefreshing ? '…' : '↻';
    }

    async handleRefresh() {
        this.isRefreshing = true;
        try {
            await refreshApex(this.wiredResult);
        } finally {
            this.isRefreshing = false;
        }
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

    async handleReassign(event) {
        const taskId = event.currentTarget.dataset.id;

        try {
            const result = await TaskCreateModalAction.open({
                size: 'medium',
                recordId: this.recordId,
                existingTaskId: taskId
            });

            if (result === 'success') {
                await refreshApex(this.wiredResult);
            }
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not open Edit/Reassign',
                message: e?.body?.message || e?.message || 'Please try again.',
                variant: 'error'
            }));
        }
    }

    handleAttachmentClick(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.id;
        const row = this.displayTasks.find(t => t.Id === rowId);
        if (!row) return;

        if (row.attachments.length === 1) {
            window.open(row.attachments[0].viewUrl, '_blank', 'noopener');
            return;
        }

        this.displayTasks = this.displayTasks.map(t => (t.Id === rowId
            ? { ...t, isAttachmentMenuOpen: !t.isAttachmentMenuOpen }
            : { ...t, isAttachmentMenuOpen: false }));
    }
}