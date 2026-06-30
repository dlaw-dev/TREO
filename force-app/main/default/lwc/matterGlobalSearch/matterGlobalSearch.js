import { LightningElement, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import search from '@salesforce/apex/MatterGlobalSearchController.search';
import browseAll from '@salesforce/apex/MatterGlobalSearchController.browseAll';

const COLUMNS = {
    'NEOS_Notes__c':             [{ label: 'Category',    field: 'subtitle' }, { label: 'Date',        field: 'preview' }],
    'Time_Entry__c':             [{ label: 'Duration',     field: 'subtitle' }],
    'Calendar_Event__c':         [{ label: 'Type',         field: 'subtitle' }, { label: 'Start',       field: 'preview' }],
    'Task':                      [{ label: 'Status / Due', field: 'subtitle' }, { label: 'Description', field: 'preview' }],
    'Involved_Parties__c':       [{ label: 'Relationship', field: 'subtitle' }],
    'Involved_Persons__c':       [{ label: 'Relationship', field: 'subtitle' }],
    'Topfiling__c':              [{ label: 'Court Case #', field: 'subtitle' }, { label: 'Status',      field: 'preview' }],
    'JPA__c':                    [{ label: 'JPA Portion',  field: 'subtitle' }],
    'Counsel_Junction__c':       [{ label: 'Type',         field: 'subtitle' }],
};

// Override the "Name" header label for objects where the title column isn't literally a name
const TITLE_LABELS = {
    'NEOS_Notes__c': 'Staff',
    'Time_Entry__c': 'Staff',
};

const SEARCHABLE_OBJECTS = [
    { type: 'NEOS_Notes__c',             label: 'Notes',              tagClass: 'search-tag tag-notes'       },
    { type: 'Time_Entry__c',             label: 'Time Entries',       tagClass: 'search-tag tag-time'        },
    { type: 'Calendar_Event__c',         label: 'Events',             tagClass: 'search-tag tag-event'       },
    { type: 'Task',                      label: 'Tasks',              tagClass: 'search-tag tag-task'        },
    { type: 'Involved_Parties__c',       label: 'Parties',            tagClass: 'search-tag tag-party'       },
    { type: 'Involved_Persons__c',       label: 'Persons',            tagClass: 'search-tag tag-person'      },
    { type: 'Topfiling__c',              label: 'Top Filings',        tagClass: 'search-tag tag-filing'      },
    { type: 'JPA__c',                    label: 'JPAs',               tagClass: 'search-tag tag-jpa'         },
    { type: 'Counsel_Junction__c',       label: 'Counsel',            tagClass: 'search-tag tag-counsel'     },
    { type: 'Arbitration_Details__c',    label: 'Arbitration',        tagClass: 'search-tag tag-arbitration' },
    { type: 'NEOS_Expense__c',           label: 'Expenses',           tagClass: 'search-tag tag-expense'     },
];

export default class MatterGlobalSearch extends NavigationMixin(LightningElement) {
    @api recordId;
    @track results = [];
    @track isLoading = false;
    @track searchTerm = '';
    @track selectedType = 'all';
    @track error = null;

    @track browseType = null;
    @track browseLabel = '';
    @track browseResults = [];
    @track isBrowseLoading = false;

    _debounceTimer;

    get searchableObjects() {
        return SEARCHABLE_OBJECTS;
    }

    // ── Search ───────────────────────────────────────────────

    handleSearch(event) {
        this.searchTerm = event.target.value;
        if (this.isInBrowseMode) {
            this.browseType = null;
            this.browseResults = [];
        }
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
            .then(data => { this.results = data; })
            .catch(err => {
                this.error = err?.body?.message || 'Search failed';
                this.results = [];
            })
            .finally(() => { this.isLoading = false; });
    }

    // ── Browse ───────────────────────────────────────────────

    handleTagClick(event) {
        const type  = event.currentTarget.dataset.type;
        const label = event.currentTarget.dataset.label;
        this.browseType    = type;
        this.browseLabel   = label;
        this.browseResults = [];
        this.isBrowseLoading = true;
        this.searchTerm = '';
        this.results = [];
        browseAll({ matterId: this.recordId, objectType: type })
            .then(data => { this.browseResults = data; })
            .catch(() => { this.browseResults = []; })
            .finally(() => { this.isBrowseLoading = false; });
    }

    handleBackToSearch() {
        this.browseType    = null;
        this.browseLabel   = '';
        this.browseResults = [];
    }

    // ── Filter pills ─────────────────────────────────────────

    get filterOptions() {
        const counts = new Map();
        const labels = new Map();
        this.results.forEach(r => {
            counts.set(r.objectType, (counts.get(r.objectType) || 0) + 1);
            if (!labels.has(r.objectType)) labels.set(r.objectType, r.objectLabel);
        });
        return [
            {
                label: 'All', value: 'all',
                count: this.results.length,
                pillClass: `filter-pill${this.selectedType === 'all' ? ' active' : ''}`
            },
            ...[...labels.entries()].map(([value, label]) => ({
                label, value,
                count: counts.get(value) || 0,
                pillClass: `filter-pill${this.selectedType === value ? ' active' : ''}`
            }))
        ];
    }

    handleTypeFilter(event) {
        this.selectedType = event.currentTarget.dataset.value;
    }

    // ── Computed state ────────────────────────────────────────

    get isInBrowseMode() {
        return this.browseType !== null;
    }

    get anyLoading() {
        return this.isLoading || this.isBrowseLoading;
    }

    get loadingText() {
        return this.isInBrowseMode
            ? `Loading all ${this.browseLabel}...`
            : 'Searching across all records...';
    }

    get totalCount() {
        return this.isInBrowseMode ? this.browseResults.length : this.results.length;
    }

    get showTypeFilter() {
        return !this.anyLoading && !this.isInBrowseMode && new Set(this.results.map(r => r.objectType)).size > 1;
    }

    get hasResults() {
        if (this.isInBrowseMode) return !this.isBrowseLoading && this.browseResults.length > 0;
        return !this.isLoading && this.results.length > 0;
    }

    get noResults() {
        return !this.isLoading && !this.isInBrowseMode && this.searchTerm.length >= 3 && this.results.length === 0 && !this.error;
    }

    get showBrowseEmpty() {
        return this.isInBrowseMode && !this.isBrowseLoading && this.browseResults.length === 0;
    }

    get showPrompt() {
        return !this.anyLoading && !this.isInBrowseMode && this.searchTerm.length < 3;
    }

    // ── Grouped results (shared for search + browse) ──────────

    get groupedResults() {
        const source = this.isInBrowseMode
            ? this.browseResults
            : (this.selectedType === 'all'
                ? this.results
                : this.results.filter(r => r.objectType === this.selectedType));

        const groupMap = new Map();
        source.forEach(r => {
            if (!groupMap.has(r.objectType)) {
                groupMap.set(r.objectType, { type: r.objectType, label: r.objectLabel, iconName: r.iconName, results: [] });
            }
            groupMap.get(r.objectType).results.push(r);
        });
        return [...groupMap.values()].map(g => {
            const cols = COLUMNS[g.type] || [];
            const hasColumns = cols.length > 0;
            const colSuffix = cols.length === 1 ? 'cols-2' : 'cols-3';
            const titleLabel = TITLE_LABELS[g.type] || 'Name';
            const processedResults = g.results.map(r => ({
                ...r,
                cells: cols.map(c => ({ label: c.label, value: r[c.field] || '' })),
                rowClass: hasColumns ? `result-grid ${colSuffix}` : 'result-item'
            }));
            return {
                ...g,
                count: g.results.length,
                columns: cols,
                titleLabel,
                hasColumns,
                hasNoColumns: !hasColumns,
                headerClass: `result-grid col-hdr-row ${colSuffix}`,
                results: processedResults
            };
        });
    }

    // ── Navigation ────────────────────────────────────────────

    handleResultClick(event) {
        const recordId   = event.currentTarget.dataset.id;
        const objectType = event.currentTarget.dataset.type;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId, objectApiName: objectType, actionName: 'view' }
        });
    }
}
