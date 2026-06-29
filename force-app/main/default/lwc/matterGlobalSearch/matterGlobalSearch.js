import { LightningElement, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import search from '@salesforce/apex/MatterGlobalSearchController.search';

export default class MatterGlobalSearch extends NavigationMixin(LightningElement) {
    @api recordId;
    @track results = [];
    @track isLoading = false;
    @track searchTerm = '';
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

    get groupedResults() {
        const groupMap = new Map();
        this.results.forEach(r => {
            if (!groupMap.has(r.objectType)) {
                groupMap.set(r.objectType, {
                    type: r.objectType,
                    label: r.objectLabel,
                    iconName: r.iconName,
                    results: []
                });
            }
            groupMap.get(r.objectType).results.push(r);
        });
        return [...groupMap.values()].map(g => ({ ...g, count: g.results.length }));
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
