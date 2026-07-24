import {
  formatHMS,
  parseDurationToSeconds,
  computeClockOffsetMs,
  computeNetSeconds,
  writeCrossWindowState,
  readCrossWindowState,
  clearCrossWindowState,
  crossWindowStateToDTO
} from 'c/timerCore';

describe('timerCore formatHMS', () => {
  it('formats zero seconds', () => {
    expect(formatHMS(0)).toBe('0:00:00');
  });

  it('formats sub-minute durations', () => {
    expect(formatHMS(45)).toBe('0:00:45');
  });

  it('formats hours/minutes/seconds', () => {
    expect(formatHMS(3661)).toBe('1:01:01');
  });

  it('clamps negative input to zero', () => {
    expect(formatHMS(-10)).toBe('0:00:00');
  });
});

describe('timerCore parseDurationToSeconds', () => {
  it('parses H:MM:SS', () => {
    expect(parseDurationToSeconds('1:02:03')).toBe(3723);
  });

  it('parses MM:SS', () => {
    expect(parseDurationToSeconds('2:05')).toBe(125);
  });

  it('parses plain seconds', () => {
    expect(parseDurationToSeconds('90')).toBe(90);
  });

  it('parses shorthand like 1h 7m 18s', () => {
    expect(parseDurationToSeconds('1h 7m 18s')).toBe(3600 + 7 * 60 + 18);
  });

  it('returns 0 for empty/garbage input', () => {
    expect(parseDurationToSeconds('')).toBe(0);
    expect(parseDurationToSeconds(null)).toBe(0);
    expect(parseDurationToSeconds('not a duration')).toBe(0);
  });
});

describe('timerCore computeClockOffsetMs', () => {
  it('returns 0 when no server timestamp is given', () => {
    expect(computeClockOffsetMs(null)).toBe(0);
  });

  it('computes a positive offset when the server clock is ahead', () => {
    const realNow = Date.now();
    const serverAhead = new Date(realNow + 5000).toISOString();
    const offset = computeClockOffsetMs(serverAhead);
    expect(offset).toBeGreaterThan(4000);
    expect(offset).toBeLessThan(6000);
  });

  it('computes a negative offset when the server clock is behind', () => {
    const realNow = Date.now();
    const serverBehind = new Date(realNow - 5000).toISOString();
    const offset = computeClockOffsetMs(serverBehind);
    expect(offset).toBeLessThan(-4000);
    expect(offset).toBeGreaterThan(-6000);
  });
});

describe('timerCore computeNetSeconds', () => {
  it('returns 0 when there is no dto or start time', () => {
    expect(computeNetSeconds(null, Date.now())).toBe(0);
    expect(computeNetSeconds({}, Date.now())).toBe(0);
  });

  it('computes elapsed seconds for a running, never-paused entry', () => {
    const now = Date.now();
    const dto = { startTime: new Date(now - 10000).toISOString(), isPaused: false, pausedSeconds: 0 };
    expect(computeNetSeconds(dto, now)).toBe(10);
  });

  it('subtracts accumulated paused seconds', () => {
    const now = Date.now();
    const dto = { startTime: new Date(now - 20000).toISOString(), isPaused: false, pausedSeconds: 5 };
    expect(computeNetSeconds(dto, now)).toBe(15);
  });

  it('subtracts the in-progress pause window while currently paused', () => {
    const now = Date.now();
    const dto = {
      startTime: new Date(now - 30000).toISOString(),
      isPaused: true,
      pausedStart: new Date(now - 10000).toISOString(),
      pausedSeconds: 0
    };
    // 30s total elapsed, minus the last 10s spent paused so far = 20s net
    expect(computeNetSeconds(dto, now)).toBe(20);
  });

  it('this is the accuracy-bug regression case: correcting for client/server clock skew changes the result', () => {
    // Simulate a client clock that is 8 seconds fast relative to the server.
    const clientNow = Date.now();
    const serverNowIso = new Date(clientNow - 8000).toISOString();
    const offset = computeClockOffsetMs(serverNowIso); // ~ -8000

    const dto = { startTime: new Date(clientNow - 60000).toISOString(), isPaused: false, pausedSeconds: 0 };

    const uncorrected = computeNetSeconds(dto, clientNow);
    const corrected = computeNetSeconds(dto, clientNow + offset);

    expect(uncorrected).toBe(60);
    expect(corrected).toBe(52);
  });
});

describe('timerCore cross-window localStorage helpers', () => {
  afterEach(() => {
    clearCrossWindowState();
  });

  it('returns null when nothing has been written', () => {
    expect(readCrossWindowState()).toBeNull();
  });

  it('writes and reads back a running DTO', () => {
    const dto = {
      matterId: '006XXXXXXXXXXXXXXX',
      id: 'a0XXXXXXXXXXXXXXX',
      isRunning: true,
      isPaused: false,
      startTime: '2026-07-24T18:00:00.000Z',
      pausedSeconds: 12,
      pausedStart: null
    };
    writeCrossWindowState(dto, -350, 'Smith v. Jones');

    const payload = readCrossWindowState();
    expect(payload).not.toBeNull();
    expect(payload.matterId).toBe(dto.matterId);
    expect(payload.entryId).toBe(dto.id);
    expect(payload.isRunning).toBe(true);
    expect(payload.startTimeIso).toBe(dto.startTime);
    expect(payload.clockOffsetMs).toBe(-350);
    expect(payload.matterName).toBe('Smith v. Jones');
  });

  it('clears the key when the dto is not running (stop signal)', () => {
    writeCrossWindowState({ isRunning: true, matterId: 'm1', startTime: new Date().toISOString() }, 0, 'x');
    expect(readCrossWindowState()).not.toBeNull();

    writeCrossWindowState({ isRunning: false }, 0, 'x');
    expect(readCrossWindowState()).toBeNull();
  });

  it('round-trips through crossWindowStateToDTO', () => {
    const dto = {
      matterId: 'm1',
      id: 'e1',
      isRunning: true,
      isPaused: true,
      startTime: '2026-07-24T18:00:00.000Z',
      pausedSeconds: 3,
      pausedStart: '2026-07-24T18:05:00.000Z'
    };
    writeCrossWindowState(dto, 100, 'Matter Name');
    const roundTripped = crossWindowStateToDTO(readCrossWindowState());

    expect(roundTripped.matterId).toBe(dto.matterId);
    expect(roundTripped.id).toBe(dto.id);
    expect(roundTripped.isPaused).toBe(true);
    expect(roundTripped.startTime).toBe(dto.startTime);
    expect(roundTripped.pausedStart).toBe(dto.pausedStart);
  });

  it('crossWindowStateToDTO returns null for a null payload', () => {
    expect(crossWindowStateToDTO(null)).toBeNull();
  });
});
