import { createElement } from 'lwc';
import TimeTracker from 'c/timeTracker';
import getActiveEntry from '@salesforce/apex/TimeTrackerController.getActiveEntry';
import { subscribe, publish } from 'lightning/messageService';

jest.mock('@salesforce/apex/TimeTrackerController.getActiveEntry', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.start', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.stop', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.pause', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.resume', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.saveDetailsWithEditedDuration', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/messageChannel/timer__c', () => ({ default: 'timer__c' }), { virtual: true });
jest.mock('lightning/uiRecordApi', () => ({
  getRecord: jest.fn(),
  getFieldValue: jest.fn(() => null)
}));

jest.mock('lightning/messageService', () => {
  const actual = jest.requireActual('lightning/messageService');
  return {
    ...actual,
    subscribe: jest.fn(() => ({})),
    unsubscribe: jest.fn(),
    publish: jest.fn()
  };
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('c-time-tracker', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  function makeElement() {
    const element = createElement('c-time-tracker', { is: TimeTracker });
    element.recordId = 'a00000000000001AAA';
    return element;
  }

  it('asks timerUtility for state over LMS on mount', async () => {
    getActiveEntry.mockResolvedValue(null);
    const element = makeElement();
    document.body.appendChild(element);
    await flushPromises();

    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'getState', matterId: 'a00000000000001AAA' })
    );
  });

  it('adopts a stateResponse from timerUtility and does not fall back to Apex', async () => {
    jest.useFakeTimers();
    getActiveEntry.mockResolvedValue(null);

    const dto = {
      id: 'e1',
      matterId: 'a00000000000001AAA',
      isRunning: true,
      isPaused: false,
      startTime: new Date().toISOString(),
      pausedSeconds: 0,
      serverNow: new Date().toISOString()
    };

    const element = makeElement();
    document.body.appendChild(element);
    await Promise.resolve();

    const messageHandler = subscribe.mock.calls[0][2];
    messageHandler({ type: 'stateResponse', matterId: 'a00000000000001AAA', dto, clockOffsetMs: 0 });

    // Advance past the fallback timeout window; the fallback must NOT fire since we already resolved.
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(getActiveEntry).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('.elapsed').textContent).toContain('Elapsed');
  });

  it('falls back to a direct Apex call when no timerUtility answers in time (works with no utility bar mounted)', async () => {
    jest.useFakeTimers();
    const dto = {
      id: 'e1',
      matterId: 'a00000000000001AAA',
      isRunning: true,
      isPaused: false,
      startTime: new Date().toISOString(),
      pausedSeconds: 0,
      serverNow: new Date().toISOString()
    };
    getActiveEntry.mockResolvedValue(dto);

    const element = makeElement();
    document.body.appendChild(element);
    await Promise.resolve();

    // No stateResponse ever arrives; advance past the fallback window.
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();

    expect(getActiveEntry).toHaveBeenCalledWith({ matterId: 'a00000000000001AAA' });
  });

  it('ignores messages addressed to a different matter', async () => {
    getActiveEntry.mockResolvedValue(null);
    const element = makeElement();
    document.body.appendChild(element);
    await flushPromises();

    const messageHandler = subscribe.mock.calls[0][2];
    const dto = {
      id: 'e1',
      matterId: 'some-other-record',
      isRunning: true,
      isPaused: false,
      startTime: new Date().toISOString(),
      pausedSeconds: 0,
      serverNow: new Date().toISOString()
    };
    messageHandler({ type: 'stateResponse', matterId: 'some-other-record', dto, clockOffsetMs: 0 });
    await flushPromises();

    expect(element.shadowRoot.querySelector('.elapsed').textContent).toBe('');
  });
});
