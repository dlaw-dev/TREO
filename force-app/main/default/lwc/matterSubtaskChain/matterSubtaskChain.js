import { LightningElement, api, wire } from 'lwc';
import getChainsForMatter from '@salesforce/apex/SubtaskChainViewerController.getChainsForMatter';

export default class MatterSubtaskChain extends LightningElement {
    @api recordId;

    @wire(getChainsForMatter, { matterId: '$recordId' })
    wiredChains;

    get chains() {
        const data = this.wiredChains?.data ?? [];

        return data.map((chain, chainIndex) => ({
            key: `chain-${chainIndex}`,
            templateName: chain.templateName,
            steps: chain.steps.map((step, index) => ({
                ...step,
                displayIndex: index + 1,
                isLast: index === chain.steps.length - 1,
                isCompleted: step.status === 'Completed',
                markerClass: this.markerClass(step.status),
                statusPillClass: this.statusPillClass(step.status),
                statusLabel: this.statusLabel(step.status)
            }))
        }));
    }

    get hasChains() {
        return this.chains.length > 0;
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
