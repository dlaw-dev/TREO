import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { deleteRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import getCompanionMatters from '@salesforce/apex/CompanionMattersController.getCompanionMatters';

const COLUMNS = [
    {
        label: 'Matter Name',
        fieldName: 'url',
        type: 'url',
        typeAttributes: { label: { fieldName: 'name' }, target: '_self' },
        sortable: true
    },
    { label: 'Stage', fieldName: 'stage', type: 'text', sortable: true },
    { label: 'Senior Attorney', fieldName: 'seniorAttorney', type: 'text', sortable: true },
    { label: 'Associate Attorney', fieldName: 'associateAttorney', type: 'text', sortable: true },
    {
        type: 'action',
        typeAttributes: {
            rowActions: [
                { label: 'View', name: 'view' },
                { label: 'Edit', name: 'edit' },
                { label: 'Delete', name: 'delete' }
            ]
        }
    }
];

export default class CompanionMatters extends NavigationMixin(LightningElement) {
    @api recordId;
    @api cardTitle = 'Companion Matters';
    @api numberOfRecords = 10;

    columns = COLUMNS;
    matters = [];
    isLoading = true;
    error;
    sortedBy;
    sortedDirection = 'asc';

    wiredResult;

    @wire(getCompanionMatters, { matterId: '$recordId', maxRecords: '$numberOfRecords' })
    wiredMatters(result) {
        this.wiredResult = result;
        const { data, error } = result;
        this.isLoading = false;
        if (data) {
            this.matters = data.map((m) => ({
                id: m.Id,
                url: `/${m.Id}`,
                name: m.Name,
                stage: m.Stage__c,
                seniorAttorney: m.Senior_Attorney__r ? m.Senior_Attorney__r.Name : '',
                associateAttorney: m.Associate_Attorney__r ? m.Associate_Attorney__r.Name : ''
            }));
            this.error = undefined;
        } else if (error) {
            this.error = error.body ? error.body.message : error.message;
            this.matters = [];
        }
    }

    get hasMatters() {
        return this.matters.length > 0;
    }

    get showEmptyState() {
        return !this.isLoading && !this.error && !this.hasMatters;
    }

    get title() {
        return `${this.cardTitle} (${this.matters.length})`;
    }

    handleSort(event) {
        const { fieldName, sortDirection } = event.detail;
        const dir = sortDirection === 'asc' ? 1 : -1;
        this.matters = [...this.matters].sort((a, b) => {
            const valA = a[fieldName] ?? '';
            const valB = b[fieldName] ?? '';
            if (valA > valB) return dir;
            if (valA < valB) return -dir;
            return 0;
        });
        this.sortedBy = fieldName;
        this.sortedDirection = sortDirection;
    }

    async handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;

        if (actionName === 'view') {
            this.navigateToRecord(row.id, 'view');
        } else if (actionName === 'edit') {
            this.navigateToRecord(row.id, 'edit');
        } else if (actionName === 'delete') {
            await this.handleDelete(row);
        }
    }

    async handleDelete(row) {
        const confirmed = await LightningConfirm.open({
            message: `Delete ${row.name}? This can't be undone.`,
            label: 'Delete Matter',
            variant: 'headerless'
        });
        if (!confirmed) {
            return;
        }
        try {
            await deleteRecord(row.id);
            this.dispatchEvent(
                new ShowToastEvent({ title: 'Success', message: 'Matter deleted', variant: 'success' })
            );
            refreshApex(this.wiredResult);
        } catch (e) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Error deleting matter',
                    message: e.body ? e.body.message : e.message,
                    variant: 'error'
                })
            );
        }
    }

    navigateToRecord(recordId, actionName) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId, objectApiName: 'NEOS_Matter__c', actionName }
        });
    }
}
