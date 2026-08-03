import LightningModal from 'lightning/modal';
import { api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getComparison from '@salesforce/apex/CaseComparisonController.getComparison';

const PRINT_STYLE_ID = 'case-comparison-print-style';

export default class CaseComparison extends LightningModal {
    _recordId; // Topfiling__c Id

    // Quick-action LWCs don't have recordId available yet in connectedCallback —
    // the framework assigns it slightly later through this setter, so data loading
    // has to be triggered from here instead.
    @api
    set recordId(value) {
        this._recordId = value;
        if (value) {
            this.loadData();
        }
    }
    get recordId() {
        return this._recordId;
    }

    matterCaseName;
    otherCaseName;
    otherFirmName;
    rows = [];
    isLoading = true;

    connectedCallback() {
        this.injectPrintStyle();
    }

    disconnectedCallback() {
        document.getElementById(PRINT_STYLE_ID)?.remove();
    }

    // Shadow DOM stops this component's own CSS from reaching page chrome outside it,
    // but visibility still inherits in — so hide everything globally here, then this
    // component's own stylesheet re-reveals just its :host for print.
    injectPrintStyle() {
        if (document.getElementById(PRINT_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = PRINT_STYLE_ID;
        style.textContent = '@media print { body * { visibility: hidden !important; } }';
        document.head.appendChild(style);
    }

    async loadData() {
        this.isLoading = true;
        try {
            const data = await getComparison({ topfilingId: this._recordId });
            this.matterCaseName = data.matterCaseName;
            this.otherCaseName = data.otherCaseName;
            this.otherFirmName = data.otherFirmName;
            this.rows = data.rows;
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error loading comparison',
                message: error?.body?.message || error?.message || 'Unknown error',
                variant: 'error'
            }));
        } finally {
            this.isLoading = false;
        }
    }

    get dLawHeader() {
        return `${this.matterCaseName || ''} (D.Law)`;
    }

    get otherHeader() {
        const firm = this.otherFirmName ? ` (${this.otherFirmName})` : '';
        return `${this.otherCaseName || ''}${firm}`;
    }

    handlePrint() {
        window.print();
    }
}
