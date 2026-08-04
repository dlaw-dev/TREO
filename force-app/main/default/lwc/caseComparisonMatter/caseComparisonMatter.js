import LightningModal from 'lightning/modal';
import { api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getMatterComparison from '@salesforce/apex/CaseComparisonController.getMatterComparison';
import saveMatterComparison from '@salesforce/apex/CaseComparisonController.saveMatterComparison';

const PRINT_STYLE_ID = 'case-comparison-matter-print-style';
const PRINT_ROOT_ID = 'case-comparison-matter-print-root';

// Same print-portal technique as the single-Topfiling caseComparison component — see that
// component's injectPrintStyle for why this can't just hide things with visibility/clone the DOM.
// Landscape is forced here (rather than in caseComparison) since this table can have many more
// columns than the fixed 2-column single view.
const PRINT_CONTENT_CSS = `
    @page { size: landscape; }
    .comparison-title { text-align: center; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .comparison-table table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .comparison-table th, .comparison-table td {
        border: 1px solid #dddbda; padding: 0.5rem; vertical-align: top;
        white-space: normal; word-break: break-word; overflow-wrap: break-word;
    }
    .comparison-table th:first-child, .comparison-table td.row-label { width: 18%; font-weight: 600; background-color: #f3f2f2; }
    .comparison-table td.cell-value { white-space: pre-wrap; }
    .stacked-field { margin-top: 0.5rem; }
    .stacked-field:first-child { margin-top: 0; }
    .field-caption { display: block; font-size: 0.75rem; color: #706e6b; margin-bottom: 0.125rem; }
    .jpa-subtable { width: 100%; border-collapse: collapse; }
    .jpa-subtable th, .jpa-subtable td { border: 1px solid #dddbda; padding: 0.25rem 0.5rem; font-weight: normal; }
`;

export default class CaseComparisonMatter extends LightningModal {
    _recordId; // NEOS_Matter__c Id

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
    rows = [];
    jpaRows = [];
    filingColumns = [];
    matterEdits = {};
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

    // Each filing column carries its own precomputed date-display strings alongside its raw
    // edits, since LWC templates can't call a formatting method with the loop item as an
    // argument — see handleFilingFieldChange for how these stay in sync after an edit.
    decorateColumn(col) {
        return {
            ...col,
            edits: { ...col.edits },
            complaintFiledDateDisplay: this.formatIsoDate(col.edits.complaintFiledDate),
            lwdaFilingDateDisplay: this.formatIsoDate(col.edits.lwdaFilingDate)
        };
    }

    applyData(data) {
        this.matterCaseName = data.matterCaseName;
        this.rows = data.rows;
        this.jpaRows = data.jpaRows;
        this.matterEdits = { ...data.matterEdits };
        this.filingColumns = data.filingColumns.map((col) => this.decorateColumn(col));
    }

    async loadData() {
        this.isLoading = true;
        try {
            const data = await getMatterComparison({ matterId: this._recordId });
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
            const data = await saveMatterComparison({
                matterId: this._recordId,
                matterEdits: this.matterEdits,
                filingColumnEdits: this.filingColumns.map((col) => ({ filingId: col.filingId, edits: col.edits }))
            });
            this.applyData(data);
            this.isEditing = false;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Saved',
                message: 'Changes saved to the Matter and every Topfiling record.',
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
        const filingId = event.target.dataset.filingId;
        const field = event.target.dataset.field;
        const value = event.target.value;
        this.filingColumns = this.filingColumns.map((col) =>
            col.filingId === filingId ? this.decorateColumn({ ...col, edits: { ...col.edits, [field]: value } }) : col
        );
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

    // Zips a row's otherValues (indexed like filingColumns) with each column's filingId, so
    // the template can for:each over it and still have a stable key per cell.
    zipWithColumns(otherValues) {
        return this.filingColumns.map((col, i) => ({ filingId: col.filingId, value: otherValues ? otherValues[i] : null }));
    }

    get plaintiffAttorneysCells() {
        return this.zipWithColumns(this.plaintiffAttorneysRow.otherValues);
    }

    get defendantAttorneysCells() {
        return this.zipWithColumns(this.defendantAttorneysRow.otherValues);
    }

    get venueCells() {
        return this.zipWithColumns(this.venueRow.otherValues);
    }

    get caseStatusCells() {
        return this.zipWithColumns(this.caseStatusRow.otherValues);
    }

    get hasJpaRows() {
        return this.jpaRows && this.jpaRows.length > 0;
    }

    get hasFilingColumns() {
        return this.filingColumns && this.filingColumns.length > 0;
    }

    get jpaColspan() {
        return this.filingColumns.length + 1;
    }

    get dLawHeader() {
        return `${this.matterCaseName || ''} (D.Law)`;
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

    get matterLwdaFilingDateDisplay() {
        return this.formatIsoDate(this.matterEdits.lwdaFilingDate);
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
            { label: 'Complaint Filing Date',
                dLaw: this.matterComplaintFiledDateDisplay,
                others: this.filingColumns.map((col) => col.complaintFiledDateDisplay) },
            { label: 'LWDA Filing Date',
                dLaw: this.matterLwdaFilingDateDisplay,
                others: this.filingColumns.map((col) => col.lwdaFilingDateDisplay) },
            { label: 'LWDA Number', dLaw: this.matterEdits.lwdaNumber, others: this.filingColumns.map((col) => col.edits.lwdaNumber) },
            { label: 'Plaintiff Attorneys', dLaw: this.plaintiffAttorneysRow.dLawValue, others: this.plaintiffAttorneysRow.otherValues },
            { label: 'Defendant Attorneys', dLaw: this.defendantAttorneysRow.dLawValue, others: this.defendantAttorneysRow.otherValues },
            { label: 'Venue', dLaw: this.venueRow.dLawValue, others: this.venueRow.otherValues },
            { label: 'Case Number',
                dLaw: this.formatDocketNumbers(this.matterEdits.stateDocket, this.matterEdits.federalDocket),
                others: this.filingColumns.map((col) => col.edits.caseNumber) },
            { label: 'Defendants', dLaw: this.defendantsRow.dLawValue, others: this.filingColumns.map((col) => col.edits.defendants) },
            { label: 'Claims', dLaw: this.matterEdits.claims, dLawIsHtml: true, others: this.filingColumns.map((col) => col.edits.claims) },
            { label: 'Class/PAGA Definition',
                dLaw: this.formatClassPagaDefinition(this.matterEdits.classDefinition, this.matterEdits.pagaDefinition),
                others: this.filingColumns.map((col) => col.edits.classDefinition) },
            { label: 'Case Status', dLaw: this.caseStatusRow.dLawValue, others: this.caseStatusRow.otherValues }
        ];
    }

    handlePrint() {
        let printRoot = document.getElementById(PRINT_ROOT_ID);
        if (!printRoot) {
            printRoot = document.createElement('div');
            printRoot.id = PRINT_ROOT_ID;
            document.body.appendChild(printRoot);
        }

        const headerCells = this.filingColumns.map((col) => `<th>${this.escapeHtml(col.header)}</th>`).join('');

        const rowsHtml = this.buildPrintRows().map((r) => {
            const dLawContent = r.dLawIsHtml ? (r.dLaw || '') : this.escapeHtml(r.dLaw);
            const otherCells = r.others.map((v) => `<td class="cell-value">${this.escapeHtml(v)}</td>`).join('');
            return `
                <tr>
                    <td class="row-label">${this.escapeHtml(r.label)}</td>
                    <td class="cell-value">${dLawContent}</td>
                    ${otherCells}
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
                <td class="cell-value" colspan="${this.jpaColspan}">${jpaContentHtml}</td>
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
                            ${headerCells}
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}${jpaRowHtml}</tbody>
                </table>
            </div>
        `;
        window.print();
    }
}
