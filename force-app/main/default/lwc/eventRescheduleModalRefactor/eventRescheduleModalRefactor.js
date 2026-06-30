import { api } from 'lwc';
import LightningModal from 'lightning/modal';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import rescheduleEvent from '@salesforce/apex/EventAttendeeUiControllerRefactor.rescheduleEvent';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import FLATPICKR from '@salesforce/resourceUrl/Flatpickr';

export default class EventRescheduleModal extends LightningModal {
    @api eventId;
    @api subject;
    @api originalStart;
    @api originalEnd;
    @api isAllDay = false;
    @api description;

    newDate;
    newEndDate;
    newDescription = '';
    startTime;
    endTime;
    isSaving = false;
    errorMessage = '';
    _durationMs = 60 * 60 * 1000;
    isAllDayLocal = false;

    _fpDate = null;
    _fpEndDate = null;
    _flatpickrLoaded = false;

    get showTimes() { return !this.isAllDayLocal; }
    get startDateLabel() { return this.isAllDayLocal ? 'Start Date' : 'New Date'; }

    connectedCallback() {
        this.isAllDayLocal = this.isAllDay;
        this.newDescription = this.description || '';
        const start = this.toLocalParts(this.originalStart);
        this.newDate = start?.date || '';

        if (this.isAllDayLocal) {
            const end = this.toLocalParts(this.originalEnd);
            this.newEndDate = end?.date || this.newDate;
        } else {
            const end = this.toLocalParts(this.originalEnd) || this.addMinutesToParts(start, 60);
            if (this.originalStart && this.originalEnd) {
                const diff = new Date(this.originalEnd).getTime() - new Date(this.originalStart).getTime();
                if (diff > 0) this._durationMs = diff;
            }
            this.startTime = start?.time || '';
            this.endTime = end?.time || '';
        }

        Promise.all([
            loadStyle(this, FLATPICKR + '/Flatpickr/flatpickr.min.css'),
            loadScript(this, FLATPICKR + '/Flatpickr/flatpickr.min.js')
        ]).then(() => {
            this._flatpickrLoaded = true;
            this._initFlatpickr();
        }).catch(() => {});
    }

    renderedCallback() {
        if (!this._flatpickrLoaded) return;
        if (!this._fpDate) {
            this._initFlatpickr();
            return;
        }
        // End date picker is conditionally in DOM — sync on each render
        const endEl = this.template.querySelector('[data-id="end-date-input"]');
        if (endEl && !this._fpEndDate) {
            this._fpEndDate = this._makePicker(endEl, this.newEndDate, (dates) => {
                if (!dates.length) return;
                this.newEndDate = this.formatDateOnly(dates[0]);
            });
        } else if (!endEl && this._fpEndDate) {
            this._fpEndDate.destroy();
            this._fpEndDate = null;
        }
    }

    handleAllDayToggle(e) {
        this.isAllDayLocal = e.target.checked;
        this.errorMessage = '';
        if (this.isAllDayLocal) {
            // timed → all-day: keep date, clear times, default end = start date
            this.newEndDate = this.newDate;
            this.startTime = '';
            this.endTime = '';
        } else {
            // all-day → timed: restore sensible default times
            this.startTime = '09:00';
            this.endTime = '10:00';
            this.newEndDate = '';
        }
        // renderedCallback will add/remove _fpEndDate as the DOM updates
    }

    handleStartTimeChange(e) {
        this.startTime = this.normalizeTimeValue(e.target.value);
        this.errorMessage = '';

        const newEndParts = this.addMinutesToParts(
            { date: this.newDate, time: this.startTime },
            this._durationMs / 60000
        );
        if (newEndParts) this.endTime = newEndParts.time;
    }

    handleEndTimeChange(e) {
        this.endTime = this.normalizeTimeValue(e.target.value);
        this.errorMessage = '';
    }

    handleDescriptionChange(e) {
        this.newDescription = e.target.value;
    }

    handleCancel() {
        this.close(null);
    }

    /* -------------------------
       Flatpickr
    -------------------------- */

    _makePicker(el, defaultVal, onChangeCb) {
        const fp = window.flatpickr;
        if (!el || typeof fp !== 'function') return null;
        return fp(el, {
            enableTime: false,
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'm/d/Y',
            altInputClass: 'slds-input',
            allowInput: true,
            monthSelectorType: 'dropdown',
            appendTo: document.body,
            disableMobile: true,
            defaultDate: defaultVal || undefined,
            onChange: onChangeCb
        });
    }

    _initFlatpickr() {
        if (this._fpDate) return;
        const dateEl = this.template.querySelector('[data-id="date-input"]');
        if (!dateEl || typeof window.flatpickr !== 'function') return;

        this._fpDate = this._makePicker(dateEl, this.newDate, (dates) => {
            if (!dates.length) return;
            this.newDate = this.formatDateOnly(dates[0]);
            this.errorMessage = '';
            // Keep end date >= start date in all-day mode
            if (this.isAllDayLocal && this.newEndDate && this.newEndDate < this.newDate) {
                this.newEndDate = this.newDate;
                if (this._fpEndDate) this._fpEndDate.setDate(this.newDate, false);
            }
        });

        // End date only exists in DOM when all-day is already on at init time
        const endEl = this.template.querySelector('[data-id="end-date-input"]');
        if (endEl) {
            this._fpEndDate = this._makePicker(endEl, this.newEndDate, (dates) => {
                if (!dates.length) return;
                this.newEndDate = this.formatDateOnly(dates[0]);
                this.errorMessage = '';
            });
        }
    }

    formatDateOnly(date) {
        const p = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    }

    disconnectedCallback() {
        if (this._fpDate)    { this._fpDate.destroy();    this._fpDate    = null; }
        if (this._fpEndDate) { this._fpEndDate.destroy(); this._fpEndDate = null; }
    }

    async handleSave() {
        let newStartIso, newEndIso;

        if (this.isAllDayLocal) {
            if (!this.newDate)    { this.errorMessage = 'Start date is required.'; return; }
            if (!this.newEndDate) { this.errorMessage = 'End date is required.';   return; }
            if (this.newEndDate < this.newDate) {
                this.errorMessage = 'End date must be on or after start date.';
                return;
            }
            newStartIso = this.toIsoString(`${this.newDate}T00:00`);
            newEndIso   = this.toIsoString(`${this.newEndDate}T00:00`);
        } else {
            const newStart = this.combineDateAndTime(this.newDate, this.startTime);
            const newEnd = this.combineDateAndTime(this.newDate, this.endTime);
            newStartIso = this.toIsoString(newStart);
            newEndIso = this.toIsoString(newEnd);

            if (!newStartIso || !newEndIso) {
                this.errorMessage = 'Both start and end are required.';
                return;
            }
            if (new Date(newEndIso) <= new Date(newStartIso)) {
                this.errorMessage = 'End must be after Start.';
                return;
            }
        }
        this.isSaving = true;
        try {
            await rescheduleEvent({
                eventId:        this.eventId,
                newStartIso,
                newEndIso,
                isAllDay:       this.isAllDayLocal,
                newDescription: this.newDescription || null
            });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Rescheduled',
                message: 'Event rescheduled successfully.',
                variant: 'success'
            }));
            this.close('success');
        } catch (err) {
            this.errorMessage = err?.body?.message || 'An error occurred.';
        } finally {
            this.isSaving = false;
        }
    }

    toLocalParts(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? this.parseInputParts(value) : this.partsFromDate(date);
    }

    parseInputParts(value) {
        if (!value) return null;
        const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        return match ? { date: match[1], time: match[2] } : null;
    }

    addMinutesToParts(parts, minutes) {
        if (!parts) return null;
        const isoStr = this.toIsoString(this.combineDateAndTime(parts.date, parts.time));
        if (!isoStr) return '';
        const date = new Date(new Date(isoStr).getTime() + minutes * 60 * 1000);
        return this.partsFromDate(date);
    }

    partsFromDate(date) {
        const localDateTime = this.formatLocalDateTime(date);
        return this.parseInputParts(localDateTime);
    }

    normalizeTimeValue(value) {
        if (!value) return '';
        const match = String(value).match(/^(\d{2}:\d{2})/);
        return match ? match[1] : value;
    }

    combineDateAndTime(dateValue, timeValue) {
        if (!dateValue || !timeValue) return '';
        return `${dateValue}T${this.normalizeTimeValue(timeValue)}`;
    }

    toIsoString(value) {
        if (!value) return null;
        // Parse YYYY-MM-DDTHH:mm explicitly as local time.
        // new Date(string) without timezone can be treated as UTC in some environments.
        const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (!match) return null;
        const date = new Date(
            parseInt(match[1], 10),
            parseInt(match[2], 10) - 1,
            parseInt(match[3], 10),
            parseInt(match[4], 10),
            parseInt(match[5], 10)
        );
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    formatLocalDateTime(date) {
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}