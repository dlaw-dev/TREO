import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, publish, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { EnclosingUtilityId, open, updateUtility, getInfo } from 'lightning/platformUtilityBarApi';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import getMyDueTasks from '@salesforce/apex/TaskDueReminderController.getMyDueTasks';
import getTasksAssignedByMe from '@salesforce/apex/TaskDueReminderController.getTasksAssignedByMe';
import getMyWaitingTasks from '@salesforce/apex/TaskDueReminderController.getMyWaitingTasks';
import snoozeTask from '@salesforce/apex/TaskDueReminderController.snoozeTask';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const REMOVE_ANIMATION_MS = 220;
const DEFAULT_UTILITY_LABEL = 'Task Hub';

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

    expanded = {
        overdue: true,
        today: true,
        tomorrow: true,
        thisWeek: true,
        thisMonth: false,
        noDueDate: false
    };

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
    }

    disconnectedCallback() {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
        }
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
        return results.map((t) => ({
            ...t,
            dueLabel: dueLabelFor(t.DaysUntil),
            priorityClass: priorityClassFor(t.Priority),
            isWaiting: t.Status === 'Waiting',
            showOwnerPill: t.Status !== 'Waiting' && !!t.OwnerName,
            waitingOnLabel: t.Status === 'Waiting' && t.WaitingOnOwnerName
                ? `Waiting on ${t.WaitingOnOwnerName} to finish "${t.WaitingOnSubject}"`
                : null
        }));
    }

    async refreshTasks() {
        let results;

        try {
            results = await getMyDueTasks();
        } catch (error) {
            const message =
                error?.body?.message || error?.message || 'Unknown error';

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
            return;
        }

        this.tasks = this.decorateTasks(results);

        this.syncUtilityChrome();

        if (this.urgentTasks.length > 0) {
            this.openPanel();
        }

        try {
            const delegatedResults = await getTasksAssignedByMe();
            this.delegatedTasks = this.decorateTasks(delegatedResults);
        } catch (error) {
            const message =
                error?.body?.message || error?.message || 'Unknown error';

            // eslint-disable-next-line no-console
            console.error('Failed to load tasks assigned by me:', message);
        }

        try {
            const waitingResults = await getMyWaitingTasks();
            this.waitingTasks = this.decorateTasks(waitingResults);
        } catch (error) {
            const message =
                error?.body?.message || error?.message || 'Unknown error';

            // eslint-disable-next-line no-console
            console.error('Failed to load waiting tasks:', message);
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

    get assignedToMeTabClass() {
        return this.isAssignedToMeTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get assignedByMeTabClass() {
        return this.isAssignedByMeTab ? 'tab-button tab-button-active' : 'tab-button';
    }

    get waitingTabClass() {
        return this.isWaitingTab ? 'tab-button tab-button-active' : 'tab-button';
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

    get currentTasks() {
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

    get thisWeekTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil > 1 && t.DaysUntil <= 7);
    }

    get thisMonthTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil > 7);
    }

    get noDueDateTasks() {
        return this.currentTasks.filter((t) => t.DaysUntil == null);
    }

    get urgentTasks() {
        return this.tasks.filter(
            (t) => t.DaysUntil != null && t.DaysUntil <= 0 && !this.removingIds.has(t.Id)
        );
    }

    withMenuState(list) {
        const showActions = this.isAssignedToMeTab;
        return list.map((t) => {
            const isOpen = this.openSnoozeMenuId === t.Id;
            return {
                ...t,
                isSnoozeMenuOpen: isOpen,
                snoozeCaret: isOpen ? '▴' : '▾',
                snoozeOptions: this.snoozeOptions,
                showActions,
                itemClass: this.removingIds.has(t.Id)
                    ? 'reminder-item reminder-item-removing'
                    : 'reminder-item'
            };
        });
    }

    get groups() {
        return [
            {
                key: 'overdue',
                label: 'Overdue',
                icon: 'utility:warning',
                iconVariant: 'error',
                headerClass: 'reminder-header reminder-header_overdue',
                tasks: this.withMenuState(this.overdueTasks),
                expanded: this.expanded.overdue
            },
            {
                key: 'today',
                label: 'Today',
                icon: 'utility:notification',
                iconVariant: 'warning',
                headerClass: 'reminder-header reminder-header_today',
                tasks: this.withMenuState(this.todayTasks),
                expanded: this.expanded.today
            },
            {
                key: 'tomorrow',
                label: 'Tomorrow',
                icon: 'utility:event',
                iconVariant: 'brand',
                headerClass: 'reminder-header reminder-header_tomorrow',
                tasks: this.withMenuState(this.tomorrowTasks),
                expanded: this.expanded.tomorrow
            },
            {
                key: 'thisWeek',
                label: 'This Week',
                icon: 'utility:event',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_week',
                tasks: this.withMenuState(this.thisWeekTasks),
                expanded: this.expanded.thisWeek
            },
            {
                key: 'thisMonth',
                label: 'This Month',
                icon: 'utility:event',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_month',
                tasks: this.withMenuState(this.thisMonthTasks),
                expanded: this.expanded.thisMonth
            },
            {
                key: 'noDueDate',
                label: 'No Due Date',
                icon: 'utility:dash',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_none',
                tasks: this.withMenuState(this.noDueDateTasks),
                expanded: this.expanded.noDueDate
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

    get emptyStateTitle() {
        if (this.isAssignedByMeTab) return 'Nothing outstanding';
        if (this.isWaitingTab) return 'Nothing waiting on you';
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
        this.expanded = { ...this.expanded, [key]: !this.expanded[key] };
    }

    handleToggleAll() {
        const target = !this.isAllExpanded;
        this.expanded = {
            overdue: target,
            today: target,
            tomorrow: target,
            thisWeek: target,
            thisMonth: target,
            noDueDate: target
        };
    }

    removeTask(taskId) {
        this.tasks = this.tasks.filter((t) => t.Id !== taskId);
        this.syncUtilityChrome();
    }

    scheduleRemoval(taskId) {
        const removing = new Set(this.removingIds);
        removing.add(taskId);
        this.removingIds = removing;
        this.syncUtilityChrome();

        setTimeout(() => {
            const after = new Set(this.removingIds);
            after.delete(taskId);
            this.removingIds = after;
            this.removeTask(taskId);
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

        try {
            await completeTask({ taskId });

            this.completedToday += 1;
            this.scheduleRemoval(taskId);
            this.suppressNextTaskChangedEcho = true;
            publish(this.messageContext, TASK_CHANGED, {});

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Nice work!',
                    message: 'Task marked complete.',
                    variant: 'success'
                })
            );
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
