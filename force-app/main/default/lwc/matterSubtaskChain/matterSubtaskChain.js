import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import { refreshApex } from '@salesforce/apex';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import getChainsForMatter from '@salesforce/apex/SubtaskChainViewerController.getChainsForMatter';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export default class MatterSubtaskChain extends NavigationMixin(LightningElement) {
    @api recordId;

    // Keyed by chain key; only present once the user has manually
    // expanded/collapsed a chain, overriding the default (auto-collapse
    // once every step in the chain is completed).
    manualOverrides = new Map();

    @wire(MessageContext) messageContext;
    subscription;
    pollIntervalId;
    isManuallyRefreshing = false;

    wiredChainsResult;

    @wire(getChainsForMatter, { matterId: '$recordId' })
    wiredChains(result) {
        this.wiredChainsResult = result;
    }

    connectedCallback() {
        if (!this.subscription) {
            this.subscription = subscribe(this.messageContext, TASK_CHANGED, () => {
                refreshApex(this.wiredChainsResult);
            });
        }

        // Completing a step via the native Task related list (rather than
        // through our own components) never publishes taskChanged__c - this
        // poll is the only thing that catches that case for this component.
        this.pollIntervalId = setInterval(() => {
            if (this.wiredChainsResult) {
                refreshApex(this.wiredChainsResult);
            }
        }, POLL_INTERVAL_MS);
    }

    async handleManualRefresh() {
        if (!this.wiredChainsResult || this.isManuallyRefreshing) {
            return;
        }

        this.isManuallyRefreshing = true;
        try {
            await refreshApex(this.wiredChainsResult);
        } finally {
            this.isManuallyRefreshing = false;
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
    }

    get isLoading() {
        return !this.wiredChainsResult?.data && !this.wiredChainsResult?.error;
    }

    get hasError() {
        return !!this.wiredChainsResult?.error;
    }

    get errorMessage() {
        return this.wiredChainsResult?.error?.body?.message
            || this.wiredChainsResult?.error?.message
            || 'Something went wrong loading subtask chains.';
    }

    get chains() {
        const data = this.wiredChainsResult?.data ?? [];

        return data.map((chain, chainIndex) => {
            const key = `chain-${chainIndex}`;
            const steps = chain.steps.map((step, index) => ({
                ...step,
                displayIndex: index + 1,
                isLast: index === chain.steps.length - 1,
                isCompleted: step.status === 'Completed',
                // SubtaskTemplateApplier now resolves a Waiting step's real
                // future assignee up front whenever the Matter field it
                // depends on is already known, so this is safe to show for
                // Waiting steps too, not just Open/Completed ones.
                showOwnerPill: !!step.ownerName,
                markerClass: this.markerClass(step.status),
                statusPillClass: this.statusPillClass(step.status),
                statusLabel: this.statusLabel(step.status)
            }));

            const completedCount = steps.filter(s => s.isCompleted).length;
            const isFullyCompleted = completedCount === steps.length;
            const expanded = this.manualOverrides.has(key)
                ? this.manualOverrides.get(key)
                : !isFullyCompleted;

            return {
                key,
                templateName: chain.templateName,
                steps,
                expanded,
                progressLabel: `${completedCount}/${steps.length} complete`,
                chevronIcon: expanded ? 'utility:chevrondown' : 'utility:chevronright',
                headerClass: isFullyCompleted ? 'chain-header chain-header-complete' : 'chain-header'
            };
        });
    }

    get hasChains() {
        return !this.isLoading && !this.hasError && this.chains.length > 0;
    }

    toggleChain(event) {
        const key = event.currentTarget.dataset.key;
        const chain = this.chains.find(c => c.key === key);
        const nextOverrides = new Map(this.manualOverrides);
        nextOverrides.set(key, !chain.expanded);
        this.manualOverrides = nextOverrides;
    }

    handleChainHeaderKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.toggleChain(event);
        }
    }

    handleOpenTask(event) {
        event.stopPropagation();
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

    markerClass(status) {
        if (status === 'Completed') return 'timeline-circle timeline-circle-completed';
        if (status === 'Waiting') return 'timeline-circle timeline-circle-waiting';
        return 'timeline-circle timeline-circle-open';
    }

    statusPillClass(status) {
        if (status === 'Completed') return 'chain-pill chain-pill-completed';
        if (status === 'Waiting') return 'chain-pill chain-pill-waiting';
        return 'chain-pill chain-pill-open';
    }

    statusLabel(status) {
        if (status === 'Completed') return 'Completed';
        if (status === 'Waiting') return 'Waiting';
        return 'Open now';
    }
}
