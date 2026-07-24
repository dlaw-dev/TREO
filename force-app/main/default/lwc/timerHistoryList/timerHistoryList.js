import { LightningElement, api } from 'lwc';

export default class TimerHistoryList extends LightningElement {
  @api groups; // [{ label, totalFormatted, entries: [{ id, matterId, matterName, notes, durationFormatted }] }]

  get displayGroups() {
    return (this.groups || []).filter((g) => g && g.entries && g.entries.length);
  }

  get hasEntries() {
    return this.displayGroups.length > 0;
  }

  handleRestartClick(event) {
    const matterId = event.currentTarget.dataset.matterId;
    if (!matterId) return;
    this.dispatchEvent(new CustomEvent('restart', { detail: { matterId } }));
  }
}
