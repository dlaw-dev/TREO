import { LightningElement, api } from 'lwc';

export default class EventsCalendarTooltipLink extends LightningElement {
    @api label;
    @api value;
    @api target;
    @api isCancelled = false;
    @api tooltipDateTime;
    @api eventType;
    @api location;
    @api description;

    showTooltip = false;
    tooltipStyle;

    get linkClass() {
        return this.isCancelled ? 'event-link event-link--cancelled' : 'event-link';
    }

    get tooltipClass() {
        return this.isCancelled ? 'event-tooltip event-tooltip--cancelled' : 'event-tooltip';
    }

    get subjectClass() {
        return this.isCancelled
            ? 'event-tooltip__subject event-tooltip__subject--cancelled'
            : 'event-tooltip__subject';
    }

    handleMouseEnter(event) {
        this.tooltipStyle = this.getTooltipStyle(event.currentTarget);
        this.showTooltip = true;
    }

    handleMouseLeave() {
        this.showTooltip = false;
        this.tooltipStyle = null;
    }

    getTooltipStyle(target) {
        const rect = target.getBoundingClientRect();
        const tooltipWidth = 256;
        const spacing = 8;
        const viewportPadding = 12;

        let left = rect.left;
        let top = rect.bottom + spacing;

        if (left + tooltipWidth > window.innerWidth - viewportPadding) {
            left = window.innerWidth - tooltipWidth - viewportPadding;
        }

        if (left < viewportPadding) {
            left = viewportPadding;
        }

        return `position: fixed; top: ${top}px; left: ${left}px; width: ${tooltipWidth}px;`;
    }
}
