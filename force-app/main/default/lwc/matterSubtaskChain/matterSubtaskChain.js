import { LightningElement, api, wire } from 'lwc';
import { subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import { refreshApex } from '@salesforce/apex';
import TASK_CHANGED from '@salesforce/messageChannel/taskChanged__c';
import getChainsForMatter from '@salesforce/apex/SubtaskChainViewerController.getChainsForMatter';

export default class MatterSubtaskChain extends LightningElement {
    @api recordId;

    @wire(MessageContext) messageContext;
    subscription;

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
    }

    disconnectedCallback() {
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

        return data.map((chain, chainIndex) => ({
            key: `chain-${chainIndex}`,
            templateName: chain.templateName,
            steps: chain.steps.map((step, index) => ({
                ...step,
                displayIndex: index + 1,
                isLast: index === chain.steps.length - 1,
                isCompleted: step.status === 'Completed',
                // A Waiting step's Owner is whoever applied the template, not
                // a real assignee yet - showing it would be misleading.
                showOwnerPill: step.status !== 'Waiting' && !!step.ownerName,
                markerClass: this.markerClass(step.status),
                statusPillClass: this.statusPillClass(step.status),
                statusLabel: this.statusLabel(step.status)
            }))
        }));
    }

    get hasChains() {
        return !this.isLoading && !this.hasError && this.chains.length > 0;
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
