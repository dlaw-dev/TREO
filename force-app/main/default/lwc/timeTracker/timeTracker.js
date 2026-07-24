import { LightningElement, api, track, wire } from 'lwc';
import getActiveEntry from '@salesforce/apex/TimeTrackerController.getActiveEntry';
import startApex from '@salesforce/apex/TimeTrackerController.start';
import stopApex from '@salesforce/apex/TimeTrackerController.stop';
import pauseApex from '@salesforce/apex/TimeTrackerController.pause';
import resumeApex from '@salesforce/apex/TimeTrackerController.resume';
import saveDetailsWithEditedDuration from '@salesforce/apex/TimeTrackerController.saveDetailsWithEditedDuration';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { publish, subscribe, unsubscribe, APPLICATION_SCOPE, MessageContext } from 'lightning/messageService';
import TIMER from '@salesforce/messageChannel/timer__c';
import {
  formatHMS,
  parseDurationToSeconds,
  computeNetSeconds,
  computeClockOffsetMs,
  writeCrossWindowState,
  readCrossWindowState,
  crossWindowStateToDTO
} from 'c/timerCore';

const MATTER_FIELDS = ['NEOS_Matter__c.Name'];
const FALLBACK_TIMEOUT_MS = 400; // how long to wait for timerUtility to answer before asking Apex ourselves

// This component sits on the Matter record page and gets torn down/rebuilt by Salesforce
// Console on every primary-tab swap. It intentionally does NOT own the clock or poll Apex
// on an interval — timerUtility (the utility bar item, which stays mounted across tab
// swaps) is the single source of truth. On mount this asks timerUtility "what's running
// for this matter?" over LMS, and only falls back to a direct Apex call if nothing answers
// (e.g. no Console utility bar present). This removes the two-writers-racing pattern that
// used to cause the displayed elapsed time to skip/glitch on tab swap.
export default class TimeTracker extends LightningElement {
  _modalTimeEntryId = null;
  _modalOpen = false;
  _modalSnapshot = null;
  _modalOriginalStartIso = null; // remember the start time shown when the modal opened

  _recordId;
  @api
  get recordId() {
    return this._recordId;
  }
  set recordId(value) {
    this._recordId = value;
  }

  @track active = null; // TimeEntryDTO | null
  @track heartbeat = 0;
  tickHandle = null;

  _clockOffsetMs = 0;
  _resolved = false;
  _fallbackHandle = null;
  subscription = null;
  _storageListener;

  @wire(MessageContext) messageContext;

  // Wire the NEOS Matter record to get its Name for the link label
  @wire(getRecord, { recordId: '$recordId', fields: MATTER_FIELDS })
  matterRec;

  connectedCallback() {
    this.subscription = subscribe(this.messageContext, TIMER, (message) => this.handleMessage(message), { scope: APPLICATION_SCOPE });

    this._storageListener = () => this.handleStorageEvent();
    window.addEventListener('storage', this._storageListener);

    this.requestState();
  }

  disconnectedCallback() {
    this.clearTick();
    if (this.subscription) {
      try {
        unsubscribe(this.subscription);
      } catch (e) {
        /* ignore */
      }
      this.subscription = null;
    }
    if (this._storageListener) {
      window.removeEventListener('storage', this._storageListener);
      this._storageListener = null;
    }
    if (this._fallbackHandle) {
      clearTimeout(this._fallbackHandle);
      this._fallbackHandle = null;
    }
  }

  /* ---- sync ---- */
  requestState() {
    this._resolved = false;
    try {
      publish(this.messageContext, TIMER, { type: 'getState', matterId: this.recordId });
    } catch (e) {
      /* ignore */
    }
    this._fallbackHandle = setTimeout(() => {
      if (!this._resolved) {
        this.loadActiveViaApex();
      }
    }, FALLBACK_TIMEOUT_MS);
  }

  handleMessage(message) {
    if (!message) return;
    const { type, matterId, dto, clockOffsetMs, action } = message;
    if (matterId !== this.recordId) return;

    if (type === 'stateResponse') {
      this._resolved = true;
      this._clockOffsetMs = clockOffsetMs || 0;
      this.active = dto || null;
      this.resetTicking();
      return;
    }
    if (type === 'actionOccurred') {
      this._resolved = true;
      if (dto?.serverNow) this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = dto || null;
      this.resetTicking();
      if (action === 'stop') this.closeModal();
    }
  }

  handleStorageEvent() {
    const payload = readCrossWindowState();
    if (payload && payload.matterId === this.recordId) {
      this._resolved = true;
      this._clockOffsetMs = payload.clockOffsetMs || 0;
      this.active = crossWindowStateToDTO(payload);
      this.resetTicking();
    }
  }

  async loadActiveViaApex() {
    try {
      const dto = await getActiveEntry({ matterId: this.recordId });
      this._resolved = true;
      if (dto) this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = dto || null;
      this.resetTicking();
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  notify(action, dto) {
    try {
      publish(this.messageContext, TIMER, { type: 'actionOccurred', action, matterId: this.recordId, dto });
    } catch (e) {
      /* ignore */
    }
    writeCrossWindowState(dto, this._clockOffsetMs, this.matterDisplay);
  }

  get isRunning() {
    return this.active && this.active.isRunning;
  }
  get isPaused() {
    return this.active && this.active.isPaused;
  }

  get currentEntryId() {
    return this._modalTimeEntryId || this._modalSnapshot?.id || this.active?.id || null;
  }

  get matterUrl() {
    return this.recordId ? `/lightning/r/NEOS_Matter__c/${this.recordId}/view` : '';
  }

  get matterDisplay() {
    const name = this.matterRec ? getFieldValue(this.matterRec.data, 'NEOS_Matter__c.Name') : null;
    return name || this.recordId || 'Open record';
  }

  /* ---- actions ---- */
  async handleStart() {
    try {
      const dto = await startApex({ matterId: this.recordId });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = dto;
      this.resetTicking();
      this.notify('start', dto);
      this.toast('Started', 'success');
      this._modalTimeEntryId = null;
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  async handlePause() {
    try {
      const id = this.currentEntryId;
      if (!id) {
        this.toast('Syncing timer… please try again in a moment.', 'warning');
        return;
      }
      const dto = await pauseApex({ timeEntryId: id });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = dto;
      this.resetTicking();
      this.notify('pause', dto);
      this.toast('Paused', 'success');
      this._modalTimeEntryId = null;
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  async handleResume() {
    try {
      const id = this.currentEntryId;
      if (!id) {
        this.toast('Syncing timer… please try again in a moment.', 'warning');
        return;
      }
      const dto = await resumeApex({ timeEntryId: id });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = dto;
      this.resetTicking();
      this.notify('resume', dto);
      this.toast('Resumed', 'success');
      this._modalTimeEntryId = null;
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  async handleStop() {
    try {
      const id = this.currentEntryId;
      if (!id) {
        this.toast('Syncing timer… please try again in a moment.', 'warning');
        return;
      }
      this._modalOpen = true;
      this._modalTimeEntryId = id;

      // Capture the server-provided start time BEFORE stopping, so modal defaults to Play time
      const startBeforeStop = this.active?.startTime;

      const dto = await stopApex({ timeEntryId: id });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = { ...dto, isRunning: false };
      this.resetTicking();

      // Prefill modal fields
      const s = this.active?.durationSeconds ?? 0;
      this.timeSpentStr = formatHMS(s);
      this.noteValue = '';
      const preferredStart = startBeforeStop ? new Date(startBeforeStop) : this.active?.startTime ? new Date(this.active.startTime) : new Date();
      this.currentDateTime = this.formatForDatetimeLocal(preferredStart);
      try {
        this._modalOriginalStartIso = new Date(preferredStart).toISOString();
      } catch (e) {
        this._modalOriginalStartIso = null;
      }
      this.showModal = true;
      this._modalSnapshot = { id: this._modalTimeEntryId, durationSeconds: this.active?.durationSeconds ?? 0 };

      this.notify('stop', dto);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  // Format a Date or ISO string for <input type="datetime-local"> (YYYY-MM-DDTHH:mm in local time)
  formatForDatetimeLocal(dt) {
    try {
      const d = dt instanceof Date ? dt : new Date(dt);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    } catch (e) {
      return '';
    }
  }

  /* ---- modal handlers ---- */
  handleTimeSpentChange(e) {
    this.timeSpentStr = e.target.value;
  }
  handleCurrentDateTimeChange(e) {
    this.currentDateTime = e.target.value;
  }
  handleNoteChange(e) {
    this.noteValue = e.target.value;
  }
  toggleAutoRestart(e) {
    this.autoRestart = e.target.checked;
  }

  closeModal() {
    this.showModal = false;
    this._modalTimeEntryId = null;
    this._modalOpen = false;
    this._modalSnapshot = null;
    this._modalOriginalStartIso = null;
  }

  async saveModal() {
    if (!this.noteValue || this.noteValue.trim() === '') {
      this.toast('Please enter a note before saving.', 'error');
      return;
    }
    const secs = parseDurationToSeconds(this.timeSpentStr);
    if (secs < 0) {
      this.toast('Enter a valid duration.', 'error');
      return;
    }

    const startLocalStr = this.currentDateTime;
    const startDate = startLocalStr ? new Date(startLocalStr) : null;
    if (!startDate || isNaN(startDate.getTime())) {
      this.toast('Enter a valid start date/time.', 'error');
      return;
    }
    const chosenIso = startDate.toISOString();
    const editedStartIso = this._modalOriginalStartIso && this._modalOriginalStartIso === chosenIso ? null : chosenIso;

    try {
      const entryId = this.currentEntryId;
      if (!entryId) {
        this.toast('Syncing timer… please try again in a moment.', 'warning');
        return;
      }
      const dto = await saveDetailsWithEditedDuration({
        timeEntryId: entryId,
        notes: this.noteValue,
        editedSeconds: secs,
        editedStartIso
      });
      this.active = dto;
      this.resetTicking();
      this.notify('save', dto);
      this.showModal = false;
      this._modalOriginalStartIso = null;
      this.toast('Time entry saved', 'success');
      this._modalTimeEntryId = null;
      this._modalOpen = false;
      this._modalSnapshot = null;

      if (this.autoRestart) {
        const started = await startApex({ matterId: this.recordId });
        this._clockOffsetMs = computeClockOffsetMs(started.serverNow);
        this.active = started;
        this.resetTicking();
        this.notify('start', started);
        this.toast('New timer started', 'success');
      }
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  /* ---- ticking ---- */
  resetTicking() {
    this.clearTick();
    this.heartbeat++;
    const runningAndNotPaused = this.active && this.active.isRunning && !this.active.isPaused;
    if (runningAndNotPaused) {
      this.tickHandle = window.setInterval(() => {
        this.heartbeat = (this.heartbeat + 1) % 1000000;
      }, 1000);
    }
  }
  clearTick() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  get elapsedLabel() {
    // eslint-disable-next-line no-unused-expressions
    this.heartbeat;
    if (!this.active || !this.active.startTime) return '';

    const correctedNow = Date.now() + this._clockOffsetMs;
    const netSeconds = computeNetSeconds(this.active, correctedNow);

    if (this.active.isPaused) {
      if (this.active.durationSeconds != null) {
        return `Elapsed: ${formatHMS(this.active.durationSeconds)}`;
      }
      return `Elapsed: ${formatHMS(netSeconds)}`;
    }
    if (this.active.isRunning) {
      return `Elapsed: ${formatHMS(netSeconds)}`;
    }
    if (this.active.durationSeconds != null) {
      return `Last session: ${formatHMS(this.active.durationSeconds)}`;
    }
    return '';
  }

  /* ---- utils ---- */
  toast(message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title: 'Time Tracker', message, variant }));
  }
  errMsg(e) {
    const msg = e && (e.body && e.body.message ? e.body.message : e.message);
    if (typeof msg === 'string' && /reading 'id'/.test(msg)) {
      return 'Timer entry reference was lost. Please close the modal and stop the timer again.';
    }
    return msg || 'Unknown error';
  }
}
