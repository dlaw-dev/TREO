import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getEligibleRecipients from '@salesforce/apex/MassTextConsoleController.getEligibleRecipients';
import getSendHistory from '@salesforce/apex/MassTextConsoleController.getSendHistory';
import sendBlast from '@salesforce/apex/MassTextConsoleController.sendBlast';

const SEGMENT_LENGTH = 160;

export default class MassTextConsole extends LightningElement {
    @api recordId;

    recipients = [];
    history = [];
    messageBodyHtml = '';
    selectedContactIds = new Set();
    isConfirmOpen = false;
    isSending = false;
    recipientsError;
    historyError;

    wiredRecipientsResult;
    wiredHistoryResult;

    @wire(getEligibleRecipients, { matterId: '$recordId' })
    wiredRecipients(result) {
        this.wiredRecipientsResult = result;
        const { data, error } = result;
        if (data) {
            this.recipients = data.map(r => ({
                ...r,
                isSelected: this.selectedContactIds.has(r.contactId)
            }));
            this.recipientsError = undefined;
        } else if (error) {
            this.recipientsError = error?.body?.message || 'Unable to load recipients';
            this.recipients = [];
        }
    }

    @wire(getSendHistory, { matterId: '$recordId' })
    wiredHistory(result) {
        this.wiredHistoryResult = result;
        const { data, error } = result;
        if (data) {
            this.history = data;
            this.historyError = undefined;
        } else if (error) {
            this.historyError = error?.body?.message || 'Unable to load history';
            this.history = [];
        }
    }

    // =========================
    // Recipient selection
    // =========================
    get selectableRecipients() {
        return this.recipients.filter(r => !r.isOptedOut);
    }

    get isAllSelected() {
        return this.selectableRecipients.length > 0
            && this.selectableRecipients.every(r => this.selectedContactIds.has(r.contactId));
    }

    get selectedCount() {
        return this.selectedContactIds.size;
    }

    get hasRecipients() {
        return this.recipients.length > 0;
    }

    handleSelectAll(event) {
        const checked = event.target.checked;
        if (checked) {
            this.selectableRecipients.forEach(r => this.selectedContactIds.add(r.contactId));
        } else {
            this.selectedContactIds.clear();
        }
        this.refreshSelectionFlags();
    }

    handleRowSelect(event) {
        const contactId = event.target.dataset.contactId;
        if (event.target.checked) {
            this.selectedContactIds.add(contactId);
        } else {
            this.selectedContactIds.delete(contactId);
        }
        this.refreshSelectionFlags();
    }

    refreshSelectionFlags() {
        this.recipients = this.recipients.map(r => ({
            ...r,
            isSelected: this.selectedContactIds.has(r.contactId)
        }));
    }

    // =========================
    // Compose
    // =========================
    handleMessageChange(event) {
        this.messageBodyHtml = event.target.value;
    }

    // SMS has no concept of rich formatting, so this is what actually gets sent —
    // the rich editor is just a nicer place to type, converted down to plain text with line breaks kept.
    get plainMessageBody() {
        const html = (this.messageBodyHtml || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li)>/gi, '\n');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    get characterCount() {
        return this.plainMessageBody.length;
    }

    get segmentCount() {
        return Math.max(1, Math.ceil(this.plainMessageBody.length / SEGMENT_LENGTH));
    }

    get isSendDisabled() {
        return this.selectedCount === 0 || this.plainMessageBody.length === 0 || this.isSending;
    }

    get sendButtonLabel() {
        return this.selectedCount > 0 ? `Send to ${this.selectedCount}` : 'Send';
    }

    // =========================
    // Confirm + send
    // =========================
    openConfirm() {
        this.isConfirmOpen = true;
    }

    closeConfirm() {
        this.isConfirmOpen = false;
    }

    get confirmRecipients() {
        return this.recipients.filter(r => this.selectedContactIds.has(r.contactId));
    }

    async handleConfirmSend() {
        this.isSending = true;
        const targets = this.confirmRecipients;
        const contactIds = targets.map(r => r.contactId);
        const phoneByContactId = {};
        targets.forEach(r => { phoneByContactId[r.contactId] = r.phone; });

        try {
            await sendBlast({
                matterId: this.recordId,
                contactIds,
                phoneByContactId,
                messageBody: this.plainMessageBody
            });

            this.dispatchEvent(new ShowToastEvent({
                title: 'Sent',
                message: `Message sent to ${contactIds.length} recipient(s).`,
                variant: 'success'
            }));

            this.messageBodyHtml = '';
            this.selectedContactIds.clear();
            this.isConfirmOpen = false;
            await Promise.all([refreshApex(this.wiredRecipientsResult), refreshApex(this.wiredHistoryResult)]);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('massTextConsole sendBlast failed', error);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Send failed',
                message: error?.body?.message || error?.message || 'See browser console for details',
                variant: 'error'
            }));
        } finally {
            this.isSending = false;
        }
    }

    handleRefreshAll() {
        refreshApex(this.wiredRecipientsResult);
        refreshApex(this.wiredHistoryResult);
    }
}
