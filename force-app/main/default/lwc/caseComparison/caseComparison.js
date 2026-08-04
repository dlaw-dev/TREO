import LightningModal from 'lightning/modal';
import { api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getComparison from '@salesforce/apex/CaseComparisonController.getComparison';
import saveComparison from '@salesforce/apex/CaseComparisonController.saveComparison';

const PRINT_STYLE_ID = 'case-comparison-print-style';
const PRINT_ROOT_ID = 'case-comparison-print-root';

// Built fresh at print time from the current data/edits rather than cloned from the DOM —
// lightning-input/lightning-textarea render their value inside their own shadow root, so a
// plain outerHTML clone of the table would print those cells empty.
const PRINT_CONTENT_CSS = `
    .comparison-title { text-align: center; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .comparison-table table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .comparison-table th, .comparison-table td {
        border: 1px solid #dddbda; padding: 0.5rem; vertical-align: top;
        white-space: normal; word-break: break-word; overflow-wrap: break-word;
    }
    .comparison-table th:first-child, .comparison-table td.row-label { width: 22%; font-weight: 600; background-color: #f3f2f2; }
    .comparison-table td.cell-value { white-space: pre-wrap; }
    .stacked-field { margin-top: 0.5rem; }
    .stacked-field:first-child { margin-top: 0; }
    .field-caption { display: block; font-size: 0.75rem; color: #706e6b; margin-bottom: 0.125rem; }
    .jpa-subtable { width: 100%; border-collapse: collapse; }
    .jpa-subtable th, .jpa-subtable td { border: 1px solid #dddbda; padding: 0.25rem 0.5rem; font-weight: normal; }
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
    jpaRows = [];
    matterEdits = {};
    filingEdits = {};
    isLoading = true;
    isSaving = false;
    isEditing = false;

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

    applyData(data) {
        this.matterCaseName = data.matterCaseName;
        this.otherCaseName = data.otherCaseName;
        this.otherFirmName = data.otherFirmName;
        this.rows = data.rows;
        this.jpaRows = data.jpaRows;
        this.matterEdits = { ...data.matterEdits };
        this.filingEdits = { ...data.filingEdits };
    }

    async loadData() {
        this.isLoading = true;
        try {
            const data = await getComparison({ topfilingId: this._recordId });
            this.applyData(data);
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

    handleToggleEdit() {
        this.isEditing = !this.isEditing;
    }

    get editIconName() {
        return this.isEditing ? 'utility:close' : 'utility:edit';
    }

    get editButtonLabel() {
        return this.isEditing ? 'Done Editing' : 'Edit';
    }

    async handleSave() {
        this.isSaving = true;
        try {
            const data = await saveComparison({
                topfilingId: this._recordId,
                matterEdits: this.matterEdits,
                filingEdits: this.filingEdits
            });
            this.applyData(data);
            this.isEditing = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Saved',
                message: 'Changes saved to both the Matter and the Topfiling record.',
                variant: 'success'
            }));
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error saving changes',
                message: error?.body?.message || error?.message || 'Unknown error',
                variant: 'error'
            }));
        } finally {
            this.isSaving = false;
        }
    }

    handleMatterFieldChange(event) {
        this.matterEdits = { ...this.matterEdits, [event.target.dataset.field]: event.target.value };
    }

    handleFilingFieldChange(event) {
        this.filingEdits = { ...this.filingEdits, [event.target.dataset.field]: event.target.value };
    }

    findRow(label) {
        return this.rows.find((r) => r.label === label) || {};
    }

    get plaintiffAttorneysRow() {
        return this.findRow('Plaintiff Attorneys');
    }

    get defendantAttorneysRow() {
        return this.findRow('Defendant Attorneys');
    }

    get venueRow() {
        return this.findRow('Venue');
    }

    get defendantsRow() {
        return this.findRow('Defendants');
    }

    get caseStatusRow() {
        return this.findRow('Case Status');
    }

    get hasJpaRows() {
        return this.jpaRows && this.jpaRows.length > 0;
    }

    get dLawHeader() {
        return `${this.matterCaseName || ''} (D.Law)`;
    }

    get otherHeader() {
        const firm = this.otherFirmName ? ` (${this.otherFirmName})` : '';
        return `${this.otherCaseName || ''}${firm}`;
    }

    formatIsoDate(iso) {
        if (!iso) {
            return '';
        }
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString();
    }

    get matterComplaintFiledDateDisplay() {
        return this.formatIsoDate(this.matterEdits.complaintFiledDate);
    }

    get filingComplaintFiledDateDisplay() {
        return this.formatIsoDate(this.filingEdits.complaintFiledDate);
    }

    get matterLwdaFilingDateDisplay() {
        return this.formatIsoDate(this.matterEdits.lwdaFilingDate);
    }

    get filingLwdaFilingDateDisplay() {
        return this.formatIsoDate(this.filingEdits.lwdaFilingDate);
    }

    escapeHtml(value) {
        if (!value) {
            return '';
        }
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }

    formatDocketNumbers(stateDocket, federalDocket) {
        const parts = [];
        if (stateDocket) {
            parts.push(`State: ${stateDocket}`);
        }
        if (federalDocket) {
            parts.push(`Federal: ${federalDocket}`);
        }
        return parts.join(' / ');
    }

    formatClassPagaDefinition(classDefinition, pagaDefinition) {
        const parts = [];
        if (classDefinition) {
            parts.push(`Class Definition: ${classDefinition}`);
        }
        if (pagaDefinition) {
            parts.push(`PAGA Definition: ${pagaDefinition}`);
        }
        return parts.join('\n\n');
    }

    buildPrintRows() {
        return [
            { label: 'Complaint Filing Date', dLaw: this.matterComplaintFiledDateDisplay, other: this.filingComplaintFiledDateDisplay },
            { label: 'LWDA Filing Date', dLaw: this.matterLwdaFilingDateDisplay, other: this.filingLwdaFilingDateDisplay },
            { label: 'LWDA Number', dLaw: this.matterEdits.lwdaNumber, other: this.filingEdits.lwdaNumber },
            { label: 'Plaintiff Attorneys', dLaw: this.plaintiffAttorneysRow.dLawValue, other: this.plaintiffAttorneysRow.otherValue },
            { label: 'Defendant Attorneys', dLaw: this.defendantAttorneysRow.dLawValue, other: this.defendantAttorneysRow.otherValue },
            { label: 'Venue', dLaw: this.venueRow.dLawValue, other: this.venueRow.otherValue },
            { label: 'Case Number',
                dLaw: this.formatDocketNumbers(this.matterEdits.stateDocket, this.matterEdits.federalDocket),
                other: this.filingEdits.caseNumber },
            { label: 'Defendants', dLaw: this.defendantsRow.dLawValue, other: this.filingEdits.defendants },
            { label: 'Claims', dLaw: this.matterEdits.claims, dLawIsHtml: true, other: this.filingEdits.claims },
            { label: 'Class/PAGA Definition',
                dLaw: this.formatClassPagaDefinition(this.matterEdits.classDefinition, this.matterEdits.pagaDefinition),
                other: this.filingEdits.classDefinition },
            { label: 'Case Status', dLaw: this.caseStatusRow.dLawValue, other: this.caseStatusRow.otherValue }
        ];
    }

    handlePrint() {
        let printRoot = document.getElementById(PRINT_ROOT_ID);
        if (!printRoot) {
            printRoot = document.createElement('div');
            printRoot.id = PRINT_ROOT_ID;
            document.body.appendChild(printRoot);
        }

        const rowsHtml = this.buildPrintRows().map((r) => {
            const dLawContent = r.dLawIsHtml ? (r.dLaw || '') : this.escapeHtml(r.dLaw);
            return `
                <tr>
                    <td class="row-label">${this.escapeHtml(r.label)}</td>
                    <td class="cell-value">${dLawContent}</td>
                    <td class="cell-value">${this.escapeHtml(r.other)}</td>
                </tr>
            `;
        }).join('');

        const jpaContentHtml = this.hasJpaRows
            ? `<table class="jpa-subtable">
                    <thead><tr><th>Firm/Lawyer</th><th>JPA Portion</th><th>Fully Signed?</th></tr></thead>
                    <tbody>${this.jpaRows.map((jpa) => `
                        <tr>
                            <td>${this.escapeHtml(jpa.firmOrLawyerName)}</td>
                            <td>${this.escapeHtml(jpa.jpaPortion)}</td>
                            <td>${this.escapeHtml(jpa.fullySigned)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>`
            : 'No JPA records on this matter.';
        const jpaRowHtml = `
            <tr>
                <td class="row-label">JPA Agreements</td>
                <td class="cell-value" colspan="2">${jpaContentHtml}</td>
            </tr>
        `;

        printRoot.innerHTML = `
            <style>${PRINT_CONTENT_CSS}</style>
            <div class="comparison-table">
                <div class="comparison-title">D.LAW RELATED CASE COMPARISON</div>
                <table>
                    <thead>
                        <tr>
                            <th>Category</th>
                            <th>${this.escapeHtml(this.dLawHeader)}</th>
                            <th>${this.escapeHtml(this.otherHeader)}</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}${jpaRowHtml}</tbody>
                </table>
            </div>
        `;
        window.print();
    }
}
