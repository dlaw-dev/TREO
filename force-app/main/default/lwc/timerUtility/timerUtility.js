import { LightningElement, track } from 'lwc';
import { subscribe, unsubscribe, APPLICATION_SCOPE, MessageContext, publish } from 'lightning/messageService';
import TIMER from '@salesforce/messageChannel/timer__c';
import { wire } from 'lwc';
import getActiveEntry from '@salesforce/apex/TimeTrackerController.getActiveEntry';
import startApex from '@salesforce/apex/TimeTrackerController.start';
import stopApex from '@salesforce/apex/TimeTrackerController.stop';
import pauseApex from '@salesforce/apex/TimeTrackerController.pause';
import resumeApex from '@salesforce/apex/TimeTrackerController.resume';

const LOCAL_PREFIX = 'tt:'; // localStorage key prefix(es) used by record-page timers (may be multiple prefixes)
const VERSION_KEY = 'tt:version';

export default class TimerUtility extends LightningElement {
  @track active;     // { id, isRunning, isPaused, startTime, pausedSeconds, pausedStart, matterId, matterName, durationSeconds? }
  heartbeat = 0;
  tickHandle;
  pollHandle;
  _lastStopAt = 0; // timestamp to suppress stale localStorage after stop
  _awaitingStart = true; // start by trusting server only; ignore localStorage until an explicit LMS 'start'
  _pendingUntil = 0; // grace window after LMS start/resume/pause to avoid flicker
  _lastConfirmedAt = 0; // timestamp of last non-null server response (debounce nulls)
  _nullCount = 0; // consecutive null responses from server (used to avoid blanking on transient cache gaps)

  subscription = null;
  @wire(MessageContext) messageContext;

  connectedCallback() {
    this.refreshActive();
    // React to cross-tab/localStorage changes via version key (LWS-safe)
    this._versionLast = localStorage.getItem(VERSION_KEY) || '0';
    this._versionPoll = setInterval(() => {
      try {
        const v = localStorage.getItem(VERSION_KEY) || '0';
        if (v !== this._versionLast) {
          this._versionLast = v;
          this.refreshActive();
        }
      } catch (e) { /* noop */ }
    }, 1000);
    // lightweight poll so the utility reacts if a different tab/page starts/stops
    this.pollHandle = setInterval(() => this.refreshActive(), 5000);
    this.subscription = subscribe(
      this.messageContext,
      TIMER,
      (message) => {
        // message shape: { action, recordId, dto }
        const action = message && message.action;
        const dto = message && message.dto;
        if (action === 'start' || action === 'resume' || action === 'pause') {
          this._pendingUntil = Date.now() + 10000;
        }
        if (dto) {
          // Trust the page's DTO as source of truth; ensure matterId present
          if (!dto.matterId && message.recordId) dto.matterId = message.recordId;
          if (action === 'stop' || dto.isRunning === false) {
            // Keep a non-running snapshot so we can show the final duration ("Last: ...")
            const id = dto.matterId || this.active?.matterId;
            this.active = {
              ...dto,
              isRunning: false
            };
            this._tickOff();
            this._clearLocal(id);
            this._lastStopAt = Date.now();
            this._awaitingStart = true;
            this.heartbeat = (this.heartbeat + 1) % 1000000;
          } else {
            this.active = dto;
            this._persistLocalFromDTO(this.active);
            this._resetTicking();
            if (action === 'start') this._awaitingStart = false;
          }
          return;
        }
        if (action === 'stop') {
          // Hard-stop if no DTO was provided
          const id = this.active?.matterId;
          this.active = null;
          this._tickOff();
          this._clearLocal(id);
          this._lastStopAt = Date.now();
          this._awaitingStart = true;
          this.heartbeat = (this.heartbeat + 1) % 1000000; // force re-render
          return;
        }
        // Otherwise refresh from server/local
        this.refreshActive();
      },
      { scope: APPLICATION_SCOPE }
    );
  }
  disconnectedCallback() {
    if (this.subscription) {
      try { unsubscribe(this.subscription); } catch (e) {}
      this.subscription = null;
    }
    if (this._versionPoll) { try { clearInterval(this._versionPoll); } catch (e) {} this._versionPoll = null; }
    clearInterval(this.pollHandle);
    this._tickOff();
  }

  get isRunning() { return this.active?.isRunning && !this.active?.isPaused; }
  get isPaused()  { return this.active?.isRunning &&  this.active?.isPaused; }
  get isStopped() { return !this.active || !this.active?.isRunning; }
  get isPausedOrStopped() { return this.isPaused || this.isStopped; }

  get startDisabled() {
    // Start enabled only when there is a matter and nothing is currently running
    return this.isRunning || !this.active?.matterId;
  }
  get pauseDisabled() {
    // Pause disabled when not running or already paused
    return !this.isRunning || this.isPaused;
  }
  get resumeDisabled() {
    // Resume disabled unless currently paused
    return !this.isPaused;
  }
  get stopDisabled() {
    // Stop disabled when nothing is running
    return !this.isRunning;
  }

  get matterName() { return this.active?.matterName || '—'; }
  get matterUrl()  { return this.active?.matterId ? `/lightning/r/${this.active.matterId}/view` : '#'; }

  async refreshActive() {
    let serverDto = null;
    try {
      serverDto = await getActiveEntry({ matterId: null /* server returns user's active entry */ });
    } catch (e) {
      // ignore and fall back to client cache
    }
    const nowTs = Date.now();
    if (serverDto) { this._lastConfirmedAt = nowTs; }

    // Fallback: discover an active timer from localStorage (record-page timer state)
    let localDto = null;
    if (!serverDto) {
      const now = Date.now();
      const suppressLocal = this._awaitingStart || (this._lastStopAt && (now - this._lastStopAt < 4000));
      if (!suppressLocal) {
        localDto = this._loadFromLocalStorage();
      }
    }

    // If server returned something but without matterId, try to merge from local
    if (serverDto && !serverDto.matterId) {
      if (!localDto) localDto = this._loadFromLocalStorage();
      if (localDto?.matterId) {
        serverDto.matterId = localDto.matterId;
        if (!serverDto.matterName && localDto.matterName) serverDto.matterName = localDto.matterName;
      } else if (this.active?.matterId) {
        serverDto.matterId = this.active.matterId;
        if (!serverDto.matterName && this.active.matterName) serverDto.matterName = this.active.matterName;
      }
    }

    // Track consecutive null responses to avoid blanking on transient cache gaps
    if (typeof this._nullCount !== 'number') this._nullCount = 0;
    if (serverDto) {
      this._nullCount = 0;
      this.active = serverDto;
    } else if (Date.now() < this._pendingUntil && localDto) {
      // During grace after a recent action, keep a local snapshot to avoid blanking
      this._nullCount = 0;
      this.active = localDto;
    } else if ((Date.now() - this._lastConfirmedAt) < 20000 && (this.active?.isRunning || this.active?.isPaused)) {
      // Transient null from server; tolerate up to two consecutive nulls within 20s of last good data
      this._nullCount += 1;
      if (this._nullCount < 2) {
        return; // keep showing current state; do not blank yet
      }
    } else {
      this._nullCount = 0;
      this._clearAllLocal();
      this.active = null;
    }
    this._resetTicking();
    if (!this.active) {
      this._debugWhyNoActive();
    }
  }

  _debugWhyNoActive() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      // eslint-disable-next-line no-console
      console.debug('[timerUtility] No active from Apex or localStorage. Keys:', keys);
    } catch {}
  }

  _loadFromLocalStorage() {
    // Only consider our own prefix and only when we can reconstruct a running clock
    const PREFIXES = ['tt:'];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const prefix = PREFIXES.find(p => key.startsWith(p));
        if (!prefix) continue;

        const raw = localStorage.getItem(key);
        if (!raw) continue;
        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }

        const startMs  = Number(payload?.startMs ?? 0) || null;
        const accumMs  = Number(payload?.accumMs ?? 0) || 0;
        const isPaused = !!payload?.isPaused;
        const isRunning = !!payload?.isRunning;
        const stopped = !!payload?.stopped;

        // Ignore anything marked stopped
        if (stopped) continue;
        if (!isRunning) continue;

        // Derive matter id strictly from key (we no longer trust payload.recordId)
        const matterId = key.substring(prefix.length);

        const now = Date.now();
        let startTimeIso;
        let pausedStartIso = null;

        if (startMs) {
          // Running case: compute synthetic start accounting for accumMs
          const elapsedWhileRunning = isPaused ? 0 : Math.max(0, now - startMs);
          const syntheticStart = now - (accumMs + elapsedWhileRunning);
          startTimeIso = new Date(syntheticStart).toISOString();
          // If flagged paused but we have a startMs, assume pause just began now
          if (isPaused) pausedStartIso = new Date().toISOString();
        } else if (isPaused && accumMs > 0) {
          // Paused-only snapshot (no current startMs): reconstruct so elapsed stays constant
          // Treat as: started at now - accumMs, and paused since now
          startTimeIso = new Date(now - accumMs).toISOString();
          pausedStartIso = new Date().toISOString();
        } else {
          // Can't reconstruct reliably
          continue;
        }

        // eslint-disable-next-line no-console
        console.debug('[timerUtility] local active candidate', { key, matterId, isRunning, isPaused });

        return {
          id: null,
          isRunning,
          isPaused,
          startTime: startTimeIso,
          pausedSeconds: 0,
          pausedStart: pausedStartIso,
          matterId,
          matterName: null,
          durationSeconds: null
        };
      }
    } catch (e) {
      // ignore parsing errors
    }
    return null;
  }

  async _ensureActiveFromServer() {
    try {
      if (this.active?.id) return true; // already have entry id
      const matterId = this.active?.matterId;
      if (!matterId) return false;
      const dto = await getActiveEntry({ matterId });
      if (dto) {
        if (!dto.matterId) dto.matterId = matterId;
        this.active = dto;
        return true;
      }
    } catch (e) {}
    return false;
  }

  _bumpVersion() {
    try { localStorage.setItem(VERSION_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  _persistLocalFromDTO(dto) {
    try {
      const matterId = dto?.matterId;
      if (!matterId) return;
      const key = `${LOCAL_PREFIX}${matterId}`;
      // Normalize a compact payload that the record-page timer also understands
      const payload = {
        isRunning: !!dto?.isRunning,
        isPaused:  !!dto?.isPaused,
        startMs:   dto?.startTime ? new Date(dto.startTime).getTime() : 0,
        accumMs:   Math.max(0, (dto?.pausedSeconds || 0) * 1000),
        stopped:   !dto?.isRunning
      };
      localStorage.setItem(key, JSON.stringify(payload));
      this._bumpVersion();
    } catch (e) { /* ignore */ }
  }

  _clearAllLocal() {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LOCAL_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      this._bumpVersion();
    } catch (e) { /* ignore */ }
  }

  _clearLocal(matterId) {
    try {
      if (!matterId) return;
      const key = `${LOCAL_PREFIX}${matterId}`;
      localStorage.removeItem(key);
      this._bumpVersion();
    } catch (e) { /* ignore */ }
  }

  async handleStart() {
    try {
      const matterId = this.active?.matterId;
      if (!matterId) return;
      const res = await startApex({ matterId });
      if (res && !res.matterId) res.matterId = matterId;
      this.active = res; this._resetTicking();
      this._persistLocalFromDTO(this.active);
      publish(this.messageContext, TIMER, { action: 'start', recordId: matterId, dto: this.active });
      this._awaitingStart = false;
    } catch (e) { /* ignore */ }
  }

  async handlePause() {
    try {
      const ok = await this._ensureActiveFromServer();
      if (!ok || !this.active?.id) return;
      const matterId = this.active?.matterId;
      const res = await pauseApex({ timeEntryId: this.active.id });
      if (res && !res.matterId) res.matterId = matterId;
      this.active = res; this._resetTicking();
      this._persistLocalFromDTO(this.active);
      publish(this.messageContext, TIMER, { action: 'pause', recordId: matterId, dto: this.active });
    } catch (e) { /* ignore */ }
  }

  async handleResume() {
    try {
      const ok = await this._ensureActiveFromServer();
      if (!ok || !this.active?.id) return;
      const matterId = this.active?.matterId;
      const res = await resumeApex({ timeEntryId: this.active.id });
      if (res && !res.matterId) res.matterId = matterId;
      this.active = res; this._resetTicking();
      this._persistLocalFromDTO(this.active);
      publish(this.messageContext, TIMER, { action: 'resume', recordId: matterId, dto: this.active });
    } catch (e) { /* ignore */ }
  }

  async handleStop() {
    try {
      const ok = await this._ensureActiveFromServer();
      if (!ok || !this.active?.id) return;
      const matterId = this.active?.matterId;
      const res = await stopApex({ timeEntryId: this.active.id });
      // Keep non-running snapshot with final duration
      this.active = {
        ...res,
        isRunning: false
      };
      this._tickOff();
      this._clearLocal(matterId);
      this._lastStopAt = Date.now();
      this._awaitingStart = true;
      publish(this.messageContext, TIMER, { action: 'stop', recordId: matterId, dto: this.active });
    } catch (e) { /* ignore */ }
  }

  get elapsedLabel() {
    // trigger re-render every second when running
    // eslint-disable-next-line no-unused-expressions
    this.heartbeat;
    if (!this.active?.startTime) return '';
    const startMs = new Date(this.active.startTime).getTime();
    const nowMs   = Date.now();
    const pausedAccum = this.active.pausedSeconds || 0;

    let inProgressPause = 0;
    if (this.active.isPaused && this.active.pausedStart) {
      inProgressPause = Math.max(0, Math.floor((nowMs - new Date(this.active.pausedStart).getTime()) / 1000));
    }

    const totalElapsed = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    const netSeconds   = Math.max(0, totalElapsed - pausedAccum - inProgressPause);
    return this.active.isRunning ? `Elapsed: ${this._formatHMS(netSeconds)}` :
           this.active.durationSeconds != null ? `Last: ${this._formatHMS(this.active.durationSeconds)}` : '';
  }

  _formatHMS(s=0) {
    s = Math.max(0, parseInt(s,10)||0);
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  _resetTicking() {
    this._tickOff();
    if (this.active?.isRunning && !this.active?.isPaused) {
      this.tickHandle = setInterval(() => {
        this.heartbeat = (this.heartbeat + 1) % 1000000;
      }, 1000);
    }
  }
  _tickOff() { if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; } }
}