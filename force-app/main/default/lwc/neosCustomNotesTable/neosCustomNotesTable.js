import { LightningElement, wire, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getCustomNotes from '@salesforce/apex/NeosMatterCustomNotesController.getCustomNotes';

const COLUMNS = [
    {
        label: '📌',
        fieldName: 'PinnedIcon',
        type: 'text',
        initialWidth: 60,
        cellAttributes: { alignment: 'center' }
    },
    {
        label: 'Date',
        fieldName: 'NEOS_Created_Date__c',
        type: 'date',
        initialWidth: 200,
        typeAttributes: {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }
    },
    {
        label: 'Staff',
        fieldName: 'StaffName',
        type: 'text',
        initialWidth: 120
    },
    {
        label: 'Note Category',
        fieldName: 'Note_Category__c',
        type: 'text',
        initialWidth: 180
    },
    {
        label: 'Note Description',
        fieldName: 'CleanDescription',
        type: 'text',
        wrapText: true,
        cellAttributes: {
            class: 'slds-cell-wrap note-description-cell'
        }
    },
    {
        type: 'action',
        typeAttributes: {
            rowActions: [{ label: 'View', name: 'view' }]
        }
    }
];

export default class NeosMatterNotesTable extends NavigationMixin(LightningElement) {
    @api recordId;
    @track wiredNotesResult;

    notes = [];
    columns = COLUMNS;
    errorMessage;

    // Flow modal
    isFlowOpen = false;

    get flowInputVariables() {
        return [{ name: 'NeosMatterRecord', type: 'SObject', value: { Id: this.recordId } }];
    }

    openFlow() { this.isFlowOpen = true; }
    closeFlow() { this.isFlowOpen = false; }

    handleFlowStatusChange(event) {
        const status = event.detail.status;
        if (status === 'FINISHED' || status === 'FINISHED_SCREEN') {
            this.isFlowOpen = false;
            this.refreshNotes();
        }
    }

    // Sorting
    isChronological = false;

    // Pagination
    pageSize = 25;
    currentPage = 1;

    // 🔍 Search
    searchKey = '';
    searchTimeout;

    pageSizeOptions = [
        { label: '25', value: 25 },
        { label: '50', value: 50 },
        { label: '100', value: 100 }
    ];

    // =========================
    // UI Handlers
    // =========================
    handleToggleMode(event) {
        this.isChronological = event.target.checked;
        this.currentPage = 1;
    }

    handlePageSizeChange(event) {
        this.pageSize = parseInt(event.detail.value, 10);
        this.currentPage = 1;
    }

    handleNextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
        }
    }

    handlePrevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
        }
    }

    // 🔍 Search handler (debounced)
    handleSearch(event) {
        clearTimeout(this.searchTimeout);
        const value = event.target.value;

        this.searchTimeout = setTimeout(() => {
            this.searchKey = value ? value.toLowerCase() : '';
            this.navigateToSearchResult();
        }, 300);
    }

    // =========================
    // Getters
    // =========================
    get totalPages() {
        return Math.ceil(this.displayNotes.length / this.pageSize) || 1;
    }

    get hasMultiplePages() {
        return this.totalPages > 1;
    }

    get paginatedNotes() {
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return this.displayNotes.slice(start, end);
    }

    get isPrevDisabled() {
        return this.currentPage === 1;
    }

    get isNextDisabled() {
        return this.currentPage === this.totalPages;
    }

    get hasResults() {
        return this.displayNotes.length > 0;
    }

    get displayNotes() {
        let rows = Array.isArray(this.notes) ? [...this.notes] : [];

        // 🔍 Apply search filter
        if (this.searchKey) {
            rows = rows.filter(row => {
                return (
                    row.CleanDescription?.toLowerCase().includes(this.searchKey) ||
                    row.StaffName?.toLowerCase().includes(this.searchKey) ||
                    row.Note_Category__c?.toLowerCase().includes(this.searchKey)
                );
            });
        }

        // Sorting
        if (this.isChronological) {
            return rows.sort((a, b) => new Date(b.NEOS_Created_Date__c) - new Date(a.NEOS_Created_Date__c));
        }

        return rows.sort((a, b) => {
            const aPinned = a.PinnedIcon === '📌' ? 1 : 0;
            const bPinned = b.PinnedIcon === '📌' ? 1 : 0;

            if (aPinned !== bPinned) {
                return bPinned - aPinned;
            }

            return new Date(b.NEOS_Created_Date__c) - new Date(a.NEOS_Created_Date__c);
        });
    }

    // =========================
    // Auto Navigate to Match
    // =========================
    navigateToSearchResult() {
        if (!this.searchKey) {
            this.currentPage = 1;
            return;
        }

        const index = this.displayNotes.findIndex(row => {
            return (
                row.CleanDescription?.toLowerCase().includes(this.searchKey) ||
                row.StaffName?.toLowerCase().includes(this.searchKey) ||
                row.Note_Category__c?.toLowerCase().includes(this.searchKey)
            );
        });

        if (index !== -1) {
            this.currentPage = Math.floor(index / this.pageSize) + 1;
        }
    }

    // =========================
    // Lifecycle safety
    // =========================
    renderedCallback() {
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
    }

    // =========================
    // Data
    // =========================
    @wire(getCustomNotes, { parentId: '$recordId' })
    wiredNotes(result) {
        this.wiredNotesResult = result;
        const { error, data } = result;

        if (data) {
            this.notes = [...data].map(row => {
                const cleanText = this.sanitizeHtml(row.Note_Description__c || '');

                const isPinned =
                    row.Pinned_Note__c === true ||
                    row.Pinned_Note__c === 'true' ||
                    row.Pinned_Note__c === 1 ||
                    row.Pinned_Note__c === '1';

                return {
                    ...row,
                    linkName: '/' + row.Id,
                    StaffName: row.Staff__r?.Name || '',
                    CleanDescription: cleanText,
                    PinnedIcon: isPinned ? '📌' : ''
                };
            });

            this.errorMessage = undefined;
        } else if (error) {
            this.errorMessage = error?.body?.message || 'Unknown error';
            this.notes = [];
        }
    }

    refreshNotes() {
        return refreshApex(this.wiredNotesResult);
    }

    async handleRefresh() {
        await this.refreshNotes();
    }

    handleNoteCreated() {
        this.refreshNotes();
    }

    sanitizeHtml(input) {
        const doc = new DOMParser().parseFromString(input, 'text/html');
        let text = doc.body.textContent || '';
        return text.replace(/-\s*\n\s*/g, '');
    }

    // =========================
    // Navigation
    // =========================
    handleRowAction(event) {
        const action = event.detail.action;
        const row = event.detail.row;

        if (action.name === 'view') {
            this.navigateToRecord(row.Id);
        }
    }

    navigateToRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId,
                objectApiName: 'NEOS_Notes__c',
                actionName: 'view'
            }
        });
    }
}