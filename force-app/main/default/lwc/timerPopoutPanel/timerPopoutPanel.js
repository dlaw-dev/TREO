import { LightningElement, track } from 'lwc';
import getActiveEntry from '@salesforce/apex/TimeTrackerController.getActiveEntry';
import startApex from '@salesforce/apex/TimeTrackerController.start';
import stopApex from '@salesforce/apex/TimeTrackerController.stop';
import pauseApex from '@salesforce/apex/TimeTrackerController.pause';
import resumeApex from '@salesforce/apex/TimeTrackerController.resume';
import getRecentEntries from '@salesforce/apex/TimeTrackerController.getRecentEntries';
import {
  formatHMS,
  computeNetSeconds,
  computeClockOffsetMs,
  writeCrossWindowState,
  readCrossWindowState,
  crossWindowStateToDTO
} from 'c/timerCore';

// Hosted inside the timerPopout Aura standalone app (see force-app/main/default/aura/timerPopout),
// opened via window.open() as a genuinely separate browser window. Lightning Message Service does
// NOT bridge to a separate window, so this component syncs with the main Salesforce tab purely via
// localStorage + the native 'storage' event (see timerCore's cross-window helpers), plus its own
// direct Apex polling as a slower fallback.
const POLL_INTERVAL_MS = 15000;
const HISTORY_REFRESH_MS = 60000;

export default class TimerPopoutPanel extends LightningElement {
  @track active = null;
  @track historyGroups = [];
  heartbeat = 0;

  _clockOffsetMs = 0;
  tickHandle;
  pollHandle;
  historyHandle;
  _storageListener;

  connectedCallback() {
    this._storageListener = (evt) => this.handleStorageEvent(evt);
    window.addEventListener('storage', this._storageListener);

    // Prime immediately from whatever the main tab last wrote, then confirm with Apex.
    const cached = readCrossWindowState();
    if (cached) {
      this._clockOffsetMs = cached.clockOffsetMs || 0;
      this.active = crossWindowStateToDTO(cached);
      this.resetTicking();
    }

    this.loadActive();
    this.loadHistory();
    this.pollHandle = setInterval(() => this.loadActive(), POLL_INTERVAL_MS);
    this.historyHandle = setInterval(() => this.loadHistory(), HISTORY_REFRESH_MS);
  }

  disconnectedCallback() {
    if (this._storageListener) {
      window.removeEventListener('storage', this._storageListener);
      this._storageListener = null;
    }
    clearInterval(this.pollHandle);
    clearInterval(this.historyHandle);
    this._tickOff();
  }

  handleStorageEvent(evt) {
    if (evt && evt.key && evt.key !== 'treo:timer:state') return;
    const payload = readCrossWindowState();
    if (!payload) {
      this.active = null;
      this.resetTicking();
      return;
    }
    this._clockOffsetMs = payload.clockOffsetMs || 0;
    this.active = crossWindowStateToDTO(payload);
    this.resetTicking();
  }

  async loadActive() {
    try {
      const dto = await getActiveEntry({ matterId: null });
      if (dto) this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.active = dto || null;
      this.resetTicking();
    } catch (e) {
      /* keep showing last known state on transient errors */
    }
  }

  async loadHistory() {
    try {
      this.historyGroups = (await getRecentEntries({ daysBack: 7 })) || [];
    } catch (e) {
      /* ignore */
    }
  }

  adopt(dto) {
    this.active = dto || null;
    this.resetTicking();
    writeCrossWindowState(this.active, this._clockOffsetMs, this.matterName);
  }

  get isRunning() {
    return !!this.active?.isRunning && !this.active?.isPaused;
  }
  get isPaused() {
    return !!this.active?.isRunning && !!this.active?.isPaused;
  }
  get pauseDisabled() {
    return !this.isRunning;
  }
  get resumeDisabled() {
    return !this.isPaused;
  }
  get stopDisabled() {
    return !this.active?.isRunning;
  }
  get matterName() {
    return this.active?.matterName || '—';
  }
  get hasHistory() {
    return (this.historyGroups || []).some((g) => g.entries && g.entries.length);
  }

  get elapsedLabel() {
    // eslint-disable-next-line no-unused-expressions
    this.heartbeat;
    if (!this.active?.startTime) return '';
    const correctedNow = Date.now() + this._clockOffsetMs;
    const netSeconds = computeNetSeconds(this.active, correctedNow);
    return this.active.isRunning ? `Elapsed: ${formatHMS(netSeconds)}` : this.active.durationSeconds != null ? `Last: ${formatHMS(this.active.durationSeconds)}` : '';
  }

  async handlePause() {
    if (!this.active?.id) return;
    try {
      const dto = await pauseApex({ timeEntryId: this.active.id });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.adopt(dto);
    } catch (e) {
      /* ignore */
    }
  }

  async handleResume() {
    if (!this.active?.id) return;
    try {
      const dto = await resumeApex({ timeEntryId: this.active.id });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.adopt(dto);
    } catch (e) {
      /* ignore */
    }
  }

  async handleStop() {
    if (!this.active?.id) return;
    try {
      const dto = await stopApex({ timeEntryId: this.active.id });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.adopt({ ...dto, isRunning: false });
      this.loadHistory();
    } catch (e) {
      /* ignore */
    }
  }

  async handleRestart(event) {
    const matterId = event.detail?.matterId;
    if (!matterId) return;
    try {
      const dto = await startApex({ matterId });
      this._clockOffsetMs = computeClockOffsetMs(dto.serverNow);
      this.adopt(dto);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---- ticking ---- */
  resetTicking() {
    this._tickOff();
    if (this.active?.isRunning && !this.active?.isPaused) {
      this.tickHandle = setInterval(() => {
        this.heartbeat = (this.heartbeat + 1) % 1000000;
      }, 1000);
    }
  }
  _tickOff() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }
}
