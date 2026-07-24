const CROSS_WINDOW_KEY = 'treo:timer:state';

export function formatHMS(totalSeconds = 0) {
  const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Accepts HH:MM:SS, MM:SS, SS, or 1h 7m 18s / 7m18s / 78s
export function parseDurationToSeconds(input) {
  if (!input) return 0;
  const str = String(input).trim().toLowerCase();
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => p.trim());
    if (parts.length === 3) {
      const [h, m, s] = parts.map((v) => parseInt(v, 10) || 0);
      return Math.max(0, h * 3600 + m * 60 + s);
    }
    if (parts.length === 2) {
      const [m, s] = parts.map((v) => parseInt(v, 10) || 0);
      return Math.max(0, m * 60 + s);
    }
    if (parts.length === 1) {
      return Math.max(0, parseInt(parts[0], 10) || 0);
    }
  }
  const hMatch = str.match(/(\d+)\s*h/);
  const mMatch = str.match(/(\d+)\s*m/);
  const sMatch = str.match(/(\d+)\s*s/);
  if (hMatch || mMatch || sMatch) {
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const m = mMatch ? parseInt(mMatch[1], 10) : 0;
    const s = sMatch ? parseInt(sMatch[1], 10) : 0;
    return Math.max(0, h * 3600 + m * 60 + s);
  }
  const plain = parseInt(str, 10);
  return Math.max(0, isNaN(plain) ? 0 : plain);
}

// clockOffsetMs = serverNow - Date.now(), computed at the moment an Apex response arrives.
// Adding it to Date.now() anywhere else corrects for client/server clock drift.
export function computeClockOffsetMs(serverNowIsoOrDate) {
  if (!serverNowIsoOrDate) return 0;
  const serverMs = new Date(serverNowIsoOrDate).getTime();
  if (isNaN(serverMs)) return 0;
  return serverMs - Date.now();
}

// dto: TimeEntryDTO shape from TimeTrackerController (startTime, isPaused, pausedStart, pausedSeconds)
// correctedNowMs: Date.now() + clockOffsetMs
export function computeNetSeconds(dto, correctedNowMs) {
  if (!dto || !dto.startTime) return 0;
  const startMs = new Date(dto.startTime).getTime();
  const pausedAccum = dto.pausedSeconds || 0;

  let inProgressPause = 0;
  if (dto.isPaused && dto.pausedStart) {
    inProgressPause = Math.max(0, Math.floor((correctedNowMs - new Date(dto.pausedStart).getTime()) / 1000));
  }

  const totalElapsed = Math.max(0, Math.floor((correctedNowMs - startMs) / 1000));
  return Math.max(0, totalElapsed - pausedAccum - inProgressPause);
}

// ---- Cross-window sync (localStorage + native 'storage' event) ----
// A separate popped-out browser window is NOT reachable via Lightning Message Service,
// which only bridges components within the same tab/page. The 'storage' event fires in
// OTHER same-origin windows/tabs (never the writer), so it's the right channel here.

export function writeCrossWindowState(dto, clockOffsetMs, matterName) {
  try {
    if (!dto || !dto.isRunning) {
      localStorage.removeItem(CROSS_WINDOW_KEY);
      return;
    }
    const payload = {
      v: 1,
      ts: Date.now(),
      matterId: dto.matterId || null,
      entryId: dto.id || null,
      isRunning: !!dto.isRunning,
      isPaused: !!dto.isPaused,
      startTimeIso: dto.startTime || null,
      pausedSeconds: dto.pausedSeconds || 0,
      pausedStartIso: dto.pausedStart || null,
      clockOffsetMs: clockOffsetMs || 0,
      matterName: matterName || null
    };
    localStorage.setItem(CROSS_WINDOW_KEY, JSON.stringify(payload));
  } catch (e) {
    /* ignore storage failures (private browsing, quota, etc.) */
  }
}

export function clearCrossWindowState() {
  try {
    localStorage.removeItem(CROSS_WINDOW_KEY);
  } catch (e) {
    /* ignore */
  }
}

export function readCrossWindowState() {
  try {
    const raw = localStorage.getItem(CROSS_WINDOW_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function crossWindowStateToDTO(payload) {
  if (!payload) return null;
  return {
    id: payload.entryId,
    matterId: payload.matterId,
    isRunning: payload.isRunning,
    isPaused: payload.isPaused,
    startTime: payload.startTimeIso,
    pausedSeconds: payload.pausedSeconds,
    pausedStart: payload.pausedStartIso
  };
}

export const CROSS_WINDOW_STORAGE_KEY = CROSS_WINDOW_KEY;
