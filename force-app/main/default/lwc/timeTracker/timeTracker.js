import { LightningElement, api, track, wire } from 'lwc';
import getActiveEntry from '@salesforce/apex/TimeTrackerController.getActiveEntry';
import startApex from '@salesforce/apex/TimeTrackerController.start';
import stopApex from '@salesforce/apex/TimeTrackerController.stop';
import pauseApex from '@salesforce/apex/TimeTrackerController.pause';
import resumeApex from '@salesforce/apex/TimeTrackerController.resume';
import saveDetailsWithEditedDuration from '@salesforce/apex/TimeTrackerController.saveDetailsWithEditedDuration';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { publish, MessageContext } from 'lightning/messageService';
import TIMER from '@salesforce/messageChannel/timer__c';

const MATTER_FIELDS = ['NEOS_Matter__c.Name'];

export default class TimeTracker extends LightningElement {
  _modalTimeEntryId = null;
  _modalOpen = false;
  _modalSnapshot = null;
  _modalOriginalStartIso = null; // remember the start time shown when the modal opened
  constructor() {
    super();
    // Prime from local storage before first render to avoid Play-button flash
    try { this._primeFromLocalInCtor(); } catch (e) {}
  }
  _recordId;
  _primedOnRecord = false;
  @api
  get recordId() { return this._recordId; }
  set recordId(value) {
    this._recordId = value;
    // Prime from local as soon as recordId is available (runs before connectedCallback)
    if (!this._primedOnRecord && value) {
      this._primedOnRecord = true;
      try { this._primeFromLocalWithId(value); } catch (e) {}
    }
  }
  @track active = null;
  @track heartbeat = 0;
  tickHandle = null;
  pollHandle = null;
  _awaitingExplicitStart = false; // after a stop/save, ignore transient server 'running' until explicit start
  _pendingUntil = 0; // grace window after explicit start/resume/pause to avoid flicker while server caches warm
  _lastConfirmedAt = 0; // timestamp of last non-null server response (debounce against transient nulls)
  // _nullCount = 0; // consecutive null responses from server (avoid blanking on transient gaps)
  _shortNullDebounceMs = 8000; // tolerate brief server nulls while keeping current UI
  _explicitStopAt = 0; // timestamp of last explicit Stop action; used to allow safe downgrade to null
  _hydrateLockUntil = 0; // while > now, never downgrade hydrated running/paused state to null

  // LMS context for notifying the Utility Bar (and any listeners)
  @wire(MessageContext) messageContext;

  // Local cache so the Utility Bar can discover a running timer even if Apex returns null
  static LS_PREFIX = 'tt:';
  lsKey(id) { return `${TimeTracker.LS_PREFIX}${id}`; }

  _persistFromDTO() {
    try {
      if (!this.recordId) return;
      const a = this.active;
      // If Apex momentarily returns null due to caching/latency, keep last known state; don't clear.
      if (!a) { return; }

      const now = Date.now();
      const startMs = a.startTime ? new Date(a.startTime).getTime() : null;
      const pausedAccumMs = (a.pausedSeconds || 0) * 1000;
      let inProgressPauseMs = 0;
      if (a.isPaused && a.pausedStart) {
        inProgressPauseMs = Math.max(0, now - new Date(a.pausedStart).getTime());
      }
      let netMs = 0;
      if (startMs) {
        const totalMs = Math.max(0, now - startMs);
        netMs = Math.max(0, totalMs - pausedAccumMs - inProgressPauseMs);
      }

      // Choose a representation the Utility can reconstruct:
      // keep accumMs = netMs so it can synthesize a start time
      const payload = {
        ts: now,
        id: a.id || null,
        recordId: this.recordId,
        isRunning: !!a.isRunning,
        isPaused: !!a.isPaused,
        accumMs: netMs,
        startMs: a.isRunning && !a.isPaused ? now : null // so synthetic start = now - accumMs
      };
      localStorage.setItem(this.lsKey(this.recordId), JSON.stringify(payload));
      this._notify('local');
    } catch(e) { /* ignore */ }
  }

  _touchPersist() {
    try {
      if (!this.recordId || !this.active) return;
      const a = this.active;
      const now = Date.now();
      const startMs = a.startTime ? new Date(a.startTime).getTime() : null;
      const pausedAccumMs = (a.pausedSeconds || 0) * 1000;
      let inProgressPauseMs = 0;
      if (a.isPaused && a.pausedStart) {
        inProgressPauseMs = Math.max(0, now - new Date(a.pausedStart).getTime());
      }
      let netMs = 0;
      if (startMs) {
        const totalMs = Math.max(0, now - startMs);
        netMs = Math.max(0, totalMs - pausedAccumMs - inProgressPauseMs);
      }
      const payload = {
        ts: now,
        id: a.id || null,
        recordId: this.recordId,
        isRunning: !!a.isRunning,
        isPaused: !!a.isPaused,
        accumMs: netMs,
        startMs: a.isRunning && !a.isPaused ? now : null
      };
      localStorage.setItem(this.lsKey(this.recordId), JSON.stringify(payload));
      // No LMS publish here — this is just to keep the snapshot fresh
    } catch(e) { /* ignore */ }
  }

  _clearPersist() {
    try {
      if (this.recordId) localStorage.removeItem(this.lsKey(this.recordId));
      this._notify('local');
    } catch(e) {}
  }

  _loadPersist(id) {
    try {
      const rid = id || this.recordId;
      if (!rid) return null;
      const raw = localStorage.getItem(this.lsKey(rid));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  _primeFromLocalWithId(id) {
    try {
      const p = this._loadPersist(id);
      if (!p) return;
      if (!(p.isRunning || p.isPaused)) return;
      const now = Date.now();
      const startMs = p.startMs ? parseInt(p.startMs, 10) : null;
      const accumMs = Math.max(0, parseInt(p.accumMs || 0, 10));
      const snapTs = typeof p.ts === 'number' ? p.ts : 0;
      const tooOld = (Date.now() - snapTs) > 120000;
      if (tooOld) return;
      const startIso = startMs ? new Date(startMs).toISOString() : new Date(now - accumMs).toISOString();
      const dto = {
        id: p.id || null,
        matterId: id,
        isRunning: !!p.isRunning,
        isPaused: !!p.isPaused,
        startTime: startIso,
        pausedSeconds: p.isPaused ? 0 : Math.floor((accumMs || 0) / 1000),
        pausedStart: p.isPaused ? new Date().toISOString() : null,
        durationSeconds: p.isPaused ? Math.floor((accumMs || 0) / 1000) : null,
      };
      // Set state before first render for this recordId
      this.active = dto;
      // Do not start ticking; connectedCallback will handle timers
    } catch (e) { /* ignore */ }
  }

  _primeFromLocalInCtor() {
    try {
      const p = this._loadPersist(this.recordId);
      if (!p) return;
      if (!(p.isRunning || p.isPaused)) return;
      const now = Date.now();
      const startMs = p.startMs ? parseInt(p.startMs, 10) : null;
      const accumMs = Math.max(0, parseInt(p.accumMs || 0, 10));
      // Ignore stale snapshots (> 2 minutes)
      const snapTs = typeof p.ts === 'number' ? p.ts : 0;
      const tooOld = (Date.now() - snapTs) > 120000;
      if (tooOld) return;
      let startIso = null;
      if (startMs) {
        startIso = new Date(startMs).toISOString();
      } else {
        startIso = new Date(now - accumMs).toISOString();
      }
      const dto = {
        id: p.id || null,
        matterId: this.recordId,
        isRunning: !!p.isRunning,
        isPaused: !!p.isPaused,
        startTime: startIso,
        pausedSeconds: p.isPaused ? 0 : Math.floor((accumMs || 0) / 1000),
        pausedStart: p.isPaused ? new Date().toISOString() : null,
        durationSeconds: p.isPaused ? Math.floor((accumMs || 0) / 1000) : null,
      };
      // Set state BEFORE first render
      this.active = dto;
      // Establish protections; do not start timers in ctor
      this._hydrateLockUntil = Date.now() + 20000; // 20s lock
      this._lastConfirmedAt = Date.now();
      this._explicitStopAt = 0;
      this._awaitingExplicitStart = false;
      this._pendingUntil = Date.now() + 8000;
    } catch (e) { /* ignore */ }
  }

  _hydrateFromLocalOnMount() {
    try {
      const p = this._loadPersist();
      if (!p) return;
      if (!(p.isRunning || p.isPaused)) return;
      const now = Date.now();
      const startMs = p.startMs ? parseInt(p.startMs, 10) : null;
      const accumMs = Math.max(0, parseInt(p.accumMs || 0, 10));
      // If persisted snapshot is stale (older than 2 minutes), ignore it
      const snapTs = typeof p.ts === 'number' ? p.ts : 0;
      const tooOld = (Date.now() - snapTs) > 120000;
      if (tooOld) return;
      let startIso = null;
      if (startMs) {
        startIso = new Date(startMs).toISOString();
      } else {
        // Synthesize a start time so elapsed = accumMs
        startIso = new Date(now - accumMs).toISOString();
      }
      const dto = {
        id: p.id || null,
        matterId: this.recordId,
        isRunning: !!p.isRunning,
        isPaused: !!p.isPaused,
        startTime: startIso,
        pausedSeconds: p.isPaused ? 0 : Math.floor((accumMs || 0) / 1000),
        pausedStart: p.isPaused ? new Date().toISOString() : null,
        durationSeconds: p.isPaused ? Math.floor((accumMs || 0) / 1000) : null,
      };
      this.active = dto;
      // Strong guard: keep hydrated UI even if server briefly says null
      this._hydrateLockUntil = Date.now() + 20000; // 20s lock
      this._lastConfirmedAt = Date.now(); // treat hydration as a recent confirmation
      this._explicitStopAt = 0; // we have an active paused session; do not allow downgrade-to-null logic
      this._awaitingExplicitStart = false; // we should accept server state without requiring a new start
      this.resetTicking();
      // Give server a moment to warm cache before we consider downgrades
      this._pendingUntil = Date.now() + 8000;
    } catch (e) { /* ignore */ }
  }

  async _ensureServerActiveId() {
    // If we already have an id from server, use it
    const cur = this.active;
    if (cur && cur.id) return cur.id;

    // Try to load from local persist if available
    const persisted = this._loadPersist();
    if (persisted && persisted.id) {
      // adopt id from local cache (written when we had a server id previously)
      if (this.active) this.active.id = persisted.id;
      return persisted.id;
    }

    // If we think we're active (from local hydration) but lack an id, try a few quick retries
    const shouldRetry = !!(cur && (cur.isRunning || cur.isPaused) && !cur.id);

    const attempts = shouldRetry ? 20 : 1; // up to ~5s total if we should retry
    for (let i = 0; i < attempts; i++) {
      try {
        const latest = await getActiveEntry({ matterId: this.recordId });
        if (latest && latest.id) {
          this.active = latest;
          this.resetTicking();
          return latest.id;
        }
      } catch (e) { /* ignore and retry below */ }
      if (i < attempts - 1) { await this.sleep(250); }
    }

    return null;
  }

  _notify(action, dto) {
    try {
      const safeDto = (dto && typeof dto === 'object') ? { ...dto } : {};
      if (safeDto.id == null) { safeDto.id = this.currentEntryId; }
      const entryId = safeDto.id || this.currentEntryId || null;
      publish(this.messageContext, TIMER, { action, recordId: this.recordId, entryId, dto: safeDto });
    } catch(e) {}
  }

  _suspendPolling(ms = 8000) {
    this._pollResumeAt = Date.now() + ms;
  }

  // Wire the NEOS Matter record to get its Name for the link label
  @wire(getRecord, { recordId: '$recordId', fields: MATTER_FIELDS })
  matterRec;

  connectedCallback() { 
    this._hydrateFromLocalOnMount();
    this.loadActive(); 
    // Proactively resolve real server id if we hydrated from local state
    this._ensureServerActiveId();
    this._notify('refresh');
    this.pollHandle = window.setInterval(() => {
      if (this._pollResumeAt && Date.now() < this._pollResumeAt) { return; }
      if (this.showModal || this._modalOpen) { return; }
      this.loadActive();
    }, 5000); // periodic refresh to avoid stale cache
    this._onBeforeUnload = () => {
      try {
        if (this.active && (this.active.isRunning || this.active.isPaused)) {
          this._persistFromDTO();
        } else {
          this._clearPersist();
        }
      } catch(e) {}
    };
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }
  disconnectedCallback() { 
    this.clearTick(); 
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; }
    if (this._onBeforeUnload) {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
      this._onBeforeUnload = null;
    }
  }

  get isRunning() { return this.active && this.active.isRunning; }
  get isPaused() { return this.active && this.active.isPaused; }

  get currentEntryId() {
    return this._modalTimeEntryId || (this._modalSnapshot && this._modalSnapshot.id) || (this.active && this.active.id) || null;
  }

  get matterUrl() {
    return this.recordId ? `/lightning/r/NEOS_Matter__c/${this.recordId}/view` : '';
  }

  get matterDisplay() {
    const name = this.matterRec ? getFieldValue(this.matterRec.data, 'NEOS_Matter__c.Name') : null;
    return name || this.recordId || 'Open record';
  }

  /* ---- data ---- */
  async loadActive() {
    if (this.showModal || this._modalOpen) { return; }
    try {
      const res = await getActiveEntry({ matterId: this.recordId });

      // Track last time we saw a real server entry (used for transient-null debounce)
      const nowTs = Date.now();
      if (res) { this._lastConfirmedAt = nowTs; }
      const allowDebounce = (Date.now() - this._lastConfirmedAt) < this._shortNullDebounceMs;

      // --- Stable resolution: server is authoritative; otherwise keep current until explicit stop ---
      try {
        if (res) {
          // Server has an entry: adopt it unless we're intentionally awaiting an explicit start
          if (this._awaitingExplicitStart && res.isRunning) {
            // Ignore a running entry until the user explicitly starts again
            // no-op
          } else {
            this.active = res;
            this._hydrateLockUntil = 0;
          }
        } else if (Date.now() < this._pendingUntil) {
          // Within grace period after start/resume/pause: keep current UI
          // no-op
        } else if (allowDebounce && (this.active?.isRunning || this.active?.isPaused)) {
          // Brief transient null from server while actively running/paused: keep current UI
          // no-op
        }
        else if ((this.active?.isRunning || this.active?.isPaused) && Date.now() < this._hydrateLockUntil) {
          // During initial hydration lock, do not downgrade to null
          // no-op
        }
        else if ((this.active?.isRunning || this.active?.isPaused) && !this._explicitStopAt) {
          // Do NOT downgrade to null unless user explicitly stopped
          // no-op
        } else {
          // As a last resort, if local snapshot still says running/paused (and is recent), rehydrate instead of clearing
          const p = this._loadPersist();
          const snapTs = p && typeof p.ts === 'number' ? p.ts : 0;
          const fresh = p && (p.isRunning || p.isPaused) && (Date.now() - snapTs) < 120000; // 2 min freshness
          if (fresh) {
            this._hydrateFromLocalOnMount();
          } else {
            // Safe to show null (e.g., after explicit stop or true inactivity)
            this.active = null;
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[TimeTracker.loadActive] error resolving active state', e);
      }
      // ---------------------------------------------------------------

      this.resetTicking(); // stop ticking if inactive
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }

  /* ---- actions ---- */
  async handleStart() {
    try {
      const res = await startApex({ matterId: this.recordId });
      this.active = res; this.resetTicking();
      this._explicitStopAt = 0; // clear explicit-stop marker on new session
      this._pendingUntil = Date.now() + 10000;         // <-- grace window
      this._awaitingExplicitStart = false;
      this._persistFromDTO();
      this._notify('start', res);
      this._suspendPolling();
      this.toast('Started', 'success');
      this._modalTimeEntryId = null;
    } catch (e) { this.toast(this.errMsg(e), 'error'); }
  }

  async handlePause() {
    try {
      const timeEntryId = this.currentEntryId || (await this._ensureServerActiveId());
      const id = timeEntryId || this.currentEntryId;
      if (!id) { this.toast('Syncing timer… please try again in a moment.', 'warning'); return; }
      const res = await pauseApex({ timeEntryId: id });
      this.active = res; this.resetTicking();
      this._pendingUntil = Date.now() + 10000;         // <-- grace window
      this._persistFromDTO();
      this._notify('pause', res);
      this._suspendPolling();
      this.toast('Paused', 'success');
      this._modalTimeEntryId = null;
    } catch (e) { this.toast(this.errMsg(e), 'error'); this.loadActive(); }
  }

  async handleResume() {
    try {
      const timeEntryId = this.currentEntryId || (await this._ensureServerActiveId());
      const id = timeEntryId || this.currentEntryId;
      if (!id) { this.toast('Syncing timer… please try again in a moment.', 'warning'); return; }
      const res = await resumeApex({ timeEntryId: id });
      this.active = res; this.resetTicking();
      this._explicitStopAt = 0; // clear explicit-stop marker on resume
      this._pendingUntil = Date.now() + 10000;         // <-- grace window
      this._awaitingExplicitStart = false;
      this._persistFromDTO();
      this._notify('resume', res);
      this._suspendPolling();
      this.toast('Resumed', 'success');
      this._modalTimeEntryId = null;
    } catch (e) { this.toast(this.errMsg(e), 'error'); this.loadActive(); }
  }

  async handleStop() {
    try {
      const timeEntryId = this.currentEntryId || (await this._ensureServerActiveId());
      const id = timeEntryId || this.currentEntryId;
      if (!id) { this.toast('Syncing timer… please try again in a moment.', 'warning'); return; }
      this._modalOpen = true;
      this._modalTimeEntryId = id;
      this._pollResumeAt = Date.now() + 60 * 60 * 1000; // hold polling for up to 1 hour while modal is open

      // Capture the server-provided start time BEFORE stopping, so modal defaults to Play time
      const startBeforeStop = this.active?.startTime;

      const res = await stopApex({ timeEntryId: id });
      this.active = res; this.resetTicking();
      this._explicitStopAt = Date.now(); // mark explicit stop so UI can downgrade to null
      // Prevent flicker/race where server briefly reports previous running entry
      this._awaitingExplicitStart = true;
      this._persistFromDTO();

      // Prefill modal fields
      const s = this.active?.durationSeconds ?? 0;
      this.timeSpentStr = this.formatHMS(s);
      this.noteValue = '';
      // Use the start time from BEFORE stop (actual Play/Resume moment),
      // fall back to server startTime or now if unavailable
      const preferredStart = startBeforeStop
        ? new Date(startBeforeStop)
        : (this.active?.startTime ? new Date(this.active.startTime) : new Date());
      this.currentDateTime = this.formatForDatetimeLocal(preferredStart);
      // Remember what we showed when the modal opened; if the user doesn't change it, don't overwrite in Apex
      try { this._modalOriginalStartIso = new Date(preferredStart).toISOString(); } catch(e) { this._modalOriginalStartIso = null; }
      this.showModal = true;
      this._modalSnapshot = { id: this._modalTimeEntryId, durationSeconds: this.active?.durationSeconds ?? 0 };

      // Once stopped, clear local cache and notify listeners so Utility turns off
      this._clearPersist();
      this._notify('stop', res);
      this._suspendPolling();
    } catch (e) { this.toast(this.errMsg(e), 'error'); this.loadActive(); }
  }

  // Format a Date or ISO string for <input type="datetime-local"> (YYYY-MM-DDTHH:mm in local time)
  formatForDatetimeLocal(dt) {
    try {
      const d = (dt instanceof Date) ? dt : new Date(dt);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    } catch(e) { return ''; }
  }

  /* ---- modal handlers ---- */
  handleTimeSpentChange(e) { this.timeSpentStr = e.target.value; }
  handleCurrentDateTimeChange(e) { this.currentDateTime = e.target.value; }
  handleNoteChange(e) { this.noteValue = e.target.value; }
  toggleAutoRestart(e) { this.autoRestart = e.target.checked; }

  closeModal() {
    this.showModal = false;
    this._modalTimeEntryId = null;
    this._modalOpen = false;
    this._modalSnapshot = null;
    this._modalOriginalStartIso = null;
    this._pollResumeAt = Date.now() + 1000; // resume polling shortly
    // Require an explicit user Start before accepting any running state from server
    this._awaitingExplicitStart = true;
  }

  async saveModal() {
    if (!this.noteValue || this.noteValue.trim() === '') {
      this.toast('Please enter a note before saving.', 'error'); return;
    }
    const secs = this.parseDurationToSeconds(this.timeSpentStr);
    if (secs < 0) { this.toast('Enter a valid duration.', 'error'); return; }

    // Parse the user-selected start datetime (local) into ISO for Apex
    const startLocalStr = this.currentDateTime;
    const startDate = startLocalStr ? new Date(startLocalStr) : null;
    if (!startDate || isNaN(startDate.getTime())) { this.toast('Enter a valid start date/time.', 'error'); return; }
    const chosenIso = startDate.toISOString();
    // Only send an edit if the user actually changed the start time in the modal
    const editedStartIso = (this._modalOriginalStartIso && this._modalOriginalStartIso === chosenIso) ? null : chosenIso;

    try {
      const entryId = this.currentEntryId;
      if (!entryId) { this.toast('Syncing timer… please try again in a moment.', 'warning'); return; }
      const res = await saveDetailsWithEditedDuration({
        timeEntryId: entryId,
        notes: this.noteValue,
        editedSeconds: secs,
        editedStartIso: editedStartIso
      });
      this.active = res;
      this.resetTicking();
      this._notify('save', res);
      this.showModal = false;
      this._modalOriginalStartIso = null;
      this.toast('Time entry saved', 'success');
      this._modalTimeEntryId = null;
      this._modalOpen = false;
      this._modalSnapshot = null;
      this._pollResumeAt = Date.now() + 1000; // resume polling

      if (this.autoRestart) {
        const started = await startApex({ matterId: this.recordId });
        this.active = started; this.resetTicking();
        this._awaitingExplicitStart = false;
        this._persistFromDTO();
        this._notify('start', started);
        this.toast('New timer started', 'success');
      }
    } catch (e) { this.toast(this.errMsg(e), 'error'); }
  }

  /* ---- ticking ---- */
  resetTicking() {
    this.clearTick();
    this.heartbeat++;
    this._tickCount = 0;
    const runningAndNotPaused = this.active && this.active.isRunning && !this.active.isPaused;
    if (runningAndNotPaused) {
      this.tickHandle = window.setInterval(() => {
        this.heartbeat = (this.heartbeat + 1) % 1000000;
        this._tickCount = (this._tickCount || 0) + 1;
        if (this._tickCount % 5 === 0) { this._touchPersist(); }
      }, 1000);
    }
  }
  clearTick() { if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; } }

  get elapsedLabel() {
    // touch heartbeat for reactivity
    // eslint-disable-next-line no-unused-expressions
    this.heartbeat;
    if (!this.active) return '';

    const startMs = this.active.startTime ? new Date(this.active.startTime).getTime() : null;
    if (!startMs) return '';

    const nowMs = Date.now();
    const pausedAccum = this.active.pausedSeconds || 0; // seconds already accumulated

    let inProgressPause = 0;
    if (this.active.isPaused && this.active.pausedStart) {
      const ps = new Date(this.active.pausedStart).getTime();
      inProgressPause = Math.max(0, Math.floor((nowMs - ps) / 1000));
    }

    const totalElapsed = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    const netSeconds = Math.max(0, totalElapsed - pausedAccum - inProgressPause);

    if (this.active.isPaused) {
      // Prefer a frozen display value if we have one from hydration
      if (this.active.durationSeconds != null) {
        return `Elapsed: ${this.formatHMS(this.active.durationSeconds)}`;
      }
      const netFrozen = Math.max(0, totalElapsed - pausedAccum);
      return `Elapsed: ${this.formatHMS(netFrozen)}`;
    }

    if (this.active.isRunning) {
      return `Elapsed: ${this.formatHMS(netSeconds)}`;
    }

    if (this.active.durationSeconds != null) {
      return `Last session: ${this.formatHMS(this.active.durationSeconds)}`;
    }

    return '';
  }

  /* ---- utils ---- */
  sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  formatHMS(totalSeconds = 0) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
  }

  // Accepts HH:MM:SS, MM:SS, SS, or 1h 7m 18s / 7m18s / 78s
  parseDurationToSeconds(input) {
    if (!input) return 0;
    const str = String(input).trim().toLowerCase();
    if (str.includes(':')) {
      const parts = str.split(':').map(p => p.trim());
      if (parts.length === 3) {
        const [h,m,s] = parts.map(v => parseInt(v,10) || 0);
        return Math.max(0, h*3600 + m*60 + s);
      }
      if (parts.length === 2) {
        const [m,s] = parts.map(v => parseInt(v,10) || 0);
        return Math.max(0, m*60 + s);
      }
      if (parts.length === 1) {
        const s = parseInt(parts[0],10) || 0;
        return Math.max(0, s);
      }
    }
    const hMatch = str.match(/(\d+)\s*h/);
    const mMatch = str.match(/(\d+)\s*m/);
    const sMatch = str.match(/(\d+)\s*s/);
    if (hMatch || mMatch || sMatch) {
      const h = hMatch ? parseInt(hMatch[1],10) : 0;
      const m = mMatch ? parseInt(mMatch[1],10) : 0;
      const s = sMatch ? parseInt(sMatch[1],10) : 0;
      return Math.max(0, h*3600 + m*60 + s);
    }
    const plain = parseInt(str,10);
    return Math.max(0, isNaN(plain) ? 0 : plain);
  }

  toast(message, variant) { this.dispatchEvent(new ShowToastEvent({ title: 'Time Tracker', message, variant })); }
  errMsg(e) {
    const msg = e && (e.body && e.body.message ? e.body.message : e.message);
    if (typeof msg === 'string' && /reading 'id'/.test(msg)) {
      return 'Timer entry reference was lost. Please close the modal and stop the timer again.';
    }
    return msg || 'Unknown error';
  }
}
