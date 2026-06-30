import { LightningElement, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import search from '@salesforce/apex/MatterGlobalSearchController.search';

const COLUMNS = {
    'NEOS_Notes__c':       [{ label: 'Category',    field: 'subtitle' }, { label: 'Description', field: 'preview' }],
    'Time_Entry__c':       [{ label: 'Date',         field: 'subtitle' }, { label: 'Notes',       field: 'preview' }],
    'Calendar_Event__c':   [{ label: 'Type',         field: 'subtitle' }, { label: 'Start',       field: 'preview' }],
    'Task':                [{ label: 'Status / Due', field: 'subtitle' }, { label: 'Description', field: 'preview' }],
    'Involved_Parties__c': [{ label: 'Relationship',  field: 'subtitle' }],
    'Involved_Persons__c': [{ label: 'Relationship',  field: 'subtitle' }],
    'Topfiling__c':        [{ label: 'Court Case #',  field: 'subtitle' }, { label: 'Status',      field: 'preview' }],
    'JPA__c':              [{ label: 'JPA Portion',   field: 'subtitle' }],
};

export default class MatterGlobalSearch extends NavigationMixin(LightningElement) {
    @api recordId;
    @track results = [];
    @track isLoading = false;
    @track searchTerm = '';
    @track selectedType = 'all';
    @track error = null;
    _debounceTimer;

    handleSearch(event) {
        this.searchTerm = event.target.value;
        clearTimeout(this._debounceTimer);

        if (this.searchTerm.length < 3) {
            this.results = [];
            return;
        }

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._debounceTimer = setTimeout(() => {
            this.runSearch();
        }, 300);
    }

    runSearch() {
        this.isLoading = true;
        this.error = null;
        this.selectedType = 'all';
        search({ matterId: this.recordId, searchTerm: this.searchTerm })
            .then(data => {
                this.results = data;
            })
            .catch(err => {
                this.error = err?.body?.message || 'Search failed';
                this.results = [];
            })
            .finally(() => {
                this.isLoading = false;
            });
    }

    get totalCount() {
        return this.results.length;
    }

    get filterOptions() {
        const counts = new Map();
        const labels = new Map();
        this.results.forEach(r => {
            counts.set(r.objectType, (counts.get(r.objectType) || 0) + 1);
            if (!labels.has(r.objectType)) labels.set(r.objectType, r.objectLabel);
        });
        return [
            {
                label: 'All',
                value: 'all',
                count: this.results.length,
                pillClass: `filter-pill${this.selectedType === 'all' ? ' active' : ''}`
            },
            ...[...labels.entries()].map(([value, label]) => ({
                label,
                value,
                count: counts.get(value) || 0,
                pillClass: `filter-pill${this.selectedType === value ? ' active' : ''}`
            }))
        ];
    }

    get showTypeFilter() {
        return !this.isLoading && new Set(this.results.map(r => r.objectType)).size > 1;
    }

    handleTypeFilter(event) {
        this.selectedType = event.currentTarget.dataset.value;
    }

    get groupedResults() {
        const filtered = this.selectedType === 'all'
            ? this.results
            : this.results.filter(r => r.objectType === this.selectedType);
        const groupMap = new Map();
        filtered.forEach(r => {
            if (!groupMap.has(r.objectType)) {
                groupMap.set(r.objectType, { type: r.objectType, label: r.objectLabel, iconName: r.iconName, results: [] });
            }
            groupMap.get(r.objectType).results.push(r);
        });
        return [...groupMap.values()].map(g => {
            const cols = COLUMNS[g.type] || [];
            const hasColumns = cols.length > 0;
            const colSuffix = cols.length === 1 ? 'cols-2' : 'cols-3';
            const processedResults = g.results.map(r => ({
                ...r,
                cells: cols.map(c => ({ label: c.label, value: r[c.field] || '' })),
                rowClass: hasColumns ? `result-grid ${colSuffix}` : 'result-item'
            }));
            return {
                ...g,
                count: g.results.length,
                columns: cols,
                hasColumns,
                hasNoColumns: !hasColumns,
                headerClass: `result-grid col-hdr-row ${colSuffix}`,
                results: processedResults
            };
        });
    }

    get hasResults() {
        return !this.isLoading && this.results.length > 0;
    }

    get noResults() {
        return !this.isLoading && this.searchTerm.length >= 3 && this.results.length === 0 && !this.error;
    }

    get showPrompt() {
        return !this.isLoading && this.searchTerm.length < 3;
    }

    handleResultClick(event) {
        const recordId    = event.currentTarget.dataset.id;
        const objectType  = event.currentTarget.dataset.type;

        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId:      recordId,
                objectApiName: objectType,
                actionName:    'view'
            }
        });
    }
}
