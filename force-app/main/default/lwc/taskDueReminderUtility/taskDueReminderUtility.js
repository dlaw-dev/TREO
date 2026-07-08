import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, publish, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { EnclosingUtilityId, open, updateUtility } from 'lightning/platformUtilityBarApi';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import getMyDueTasks from '@salesforce/apex/TaskDueReminderController.getMyDueTasks';
import completeTask from '@salesforce/apex/TaskUiController.completeTask';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

const PILL_COLOR_CLASSES = [
    'pill-color-1',
    'pill-color-2',
    'pill-color-3',
    'pill-color-4',
    'pill-color-5',
    'pill-color-6'
];

function colorClassForSubtype(subtype) {
    if (!subtype) {
        return 'pill-color-default';
    }
    let hash = 0;
    for (let i = 0; i < subtype.length; i++) {
        hash = (hash * 31 + subtype.charCodeAt(i)) & 0xffffffff;
    }
    return PILL_COLOR_CLASSES[Math.abs(hash) % PILL_COLOR_CLASSES.length];
}

function dueLabelFor(daysUntil) {
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

export default class TaskDueReminderUtility extends NavigationMixin(LightningElement) {

    @wire(MessageContext) messageContext;
    @wire(EnclosingUtilityId) utilityId;

    tasks = [];
    dismissedIds = new Set();
    completedToday = 0;
    pollIntervalId;
    subscription;
    hasShownLoadError = false;

    expanded = {
        overdue: true,
        today: true,
        tomorrow: true,
        thisWeek: true
    };

    connectedCallback() {
        this.refreshTasks();
        this.pollIntervalId = setInterval(() => this.refreshTasks(), POLL_INTERVAL_MS);

        if (!this.subscription) {
            this.subscription = subscribe(this.messageContext, TASK_CHANGED, () =>
                this.refreshTasks()
            );
        }
    }

    disconnectedCallback() {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
        }
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

        this.tasks = results
            .filter((t) => !this.dismissedIds.has(t.Id))
            .map((t) => ({
                ...t,
                dueLabel: dueLabelFor(t.DaysUntil),
                subtypeColorClass: colorClassForSubtype(t.TaskSubtype)
            }));

        if (this.urgentTasks.length > 0) {
            this.popUp();
        }
    }

    popUp() {
        if (!this.utilityId) {
            return;
        }

        try {
            open(this.utilityId).catch((error) => {
                // eslint-disable-next-line no-console
                console.error('Could not auto-open utility panel', error);
            });
            updateUtility(this.utilityId, { highlighted: true }).catch((error) => {
                // eslint-disable-next-line no-console
                console.error('Could not highlight utility icon', error);
            });
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Utility bar API call failed', error);
        }
    }

    get overdueTasks() {
        return this.tasks.filter((t) => t.DaysUntil < 0);
    }

    get todayTasks() {
        return this.tasks.filter((t) => t.DaysUntil === 0);
    }

    get tomorrowTasks() {
        return this.tasks.filter((t) => t.DaysUntil === 1);
    }

    get thisWeekTasks() {
        return this.tasks.filter((t) => t.DaysUntil > 1);
    }

    get urgentTasks() {
        return this.tasks.filter((t) => t.DaysUntil <= 0);
    }

    get groups() {
        return [
            {
                key: 'overdue',
                label: 'Overdue',
                icon: 'utility:warning',
                iconVariant: 'error',
                headerClass: 'reminder-header reminder-header_overdue',
                tasks: this.overdueTasks,
                expanded: this.expanded.overdue
            },
            {
                key: 'today',
                label: 'Today',
                icon: 'utility:notification',
                iconVariant: 'warning',
                headerClass: 'reminder-header reminder-header_today',
                tasks: this.todayTasks,
                expanded: this.expanded.today
            },
            {
                key: 'tomorrow',
                label: 'Tomorrow',
                icon: 'utility:event',
                iconVariant: 'brand',
                headerClass: 'reminder-header reminder-header_tomorrow',
                tasks: this.tomorrowTasks,
                expanded: this.expanded.tomorrow
            },
            {
                key: 'thisWeek',
                label: 'This Week',
                icon: 'utility:event',
                iconVariant: 'neutral',
                headerClass: 'reminder-header reminder-header_week',
                tasks: this.thisWeekTasks,
                expanded: this.expanded.thisWeek
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
        return this.tasks.length > 0;
    }

    get hasCompletedToday() {
        return this.completedToday > 0;
    }

    get completedTodayMessage() {
        const count = this.completedToday;
        return `You've completed ${count} task${count === 1 ? '' : 's'} today. Nice work!`;
    }

    toggleSection(event) {
        const key = event.currentTarget.dataset.key;
        this.expanded = { ...this.expanded, [key]: !this.expanded[key] };
    }

    removeTask(taskId) {
        this.tasks = this.tasks.filter((t) => t.Id !== taskId);

        if (this.urgentTasks.length === 0 && this.utilityId) {
            updateUtility(this.utilityId, { highlighted: false }).catch(() => {});
        }
    }

    handleDismiss(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;

        this.dismissedIds.add(taskId);
        this.removeTask(taskId);
    }

    async handleComplete(event) {
        event.stopPropagation();
        const taskId = event.currentTarget.dataset.id;

        try {
            await completeTask({ taskId });

            this.removeTask(taskId);
            this.completedToday += 1;
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
}
