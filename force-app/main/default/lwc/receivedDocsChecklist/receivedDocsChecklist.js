import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { refreshApex } from '@salesforce/apex';
import getPicklistOptions from '@salesforce/apex/ReceivedDocsChecklistController.getPicklistOptions';

export default class ReceivedDocsChecklist extends LightningElement {
    @api recordId;
    @api objectApiName;
    @api fieldApiName = 'Received_Docs__c';
    @api sectionLabel = 'Docs';

    @track isEditing = false;
    @track isFormLoading = false;
    @track isOpen = true;
    _wiredResult;
    _allOptions = [];

    @wire(getPicklistOptions, { objectApiName: '$objectApiName', fieldApiName: '$fieldApiName' })
    wiredOptions({ data }) {
        if (data) this._allOptions = data;
    }

    @wire(getRecord, { recordId: '$recordId', fields: '$_fields' })
    wiredRecord(result) {
        this._wiredResult = result;
    }

    get _fields() {
        return this.objectApiName && this.fieldApiName
            ? [`${this.objectApiName}.${this.fieldApiName}`]
            : [];
    }

    get _selectedSet() {
        const data = this._wiredResult?.data;
        if (!data || !this.objectApiName) return new Set();
        const raw = getFieldValue(data, `${this.objectApiName}.${this.fieldApiName}`);
        if (!raw) return new Set();
        return new Set(raw.split(';').map(v => v.trim()).filter(Boolean));
    }

    get receivedItems() {
        return this._allOptions.filter(v => this._selectedSet.has(v));
    }

    get outstandingItems() {
        return this._allOptions.filter(v => !this._selectedSet.has(v));
    }

    get hasReceived() {
        return this.receivedItems.length > 0;
    }

    get hasOutstanding() {
        return this.outstandingItems.length > 0;
    }

    get chevronIcon() {
        return this.isOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    toggleSection(event) {
        event.stopPropagation();
        this.isOpen = !this.isOpen;
    }

    handleEdit() {
        this.isEditing = true;
        this.isFormLoading = true;
    }

    handleFormLoad() {
        this.isFormLoading = false;
    }

    handleCancel() {
        this.isEditing = false;
    }

    handleSuccess() {
        this.isEditing = false;
        refreshApex(this._wiredResult);
    }
}
