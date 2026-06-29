import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { refreshApex } from '@salesforce/apex';

export default class ReceivedDocsChecklist extends LightningElement {
    @api recordId;
    @api objectApiName;

    @track isEditing = false;
    @track isFormLoading = false;
    _wiredResult;

    @wire(getRecord, { recordId: '$recordId', fields: '$_fields' })
    wiredRecord(result) {
        this._wiredResult = result;
    }

    get _fields() {
        return this.objectApiName ? [`${this.objectApiName}.Received_Docs__c`] : [];
    }

    get items() {
        const data = this._wiredResult?.data;
        if (!data || !this.objectApiName) return [];
        const raw = getFieldValue(data, `${this.objectApiName}.Received_Docs__c`);
        if (!raw) return [];
        return raw.split(';').map(v => v.trim()).filter(Boolean);
    }

    get hasItems() {
        return this.items.length > 0;
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
