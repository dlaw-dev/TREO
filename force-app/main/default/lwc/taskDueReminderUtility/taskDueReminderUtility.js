import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, unsubscribe, publish, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { EnclosingUtilityId, open, updateUtility, getInfo } from 'lightning/platformUtilityBarApi';
import LogTimeEntryModal from 'c/logTimeEntryModal';
import TaskCreateModalAction from 'c/taskCreateModalAction';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import getMyDueTasks from '@salesforce/apex/TaskDueReminderController.getMyDueTasks';
import getTasksAssignedByMe from '@salesforce/apex/TaskDueReminderController.getTasksAssignedByMe';
import getMyWaitingTasks from '@salesforce/apex/TaskDueReminderController.getMyWaitingTasks';
import getTasksToReview from '@salesforce/apex/TaskDueReminderController.getTasksToReview';
import getCompletedTodayCount from '@salesforce/apex/TaskDueReminderController.getCompletedTodayCount';
import snoozeTask from '@salesforce/apex/TaskDueReminderController.snoozeTask';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';
import bypassTask from '@salesforce/apex/TaskUiController.bypassTask';
import approveTask from '@salesforce/apex/TaskUiController.approveTask';
import sendBackTask from '@salesforce/apex/TaskUiController.sendBackTask';
import CURRENT_USER_ID from '@salesforce/user/Id';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const REMOVE_ANIMATION_MS = 220;
const DEFAULT_UTILITY_LABEL = 'Task Hub';
// Matches Task.Review_Feedback__c's actual field length - truncating here
// avoids a raw DML "value too large" error surfacing after the prompt has
// already closed and the typed reason is gone.
const REVIEW_FEEDBACK_MAX_LENGTH = 255;

const SNOOZE_OPTIONS = [
    { duration: 'ONE_HOUR', label: '1 Hour' },
    { duration: 'THREE_HOURS', label: '3 Hours' },
    { duration: 'TOMORROW', label: 'Tomorrow' },
    { duration: 'THREE_DAYS', label: '3 Days' },
    { duration: 'NEXT_WEEK', label: 'Next Week' }
];

function priorityClassFor(priority) {
    if (priority === 'High') {
        return 'priority-high';
    }
    if (priority === 'Low') {
        return 'priority-low';
    }
    return 'priority-normal';
}

function snoozedUntilLabelFor(snoozedUntil) {
    if (!snoozedUntil) {
        return null;
    }
    const d = new Date(snoozedUntil);
    return `Snoozed until ${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function dueLabelFor(daysUntil) {
    if (daysUntil == null) {
        return null;
    }
    if (daysUntil < 0) {
        const n = Math.abs(daysUntil);
        return `${n} day${n === 1 ? '' : 's'} overdue`;
    }
    if (daysUntil === 0) {
        return 'Today';
    }
    if (daysUntil === 1) {
        return 'Tomorrow';
    }
    return `${daysUntil} days`;
}

function computeSnoozeUntil(duration) {
    const now = new Date();

    switch (duration) {
        case 'ONE_HOUR':
            return now.getTime() + 60 * 60 * 1000;
        case 'THREE_HOURS':
            return now.getTime() + 3 * 60 * 60 * 1000;
        case 'TOMORROW':
            return new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 1,
                8, 0, 0
            ).getTime();
        case 'THREE_DAYS':
            return new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 3,
                8, 0, 0
            ).getTime();
        case 'NEXT_WEEK':
            return new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 7,
                8, 0, 0
            ).getTime();
        default:
            return now.getTime();
    }
}

export default class TaskDueReminderUtility extends NavigationMixin(LightningElement) {

    @wire(MessageContext) messageContext;
    @wire(EnclosingUtilityId) utilityId;

    tasks = [];
    delegatedTasks = [];
    waitingTasks = [];
    reviewTasks = [];
    activeTab = 'assignedToMe';
    removingIds = new Set();
    openSnoozeMenuId;
    completedToday = 0;
    pollIntervalId;
    subscription;
    hasShownLoadError = false;
    snoozeOptions = SNOOZE_OPTIONS;
    baseUtilityLabel;
    suppressNextTaskChangedEcho = false;
    // Tracks which urgent tasks we've already auto-opened the panel for -
    // otherwise a user who manually closes the panel gets it forced back
    // open on every subsequent poll for as long as the same overdue/due-
    // today task(s) remain, instead of only when something new shows up.
    _seenUrgentTaskIds = new Set();

    expanded = {
        overdue: true,
        today: true,
        tomorrow: true,
        thisWeek: true,
        thisMonth: false,
        nextMonth: false,
        noDueDate: false
    };

    // Waiting tab is usually a short list where nothing is truly "later" -
    // default every section open there rather than reusing the Assigned
    // tabs' collapsed-by-default thresholds.
    expandedWaiting = {
        overdue: true,
        today: true,
        tomorrow: true,
        thisWeek: true,
        thisMonth: true,
        nextMonth: true,
        noDueDate: true
    };

    // The Pending/To Review tab groups by role instead of by due date - see
    // the groups getter.
    expandedReview = {
        toReview: true,
        pendingReview: true
    };

    _boundCloseAttachmentMenu;
    _boundHideCommentsTooltip;
    _commentsTooltipEl;

    connectedCallback() {
        this.ensureBaseUtilityLabel();
        this.refreshTasks();
        this.pollIntervalId = setInterval(() => this.refreshTasks(), POLL_INTERVAL_MS);

        if (!this.subscription) {
            this.subscription = subscribe(this.messageContext, TASK_CHANGED, () => {
                if (this.suppressNextTaskChangedEcho) {
                    this.suppressNextTaskChangedEcho = false;
                    return;
                }
                this.refreshTasks();
            });
        }

        // handleAttachmentClick already stops propagation on the triggering
        // click, so this only ever fires for a genuine outside click.
        this._boundCloseAttachmentMenu = () => this.closeAttachmentMenu();
        window.addEventListener('click', this._boundCloseAttachmentMenu);

        // A fixed-position tooltip anchored to a hovered row would otherwise
        // drift away from the icon as soon as the panel scrolls underneath
        // it - just hide it instead, same as the attachment menu.
        this._boundHideCommentsTooltip = () => this.hideCommentsTooltip();
        window.addEventListener('scroll', this._boundHideCommentsTooltip, { capture: true });
        window.addEventListener('resize', this._boundHideCommentsTooltip);
    }

    renderedCallback() {
        // Move the lwc:dom="manual" tooltip node (rendered once by the
        // template, so it still carries this component's shadow-scoping
        // attribute) to be a direct child of document.body - a plain
        // document.createElement'd div appended straight to body has no
        // scoping attribute at all, so this component's CSS silently never
        // matches it. Guarded so this only runs once, not on every rerender.
        if (!this._commentsTooltipEl) {
            const portal = this.template.querySelector('.task-tooltip-portal');
            if (portal) {
                document.body.appendChild(portal);
                this._commentsTooltipEl = portal;
            }
        }
    }

    disconnectedCallback() {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
        }

        if (this.subscription) {
            unsubscribe(this.subscription);
            this.subscription = null;
        }

        if (this._boundCloseAttachmentMenu) {
            window.removeEventListener('click', this._boundCloseAttachmentMenu);
            this._boundCloseAttachmentMenu = null;
        }

        if (this._boundHideCommentsTooltip) {
            window.removeEventListener('scroll', this._boundHideCommentsTooltip, { capture: true });
            window.removeEventListener('resize', this._boundHideCommentsTooltip);
            this._boundHideCommentsTooltip = null;
        }

        if (this._commentsTooltipEl) {
            this._commentsTooltipEl.remove();
            this._commentsTooltipEl = null;
        }
    }

    // Positions the portal tooltip against the hovered/focused icon's
    // current viewport rect, flipping above it or clamping horizontally
    // whenever the default placement (centered, just below) would run off
    // the screen - the utility panel is narrow enough that centered-below
    // alone routinely clipped at the panel's own edge.
    handleCommentsEnter(event) {
        const el = this._commentsTooltipEl;
        if (!el) return;

        const wrapper = event.currentTarget;
        const text = wrapper.dataset.tooltip;
        if (!text) return;

        el.textContent = text;

        const rect = wrapper.getBoundingClientRect();
        const margin = 8;
        const tooltipWidth = el.offsetWidth;
        const tooltipHeight = el.offsetHeight;

        let left = rect.left + rect.width / 2;
        const halfWidth = tooltipWidth / 2;
        left = Math.max(halfWidth + margin, Math.min(left, window.innerWidth - halfWidth - margin));

        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow < tooltipHeight + margin
            ? rect.top - tooltipHeight - 4
            : rect.bottom + 4;

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.visibility = 'visible';
        el.style.opacity = '1';
    }

    hideCommentsTooltip() {
        const el = this._commentsTooltipEl;
        if (!el) return;
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
    }

    handleCommentsLeave() {
        this.hideCommentsTooltip();
    }

    closeAttachmentMenu() {
        const anyOpen = (list) => list.some((t) => t.isAttachmentMenuOpen);
        if (!anyOpen(this.tasks) && !anyOpen(this.delegatedTasks) && !anyOpen(this.waitingTasks) && !anyOpen(this.reviewTasks)) return;

        const close = (list) => list.map((t) => ({ ...t, isAttachmentMenuOpen: false }));
        this.tasks = close(this.tasks);
        this.delegatedTasks = close(this.delegatedTasks);
        this.waitingTasks = close(this.waitingTasks);
        this.reviewTasks = close(this.reviewTasks);
    }

    async ensureBaseUtilityLabel() {
        if (this.baseUtilityLabel || !this.utilityId) {
            return;
        }

        try {
            const info = await getInfo(this.utilityId);
            this.baseUtilityLabel = info?.label || DEFAULT_UTILITY_LABEL;
        } catch (error) {
            this.baseUtilityLabel = DEFAULT_UTILITY_LABEL;
        }
    }

    decorateTasks(results) {
        return results.map((t) => {
            const attachments = (t.AttachmentDtos || []).map((a) => ({
                ...a,
                viewUrl: `/lightning/r/ContentDocument/${a.contentDocumentId}/view`
            }));

            return {
                ...t,
                dueLabel: dueLabelFor(t.DaysUntil),
                priorityClass: priorityClassFor(t.Priority),
                showPriorityPill: !!t.Priority && t.Priority !== 'Normal',
                isWaiting: t.Status === 'Waiting',
                isSnoozed: !!t.IsSnoozed,
                snoozedUntilLabel: snoozedUntilLabelFor(t.SnoozedUntil),
                showOwnerPill: t.Status !== 'Waiting' && !!t.OwnerName,
                waitingOnLabel: t.Status === 'Waiting' && t.WaitingOnOwnerName
                    ? `Waiting on ${t.WaitingOnOwnerName} to finish "${t.WaitingOnSubject}"`
                    : null,
                reviewFeedbackLabel: t.ReviewFeedback ? `Sent back: "${t.ReviewFeedback}"` : null,
                // Only meaningful on the Pending/To Review tab's "Pending
                // Review" group (rows where I'm not the Reviewer) - tells me
                // who I'm actually waiting on.
                reviewerLabel: !t.IsReviewer && t.ReviewerName ? `Reviewer: ${t.ReviewerName}` : null,
                canReassign: t.Status !== 'Pending Review' && (t.OwnerId === CURRENT_USER_ID || t.CreatedById === CURRENT_USER_ID),
                attachments,
                hasAttachments: attachments.length > 0,
                attachmentTitle: attachments.length === 1 ? '1 attachment' : `${attachments.length} attachments`,
                isAttachmentMenuOpen: false,
                hasComments: !!t.Comments,
                commentsTitle: t.Comments || ''
            };
        });
    }

    async refreshTasks() {
        // The five calls are independent - fetch them concurrently instead
        // of one after another so a refresh takes as long as the slowest
        // call, not the sum of all five.
        const [dueOutcome, delegatedOutcome, waitingOutcome, reviewOutcome, completedTodayOutcome] = await Promise.allSettled([
            getMyDueTasks(),
            getTasksAssignedByMe(),
            getMyWaitingTasks(),
            getTasksToReview(),
            getCompletedTodayCount()
        ]);

        // Server-authoritative - a task can be completed from more than one
        // surface (this panel, the Matter's task list, etc.), so a local
        // counter that only increments on this component's own Complete
        // button would under-count completions made elsewhere.
        if (completedTodayOutcome.status === 'fulfilled') {
            this.completedToday = completedTodayOutcome.value;
        }

        if (dueOutcome.status === 'fulfilled') {
            this.tasks = this.decorateTasks(dueOutcome.value);
            this.syncUtilityChrome();

            const currentUrgentIds = new Set(this.urgentTasks.map((t) => t.Id));
            const hasNewUrgentTask = [...currentUrgentIds].some((id) => !this._seenUrgentTaskIds.has(id));
            this._seenUrgentTaskIds = currentUrgentIds;

            if (hasNewUrgentTask) {
                this.openPanel();
            }
        } else {
            const message =
                dueOutcome.reason?.body?.message || dueOutcome.reason?.message || 'Unknown error';

            // eslint-disable-next-line no-console
            console.error('Failed to load due tasks:', message);

            if (!this.hasShownLoadError) {
                this.hasShownLoadError = true;
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Task reminder failed to load',
                        message,
                        variant: 'error'
                    })
                );
            }
        }

        if (delegatedOutcome.status === 'fulfilled') {
            this.delegatedTasks = this.decorateTasks(delegatedOutcome.value);
        } else {
            const message =
                delegatedOutcome.reason?.body?.message || delegatedOutcome.reason?.message || 'Unknown error';

            // eslint-disable-next-line no-console
            console.error('Failed to load tasks assigned by me:', message);
        }

        if (waitingOutcome.status === 'fulfilled') {
            this.waitingTasks = this.decorateTasks(waitingOutcome.value);
        } else {
            const message =
                waitingOutcome.reason?.body?.message || waitingOutcome.reason?.message || 'Unknown error';

            // eslint-disable-next-line no-console
            console.error('Failed to load waiting tasks:', message);
        }

        if (reviewOutcome.status === 'fulfilled') {
            this.reviewTasks = this.decorateTasks(reviewOutcome.value);
        } else {
            const message =
                reviewOutcome.reason?.body?.message || reviewOutcome.reason?.message || 'Unknown error';

            // eslint-disable-next-line no-console
            console.error('Failed to load tasks to review:', message);
        }
    }

    openPanel() {
        if (!this.utilityId) {
            return;
        }

        try {
            open(this.utilityId).catch((error) => {
                // eslint-disable-next-line no-console
                console.error('Could not auto-open utility panel', error);
            });
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Utility bar API call failed', error);
        }
    }

    syncUtilityChrome() {
        if (!this.utilityId) {
            return;
        }

        const count = this.urgentTasks.length;
        const base = this.baseUtilityLabel || DEFAULT_UTILITY_LABEL;
        const label = count > 0 ? `${base} (${count})` : base;

        updateUtility(this.utilityId, { label, highlighted: count > 0 }).catch((error) => {
            // eslint-disable-next-line no-console
            console.error('Could not update utility chrome', error);
        });
    }

    get isAssignedToMeTab() {
        return this.activeTab === 'assignedToMe';
    }

    get isAssignedByMeTab() {
        return this.activeTab === 'assignedByMe';
    }

    get isWaitingTab() {
        return this.activeTab === 'waiting';
    }

    get isReviewTab() {
        return this.activeTab === 'toReview';
    }

    get assignedToMeTabClass() {
        return this.isAssignedToMeTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get assignedByMeTabClass() {
        return this.isAssignedByMeTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get waitingTabClass() {
        return this.isWaitingTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get reviewTabClass() {
        return this.isReviewTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get assignedToMeCount() {
        return this.tasks.length;
    }

    get assignedByMeCount() {
        return this.delegatedTasks.length;
    }

    get waitingCount() {
        return this.waitingTasks.length;
    }

    get reviewCount() {
        return this.reviewTasks.length;
    }

    get currentTasks() {
        if (this.isReviewTab) return this.reviewTasks;
        if (this.isAssignedByMeTab) return this.delegatedTasks;
        if (this.isWaitingTab) return this.waitingTasks;
        return this.tasks;
    }

    handleTabClick(event) {
        this.openSnoozeMenuId = null;
        this.activeTab = event.currentTarget.dataset.tab;
    }

    get overdueTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil < 0);
    }

    get todayTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil === 0);
    }

    get tomorrowTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil === 1);
    }

    // "This Week" means the rest of the current calendar week (through
    // Saturday), not a rolling 7 days - otherwise a task due next Monday
    // shows as "This Week" on a Thursday, which reads as due much sooner
    // than it is. Matches the "Week" filter's own cutoff in tasksCalendar.
    // Clamped to at least 1 so thisMonthTasks never re-catches tomorrow's
    // DaysUntil === 1 tasks when today is Saturday (cutoff would be 0).
    get _thisWeekCutoffDays() {
        return Math.max(1, 6 - new Date().getDay());
    }

    // Same reasoning as the week cutoff, one level up: "This Month" means
    // the rest of the current calendar month, not an arbitrary window -
    // otherwise a task due in early next month shows as "This Month" when
    // today is near month-end. Clamped to at least the week cutoff so the
    // month bucket never ends up narrower than the week bucket it sits
    // after (which would otherwise happen in the last few days of a month).
    get _thisMonthCutoffDays() {
        const now = new Date();
        const daysLeftInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
        return Math.max(this._thisWeekCutoffDays, daysLeftInMonth);
    }

    get thisWeekTasks() {
        const cutoff = this._thisWeekCutoffDays;
        return this.currentTasks.filter((t) => t.DaysUntil > 1 && t.DaysUntil <= cutoff);
    }

    get thisMonthTasks() {
        const weekCutoff = this._thisWeekCutoffDays;
        const monthCutoff = this._thisMonthCutoffDays;
        return this.currentTasks.filter((t) => t.DaysUntil > weekCutoff && t.DaysUntil <= monthCutoff);
    }

    get nextMonthTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil > this._thisMonthCutoffDays);
    }

    get noDueDateTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil == null);
    }

    get urgentTasks() {
        return this.tasks.filter(
            (t) => t.DaysUntil != null && t.DaysUntil <= 0 && !this.removingIds.has(t.Id) && !t.isSnoozed
        );
    }

    withMenuState(list) {
        const isAssignedToMe = this.isAssignedToMeTab;
        const isAssignedByMe = this.isAssignedByMeTab;
        const isReview = this.isReviewTab;
        return list.map((t) => {
            const isOpen = this.openSnoozeMenuId === t.Id;
            const classes = ['reminder-item'];
            if (this.removingIds.has(t.Id)) classes.push('reminder-item-removing');
            if (t.isSnoozed) classes.push('reminder-item-snoozed');
            return {
                ...t,
                isSnoozeMenuOpen: isOpen,
                snoozeCaret: isOpen ? '▴' : '▾',
                snoozeOptions: this.snoozeOptions,
                // Completing is still allowed on a snoozed task - only the
                // "Snooze" action itself is hidden once it's already snoozed.
                showComplete: isAssignedToMe,
                // Completing a reviewed task doesn't actually finish it - it
                // hands off to the Reviewer - so the button should say that
                // plainly rather than claim "Complete" and then not do that.
                completeIcon: t.ReviewerName ? 'utility:send' : 'utility:check',
                completeAltText: t.ReviewerName ? 'Send for review' : 'Complete task',
                completeTitle: t.ReviewerName ? `Send to ${t.ReviewerName} for review` : 'Mark complete',
                // bypassTask permits either the current assignee OR the
                // original assigner (creator) to skip - the Assigned By Me
                // tab is exactly that second case (every row there has
                // CreatedById === current user by construction), so it
                // needs its own Skip button rather than requiring a
                // reassign-to-self round trip first.
                showSkip: (isAssignedToMe || isAssignedByMe) && !!t.IsChainStep && t.canReassign,
                showSnoozeButton: isAssignedToMe && !t.isSnoozed,
                // The Pending/To Review tab holds two audiences at once -
                // only the actual Reviewer gets action buttons; a row that's
                // just someone's own pending task is informational only.
                showApprove: isReview && !!t.IsReviewer,
                showSendBack: isReview && !!t.IsReviewer,
                showOwnerOrStatusPills: !isAssignedToMe,
                itemClass: classes.join(' ')
            };
        });
    }

    get activeExpanded() {
        if (this.isReviewTab) return this.expandedReview;
        return this.isWaitingTab ? this.expandedWaiting : this.expanded;
    }

    get groups() {
        const expandedState = this.activeExpanded;

        if (this.isReviewTab) {
            const decorated = this.withMenuState(this.currentTasks);
            return [
                {
                    key: 'toReview',
                    label: 'To Review',
                    icon: 'utility:preview',
                    iconVariant: 'brand',
                    headerClass: 'reminder-header reminder-header_today',
                    tasks: decorated.filter((t) => t.IsReviewer),
                    expanded: expandedState.toReview
                },
                {
                    key: 'pendingReview',
                    label: 'Pending Review',
                    icon: 'utility:clock',
                    iconVariant: 'neutral',
                    headerClass: 'reminder-header reminder-header_none',
                    tasks: decorated.filter((t) => !t.IsReviewer),
                    expanded: expandedState.pendingReview
                }
            ]
                .filter((group) => group.tasks.length > 0)
                .map((group) => ({
                    ...group,
                    count: group.tasks.length,
                    chevron: group.expanded ? 'utility:chevrondown' : 'utility:chevronright'
                }));
        }

        return [
            {
                key: 'overdue',
                label: 'Overdue',
                icon: 'utility:warning',
                iconVariant: 'error',
                headerClass: 'reminder-header reminder-header_overdue',
                tasks: this.withMenuState(this.overdueTasks),
                expanded: expandedState.overdue
            },
            {
                key: 'today',
                label: 'Today',
                icon: 'utility:notification',
                iconVariant: 'warning',
                headerClass: 'reminder-header reminder-header_today',
                tasks: this.withMenuState(this.todayTasks),
                expanded: expandedState.today
            },
            {
                key: 'tomorrow',
                label: 'Tomorrow',
                icon: 'utility:event',
                iconVariant: 'brand',
                headerClass: 'reminder-header reminder-header_tomorrow',
                tasks: this.withMenuState(this.tomorrowTasks),
                expanded: expandedState.tomorrow
            },
            {
                key: 'thisWeek',
                label: 'This Week',
                icon: 'utility:event',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_week',
                tasks: this.withMenuState(this.thisWeekTasks),
                expanded: expandedState.thisWeek
            },
            {
                key: 'thisMonth',
                label: 'This Month',
                icon: 'utility:event',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_month',
                tasks: this.withMenuState(this.thisMonthTasks),
                expanded: expandedState.thisMonth
            },
            {
                key: 'nextMonth',
                label: 'Next Month',
                icon: 'utility:event',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_month',
                tasks: this.withMenuState(this.nextMonthTasks),
                expanded: expandedState.nextMonth
            },
            {
                key: 'noDueDate',
                label: 'No Due Date',
                icon: 'utility:dash',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_none',
                tasks: this.withMenuState(this.noDueDateTasks),
                expanded: expandedState.noDueDate
            }
        ]
            .filter((group) => group.tasks.length > 0)
            .map((group) => ({
                ...group,
                count: group.tasks.length,
                chevron: group.expanded ? 'utility:chevrondown' : 'utility:chevronright'
            }));
    }

    get hasTasks() {
        return this.currentTasks.length > 0;
    }

    // Keeps the toolbar (and its progress ring) visible even once every
    // task is done, instead of disappearing along with the now-empty list.
    get showToolbar() {
        return this.hasTasks || this.hasTodayProgress;
    }

    get emptyStateTitle() {
        if (this.isAssignedByMeTab) return 'Nothing outstanding';
        if (this.isWaitingTab) return 'Nothing waiting on you';
        if (this.isReviewTab) return 'Nothing pending or to review';
        return "You're all caught up!";
    }

    get isAllExpanded() {
        return this.groups.every((g) => g.expanded);
    }

    get collapseAllLabel() {
        return this.isAllExpanded ? 'Collapse All' : 'Expand All';
    }

    get hasCompletedToday() {
        return this.isAssignedToMeTab && this.completedToday > 0;
    }

    get waitingSummaryLabel() {
        if (!this.isWaitingTab) {
            return '';
        }

        const distinctPeople = new Set(
            this.waitingTasks.map((t) => t.WaitingOnOwnerName).filter(Boolean)
        );

        if (distinctPeople.size === 0) {
            return '';
        }

        const peopleWord = distinctPeople.size === 1 ? 'person' : 'people';
        return `Blocked on ${distinctPeople.size} ${peopleWord} right now`;
    }

    get completedTodayMessage() {
        const count = this.completedToday;
        return `You've completed ${count} task${count === 1 ? '' : 's'} today. Nice work!`;
    }

    get todayProgressTotal() {
        return this.urgentTasks.length + this.completedToday;
    }

    get hasTodayProgress() {
        return this.isAssignedToMeTab && this.todayProgressTotal > 0;
    }

    get todayProgressPercent() {
        const total = this.todayProgressTotal;
        return total === 0 ? 0 : Math.round((this.completedToday / total) * 100);
    }

    get todayProgressLabel() {
        return `${this.completedToday}/${this.todayProgressTotal}`;
    }

    get progressRingStyle() {
        return `--progress: ${this.todayProgressPercent}`;
    }

    toggleSection(event) {
        const key = event.currentTarget.dataset.key;
        const next = { ...this.activeExpanded, [key]: !this.activeExpanded[key] };

        if (this.isReviewTab) {
            this.expandedReview = next;
        } else if (this.isWaitingTab) {
            this.expandedWaiting = next;
        } else {
            this.expanded = next;
        }
    }

    handleSectionHeaderKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.toggleSection(event);
        }
    }

    handleToggleAll() {
        const target = !this.isAllExpanded;

        if (this.isReviewTab) {
            this.expandedReview = { toReview: target, pendingReview: target };
            return;
        }

        const next = {
            overdue: target,
            today: target,
            tomorrow: target,
            thisWeek: target,
            thisMonth: target,
            nextMonth: target,
            noDueDate: target
        };

        if (this.isWaitingTab) {
            this.expandedWaiting = next;
        } else {
            this.expanded = next;
        }
    }

    scheduleRemoval(taskId) {
        const removing = new Set(this.removingIds);
        removing.add(taskId);
        this.removingIds = removing;
        this.syncUtilityChrome();

        setTimeout(async () => {
            // A full refetch - not just dropping taskId locally - so any
            // successor step this completion just activated (e.g. the next
            // subtask chain step, now assigned to this same user) shows up
            // without waiting for the poll interval or a manual page refresh.
            // Awaited before clearing removingIds so the row stays hidden by
            // its CSS-animation class through the whole round trip, instead
            // of snapping back to full opacity for that window and then
            // disappearing again once the refetch resolves.
            await this.refreshTasks();

            const after = new Set(this.removingIds);
            after.delete(taskId);
            this.removingIds = after;
        }, REMOVE_ANIMATION_MS);
    }

    toggleSnoozeMenu(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        this.openSnoozeMenuId = this.openSnoozeMenuId === taskId ? null : taskId;
    }

    async handleSnooze(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        const duration = event.currentTarget.dataset.duration;
        const label = event.currentTarget.dataset.label;

        this.openSnoozeMenuId = null;

        try {
            const snoozeUntil = new Date(computeSnoozeUntil(duration)).toISOString();
            await snoozeTask({ taskId, snoozeUntil });

            this.scheduleRemoval(taskId);

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Reminder snoozed',
                    message: `We'll remind you again in ${label.toLowerCase()}.`,
                    variant: 'success'
                })
            );
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not snooze task',
                    message: error?.body?.message || 'Please try again.',
                    variant: 'error'
                })
            );
        }
    }

    async handleComplete(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        // Captured before scheduleRemoval() triggers a refetch that drops
        // this task from this.tasks entirely.
        const task = this.tasks.find((t) => t.Id === taskId);

        try {
            const finishedChain = await completeTask({ taskId });

            this.completedToday += 1;
            this.scheduleRemoval(taskId);
            this.suppressNextTaskChangedEcho = true;
            publish(this.messageContext, TASK_CHANGED, {});

            this.dispatchEvent(
                new ShowToastEvent(
                    finishedChain
                        ? {
                              title: '🎉 Chain complete!',
                              message: 'Every step in this task chain is done.',
                              variant: 'success'
                          }
                        : {
                              title: 'Nice work!',
                              message: 'Task marked complete.',
                              variant: 'success'
                          }
                )
            );

            // Optional, skippable prompt to log time - only when this task
            // is actually linked to a Matter (Time_Entry__c requires one).
            if (task?.MatterId) {
                await LogTimeEntryModal.open({
                    size: 'small',
                    matterId: task.MatterId,
                    taskSubject: task.Subject
                });
            }
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not complete task',
                    message: error?.body?.message || 'Please try again.',
                    variant: 'error'
                })
            );
        }
    }

    async handleBypass(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        const task = this.tasks.find((t) => t.Id === taskId)
            || this.delegatedTasks.find((t) => t.Id === taskId)
            || this.waitingTasks.find((t) => t.Id === taskId)
            || this.reviewTasks.find((t) => t.Id === taskId);

        // eslint-disable-next-line no-alert
        if (!window.confirm(`Skip "${task?.Subject}" without completing it? Any step(s) that depend on it will still activate.`)) {
            return;
        }

        try {
            await bypassTask({ taskId });
            this.scheduleRemoval(taskId);
            this.suppressNextTaskChangedEcho = true;
            publish(this.messageContext, TASK_CHANGED, {});

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Step skipped',
                    message: `"${task?.Subject}" was skipped.`,
                    variant: 'success'
                })
            );
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not skip step',
                    message: error?.body?.message || 'Please try again.',
                    variant: 'error'
                })
            );
        }
    }

    async handleApprove(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        const task = this.reviewTasks.find((t) => t.Id === taskId);

        try {
            const finishedChain = await approveTask({ taskId });
            this.scheduleRemoval(taskId);
            this.suppressNextTaskChangedEcho = true;
            publish(this.messageContext, TASK_CHANGED, {});

            this.dispatchEvent(
                new ShowToastEvent(
                    finishedChain
                        ? {
                              title: '🎉 Chain complete!',
                              message: 'Every step in this task chain is done.',
                              variant: 'success'
                          }
                        : {
                              title: 'Approved',
                              message: `"${task?.Subject}" was approved.`,
                              variant: 'success'
                          }
                )
            );
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not approve task',
                    message: error?.body?.message || 'Please try again.',
                    variant: 'error'
                })
            );
        }
    }

    async handleSendBack(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        const task = this.reviewTasks.find((t) => t.Id === taskId);

        // eslint-disable-next-line no-alert
        const reason = window.prompt(
            `Send "${task?.Subject}" back to ${task?.OwnerName || 'the assignee'}? Let them know why (optional):`
        );
        if (reason === null) return; // cancelled

        try {
            await sendBackTask({ taskId, reason: reason.slice(0, REVIEW_FEEDBACK_MAX_LENGTH) });
            this.scheduleRemoval(taskId);
            this.suppressNextTaskChangedEcho = true;
            publish(this.messageContext, TASK_CHANGED, {});

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Sent back',
                    message: `"${task?.Subject}" was sent back to ${task?.OwnerName || 'the assignee'}.`,
                    variant: 'success'
                })
            );
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not send task back',
                    message: error?.body?.message || 'Please try again.',
                    variant: 'error'
                })
            );
        }
    }

    async handleReassign(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;
        // The button renders across all four tabs (due/delegated/waiting/
        // review), each backed by its own array - the clicked task may live
        // in any of them.
        const task = this.tasks.find((t) => t.Id === taskId)
            || this.delegatedTasks.find((t) => t.Id === taskId)
            || this.waitingTasks.find((t) => t.Id === taskId)
            || this.reviewTasks.find((t) => t.Id === taskId);

        try {
            const result = await TaskCreateModalAction.open({
                size: 'medium',
                recordId: task?.MatterId,
                existingTaskId: taskId
            });

            if (result === 'success') {
                this.refreshTasks();
            }
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not open Edit/Reassign',
                    message: error?.body?.message || error?.message || 'Please try again.',
                    variant: 'error'
                })
            );
        }
    }

    handleAttachmentClick(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.id;
        const task = this.tasks.find((t) => t.Id === rowId)
            || this.delegatedTasks.find((t) => t.Id === rowId)
            || this.waitingTasks.find((t) => t.Id === rowId)
            || this.reviewTasks.find((t) => t.Id === rowId);
        if (!task) return;

        if (task.attachments.length === 1) {
            window.open(task.attachments[0].viewUrl, '_blank', 'noopener');
            return;
        }

        const toggle = (list) => list.map((t) => (t.Id === rowId
            ? { ...t, isAttachmentMenuOpen: !t.isAttachmentMenuOpen }
            : { ...t, isAttachmentMenuOpen: false }));

        this.tasks = toggle(this.tasks);
        this.delegatedTasks = toggle(this.delegatedTasks);
        this.waitingTasks = toggle(this.waitingTasks);
        this.reviewTasks = toggle(this.reviewTasks);
    }

    // The row itself navigates to the task on click (handleOpenTask) - file
    // links inside the attachment menu need their own tab to open without
    // also triggering that row-level navigation.
    stopClickPropagation(event) {
        event.stopPropagation();
    }

    handleOpenTask(event) {
        const taskId = event.currentTarget.dataset.id;

        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: taskId,
                objectApiName: 'Task',
                actionName: 'view'
            }
        });
    }

    handleOpenMatter(event) {
        event.stopPropagation();
        const matterId = event.currentTarget.dataset.matterId;

        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: matterId,
                objectApiName: 'NEOS_Matter__c',
                actionName: 'view'
            }
        });
    }
}
