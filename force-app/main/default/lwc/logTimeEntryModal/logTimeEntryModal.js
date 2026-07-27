import { api } from 'lwc';
import LightningModal from 'lightning/modal';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import logCompletedEntry from '@salesforce/apex/TimeTrackerController.logCompletedEntry';

// Visual language (card, hours chips, green submit, checkmark success view)
// matches matterTimeEntryPanel (TREO_Dashboard_Build repo) for consistency
// across the org's time-entry UIs - simplified here to a single entry since
// this opens for exactly one just-completed task, not a batch submission.
const QUICK_HOURS = ['0.1', '0.5', '1', '2', '3', '4', '5'];

// Opened right after a task is marked complete, on the Matter's task list
// and from the Task Hub utility - an optional, skippable prompt to log time
// against that Matter for the work just finished. Unlike timeTracker's own
// stop-modal, there's no active/running entry backing this: it inserts a
// fully-formed Time_Entry__c directly via TimeTrackerController.logCompletedEntry.
export default class LogTimeEntryModal extends LightningModal {
    @api matterId;
    @api taskSubject;

    view = 'fill'; // 'fill' | 'success'
    hours = '';
    noteValue = '';
    isSaving = false;
    loggedHoursLabel = '';

    connectedCallback() {
        this.noteValue = this.taskSubject || '';
    }

    get isFillView() {
        return this.view === 'fill';
    }

    get isSuccessView() {
        return this.view === 'success';
    }

    get hoursChips() {
        return QUICK_HOURS.map((h) => ({
            value: h,
            cls: h === this.hours ? 'lte-chip lte-chip--active' : 'lte-chip'
        }));
    }

    get isSaveDisabled() {
        return this.isSaving || !(parseFloat(this.hours) > 0) || !this.noteValue || !this.noteValue.trim();
    }

    handleHoursChange(e) {
        const raw = e.target.value;
        const match = String(raw).match(/^(\d*\.?\d?)/);
        const clean = match ? match[1] : '';
        if (clean !== raw) e.target.value = clean;
        this.hours = clean;
    }

    handleQuickHours(e) {
        this.hours = e.currentTarget.dataset.hours;
    }

    handleNoteChange(e) {
        this.noteValue = e.target.value;
    }

    handleSkip() {
        this.close('skipped');
    }

    async handleSave() {
        if (this.isSaveDisabled) return;

        const hoursNum = parseFloat(this.hours);

        this.isSaving = true;
        try {
            await logCompletedEntry({ matterId: this.matterId, notes: this.noteValue, hours: hoursNum });
            this.loggedHoursLabel = `${hoursNum} ${hoursNum === 1 ? 'hour' : 'hours'}`;
            this.view = 'success';
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not log time',
                message: e.body?.message || e.message,
                variant: 'error'
            }));
        } finally {
            this.isSaving = false;
        }
    }

    handleDone() {
        this.close('success');
    }
}
