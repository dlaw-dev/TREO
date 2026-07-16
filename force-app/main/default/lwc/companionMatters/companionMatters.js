import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { deleteRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import CHESS_ICON from '@salesforce/resourceUrl/companionMattersChessIcon';
import getCompanionMatters from '@salesforce/apex/CompanionMattersController.getCompanionMatters';

function mapMatters(data) {
    return data.map((m) => ({
        id: m.Id,
        url: `/${m.Id}`,
        name: m.Name,
        stage: m.Stage__c,
        seniorAttorney: m.Senior_Attorney__r ? m.Senior_Attorney__r.Name : '',
        seniorAttorneyUrl: m.Senior_Attorney__c ? `/${m.Senior_Attorney__c}` : null,
        associateAttorney: m.Associate_Attorney__r ? m.Associate_Attorney__r.Name : '',
        associateAttorneyUrl: m.Associate_Attorney__c ? `/${m.Associate_Attorney__c}` : null
    }));
}

export default class CompanionMatters extends NavigationMixin(LightningElement) {
    @api recordId;
    @api cardTitle = 'Companion Matters';
    @api numberOfRecords = 10;

    chessIconUrl = CHESS_ICON;
    matters = [];
    isLoading = true;
    error;

    wiredResult;

    @wire(getCompanionMatters, { matterId: '$recordId', maxRecords: '$numberOfRecords' })
    wiredMatters(result) {
        this.wiredResult = result;
        const { data, error } = result;
        this.isLoading = false;
        if (data) {
            this.matters = mapMatters(data);
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

    navigateToMatter(event) {
        event.preventDefault();
        this.navigateToRecord(event.currentTarget.dataset.id, 'view');
    }

    async handleRowActionSelect(event) {
        const actionName = event.detail.value;
        const matterId = event.currentTarget.dataset.id;
        const matterName = event.currentTarget.dataset.name;

        if (actionName === 'view') {
            this.navigateToRecord(matterId, 'view');
        } else if (actionName === 'edit') {
            this.navigateToRecord(matterId, 'edit');
        } else if (actionName === 'delete') {
            await this.handleDelete({ id: matterId, name: matterName });
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
