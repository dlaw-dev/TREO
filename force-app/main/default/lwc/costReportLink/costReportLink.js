import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

// ─── CONFIGURE THESE ────────────────────────────────────────────────────────
const REPORT_ID = '00OVt00000BiV6bMAF';
const FILTER_INDEX = 4;
// ─────────────────────────────────────────────────────────────────────────────

export default class CostReportLink extends NavigationMixin(LightningElement) {
    @api recordId;
    @api linkLabel = 'View Cost Report (No Groupings)';

    get reportUrl() {
        if (!REPORT_ID || REPORT_ID === 'YOUR_REPORT_ID_HERE') {
            return null;
        }
        if (!this.recordId) {
            return null;
        }
        return `/lightning/r/Report/${REPORT_ID}/view?fv${FILTER_INDEX}=${encodeURIComponent(this.recordId)}`;
    }

    get isConfigured() {
        return !!this.reportUrl;
    }

    handleClick(event) {
        event.preventDefault();
        this[NavigationMixin.Navigate]({
            type: 'standard__webPage',
            attributes: { url: this.reportUrl }
        });
    }
}