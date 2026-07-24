import { createElement } from 'lwc';
import TimerUtility from 'c/timerUtility';
import getActiveEntry from '@salesforce/apex/TimeTrackerController.getActiveEntry';
import getRecentEntries from '@salesforce/apex/TimeTrackerController.getRecentEntries';
import { subscribe, publish } from 'lightning/messageService';

jest.mock('@salesforce/apex/TimeTrackerController.getActiveEntry', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.start', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.stop', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.pause', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.resume', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/TimeTrackerController.getRecentEntries', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/messageChannel/timer__c', () => ({ default: 'timer__c' }), { virtual: true });

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

describe('c-timer-utility', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('responds to a getState request over LMS with a stateResponse containing the current dto', async () => {
    const dto = {
      id: 'e1',
      matterId: 'm1',
      isRunning: true,
      isPaused: false,
      startTime: new Date(Date.now() - 5000).toISOString(),
      pausedSeconds: 0,
      serverNow: new Date().toISOString()
    };
    getActiveEntry.mockResolvedValue(dto);
    getRecentEntries.mockResolvedValue([]);

    const element = createElement('c-timer-utility', { is: TimerUtility });
    document.body.appendChild(element);
    await flushPromises();

    expect(subscribe).toHaveBeenCalled();
    const messageHandler = subscribe.mock.calls[0][2];

    publish.mockClear();
    messageHandler({ type: 'getState', matterId: 'm1' });

    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'stateResponse', matterId: 'm1', dto })
    );
  });

  it('answers a getState request for a different matter with a null dto', async () => {
    const dto = {
      id: 'e1',
      matterId: 'm1',
      isRunning: true,
      isPaused: false,
      startTime: new Date().toISOString(),
      pausedSeconds: 0,
      serverNow: new Date().toISOString()
    };
    getActiveEntry.mockResolvedValue(dto);
    getRecentEntries.mockResolvedValue([]);

    const element = createElement('c-timer-utility', { is: TimerUtility });
    document.body.appendChild(element);
    await flushPromises();

    const messageHandler = subscribe.mock.calls[0][2];
    publish.mockClear();
    messageHandler({ type: 'getState', matterId: 'some-other-matter' });

    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'stateResponse', matterId: 'some-other-matter', dto: null })
    );
  });

  it('adopts state pushed via an actionOccurred message from another surface', async () => {
    getActiveEntry.mockResolvedValue(null);
    getRecentEntries.mockResolvedValue([]);

    const element = createElement('c-timer-utility', { is: TimerUtility });
    document.body.appendChild(element);
    await flushPromises();

    expect(element.shadowRoot.querySelector('.slds-text-heading_small')).toBeNull();

    const messageHandler = subscribe.mock.calls[0][2];
    const pushedDto = {
      id: 'e2',
      matterId: 'm2',
      isRunning: true,
      isPaused: false,
      startTime: new Date().toISOString(),
      pausedSeconds: 0,
      serverNow: new Date().toISOString()
    };
    messageHandler({ type: 'actionOccurred', action: 'start', matterId: 'm2', dto: pushedDto });
    await flushPromises();

    expect(element.shadowRoot.querySelector('.slds-text-heading_small')).not.toBeNull();
  });

  it('computes elapsed time corrected for client/server clock skew (accuracy regression case)', async () => {
    const fixedNow = 1700000000000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    // Server clock is 8s behind this mocked client clock.
    const serverNow = new Date(fixedNow - 8000).toISOString();
    const dto = {
      id: 'e1',
      matterId: 'm1',
      isRunning: true,
      isPaused: false,
      startTime: new Date(fixedNow - 60000).toISOString(),
      pausedSeconds: 0,
      serverNow
    };
    getActiveEntry.mockResolvedValue(dto);
    getRecentEntries.mockResolvedValue([]);

    const element = createElement('c-timer-utility', { is: TimerUtility });
    document.body.appendChild(element);
    await flushPromises();

    const elapsed = element.shadowRoot.querySelector('.slds-text-title_caps');
    // 60s of wall-clock elapsed, corrected by the -8s clock offset => 52s net.
    expect(elapsed.textContent).toBe('Elapsed: 0:00:52');
  });
});
