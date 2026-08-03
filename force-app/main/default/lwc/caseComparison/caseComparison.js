import LightningModal from 'lightning/modal';
import { api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getComparison from '@salesforce/apex/CaseComparisonController.getComparison';

const PRINT_STYLE_ID = 'case-comparison-print-style';
const PRINT_ROOT_ID = 'case-comparison-print-root';

// Cloned into PRINT_ROOT_ID at print time — the shadow root's own stylesheet doesn't apply
// once the markup is copied out into plain document.body, so the look has to travel with it.
const PRINT_CONTENT_CSS = `
    .comparison-title { text-align: center; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .comparison-table table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .comparison-table th, .comparison-table td {
        border: 1px solid #dddbda; padding: 0.5rem; vertical-align: top;
        white-space: normal; word-break: break-word; overflow-wrap: break-word;
    }
    .comparison-table th:first-child, .comparison-table td.row-label { width: 22%; font-weight: 600; background-color: #f3f2f2; }
    .comparison-table td.cell-value { white-space: pre-wrap; }
    .fac-ripe-line { margin-top: 0.5rem; color: #706e6b; }
`;

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
        document.getElementById(PRINT_ROOT_ID)?.remove();
    }

    // Shadow DOM stops this component's own CSS from reaching page chrome outside it, and
    // hiding the rest of the page with visibility (instead of display) leaves it occupying
    // its full layout height — combined with position:fixed on the printed table, that made
    // the table get re-stamped onto every one of those now-blank pages. Hiding everything
    // else with display:none removes it from layout entirely, so there's only one page.
    injectPrintStyle() {
        if (document.getElementById(PRINT_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = PRINT_STYLE_ID;
        style.textContent = `
            #${PRINT_ROOT_ID} { display: none; }
            @media print {
                body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
                #${PRINT_ROOT_ID} { display: block !important; }
            }
        `;
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

    // Clones the rendered table out of this component's shadow root into a plain element
    // appended directly to <body>, since printing straight from inside the modal duplicated
    // the table across pages (see injectPrintStyle above for why).
    handlePrint() {
        const tableEl = this.template.querySelector('.comparison-table');
        if (!tableEl) {
            return;
        }
        let printRoot = document.getElementById(PRINT_ROOT_ID);
        if (!printRoot) {
            printRoot = document.createElement('div');
            printRoot.id = PRINT_ROOT_ID;
            document.body.appendChild(printRoot);
        }
        printRoot.innerHTML = `<style>${PRINT_CONTENT_CSS}</style>${tableEl.outerHTML}`;
        window.print();
    }
}
