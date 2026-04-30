import { LightningElement, api, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getMatterEvents from '@salesforce/apex/NeosMatterCalendarController.getMatterEvents';

export default class NeosMatterCalendar extends NavigationMixin(LightningElement) {
    @api recordId;

    @track events = [];
    @track calendarDays = [];
    @track month;
    @track year;
    @track hoveredEventId;
    @track hoveredEvent;
    @track tooltipStyle;
    wiredEventsResult;
    focusHandler;

    connectedCallback() {
        const today = new Date();
        this.month = today.getMonth(); // 0–11
        this.year = today.getFullYear();
        this.buildCalendar();

        this.focusHandler = () => {
            this.handleRefresh();
        };
        window.addEventListener('focus', this.focusHandler);
    }

    disconnectedCallback() {
        if (this.focusHandler) {
            window.removeEventListener('focus', this.focusHandler);
        }
    }

    @wire(getMatterEvents, { matterId: '$recordId' })
    wiredEvents(result) {
        this.wiredEventsResult = result;
        const { data, error } = result;

        if (data) {
            this.events = data.map(evt => {
                const subject = evt.Subject || 'No Subject';
                const isCancelled = this.isCancelled(evt.Status__c);
                let label = subject;

                // Build a local time label like "2:30 PM Subject" for non all-day events.
                if (evt.StartDateTime && !evt.IsAllDayEvent) {
                    const dt = new Date(evt.StartDateTime);
                    if (!isNaN(dt.getTime())) {
                        const timeStr = dt.toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit'
                        });
                        label = `${timeStr} ${subject}`;
                    }
                }

                return {
                    id: evt.Id,
                    subject,
                    label,
                    isCancelled,
                    start: evt.StartDateTime,
                    end: evt.EndDateTime,
                    isAllDay: evt.IsAllDayEvent,
                    type: evt.Type,
                    location: evt.Location,
                    description: evt.Description,
                    tooltipClass: isCancelled ? 'event-tooltip event-tooltip--cancelled' : 'event-tooltip',
                    subjectClass: isCancelled ? 'event-tooltip__subject event-tooltip__subject--cancelled' : 'event-tooltip__subject',
                    tooltipDateTime: this.formatEventDateTimeRange(
                        evt.StartDateTime,
                        evt.EndDateTime,
                        evt.IsAllDayEvent
                    ),
                    shortDescription: this.truncateText(evt.Description, 140)
                };
            });
            this.buildCalendar();
        } else if (error) {
            console.error('Error loading events', error);
            this.events = [];
            this.buildCalendar();
        }
    }

    async handleRefresh() {
        if (!this.wiredEventsResult) return;
        await refreshApex(this.wiredEventsResult);
    }

    get hasEvents() {
        return this.events && this.events.length > 0;
    }

    get monthLabel() {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return monthNames[this.month];
    }

    handlePrevMonth() {
        if (this.month === 0) {
            this.month = 11;
            this.year -= 1;
        } else {
            this.month -= 1;
        }
        this.buildCalendar();
    }

    handleNextMonth() {
        if (this.month === 11) {
            this.month = 0;
            this.year += 1;
        } else {
            this.month += 1;
        }
        this.buildCalendar();
    }

    buildCalendar() {
        const days = [];

        const firstDay = new Date(this.year, this.month, 1);
        const startDayOfWeek = firstDay.getDay(); // 0 (Sun) – 6 (Sat)
        const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();

        // Today (for highlighting)
        const today = new Date();
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth();
        const todayDate = today.getDate();
        const todayKey =
            `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDate).padStart(2, '0')}`;

        // Timezone-safe event grouping by date
        const eventsByDate = {};
        if (this.events) {
            this.events.forEach(evt => {
                if (!evt.start) return;

                const dateKey = this.getEventDateKey(evt);
                if (!dateKey) return;

                if (!eventsByDate[dateKey]) {
                    eventsByDate[dateKey] = [];
                }
                eventsByDate[dateKey].push(evt);
            });
        }

        // Leading blanks
        for (let i = 0; i < startDayOfWeek; i++) {
            days.push({
                key: `blank-${i}`,
                dayNumber: '',
                dateString: '',
                events: null,
                cellClass: 'calendar-cell calendar-cell--empty'
            });
        }

        // Actual days
        for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            const yyyy = this.year;
            const mm = String(this.month + 1).padStart(2, '0');
            const dd = String(dayNum).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            const dayEvents = (eventsByDate[dateStr] || null)?.map(evt => ({
                ...evt,
                pillClass: this.getPillClass(evt)
            }));

            // base class
            let cellClass = 'calendar-cell';
            // highlight today
            if (dateStr === todayKey) {
                cellClass += ' calendar-cell--today';
            }

            days.push({
                key: `day-${dateStr}`,
                dayNumber: dayNum,
                dateString: dateStr,
                events: dayEvents,
                cellClass
            });
        }

        this.calendarDays = days;
    }

    handleDayClick(event) {
        const dateStr = event.currentTarget.dataset.date;
        if (!dateStr) return;
        console.log('Day clicked:', dateStr);
    }

    handleEventMouseEnter(event) {
        const hoveredEventId = event.currentTarget.dataset.id;
        const hoveredEvent = this.events.find(evt => evt.id === hoveredEventId);

        if (!hoveredEvent) {
            return;
        }

        this.hoveredEventId = hoveredEventId;
        this.hoveredEvent = hoveredEvent;
        this.tooltipStyle = this.getTooltipStyle(event.currentTarget);
        this.buildCalendar();
    }

    handleEventMouseLeave() {
        if (!this.hoveredEventId) return;

        this.hoveredEventId = null;
        this.hoveredEvent = null;
        this.tooltipStyle = null;
        this.buildCalendar();
    }

    handleEventClick(event) {
        event.stopPropagation();
        const id = event.currentTarget.dataset.id;
        if (id) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: {
                    recordId: id,
                    objectApiName: 'Event',
                    actionName: 'view'
                }
            });
        }
    }

    getPillClass(evt) {
        let pillClass = 'event-pill';

        if (evt.isCancelled) {
            pillClass += ' event-pill--cancelled';
        }

        if (this.hoveredEventId === evt.id) {
            pillClass += evt.isCancelled
                ? ' event-pill--cancelled-active'
                : ' event-pill--active';
        }

        return pillClass;
    }

    isCancelled(status) {
        return typeof status === 'string' && ['cancelled', 'canceled'].includes(status.trim().toLowerCase());
    }

    getEventDateKey(evt) {
        const dt = new Date(evt.start);
        if (Number.isNaN(dt.getTime())) {
            return null;
        }

        // Salesforce all-day events are effectively day-based values.
        // Use UTC date parts to avoid timezone rollback (e.g. 5/11 showing on 5/10 in US timezones).
        if (evt.isAllDay) {
            const yyyy = dt.getUTCFullYear();
            const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(dt.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    formatEventDateTimeRange(startValue, endValue, isAllDay) {
        if (!startValue) {
            return '';
        }

        const start = new Date(startValue);
        const end = endValue ? new Date(endValue) : null;

        if (Number.isNaN(start.getTime())) {
            return '';
        }

        if (isAllDay) {
            return new Intl.DateTimeFormat('en-US', {
                timeZone: 'UTC',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            }).format(start);
        }

        const dateLabel = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(start);

        const startTimeLabel = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        }).format(start);

        if (!end || Number.isNaN(end.getTime())) {
            return `${dateLabel} at ${startTimeLabel}`;
        }

        const endTimeLabel = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        }).format(end);

        const isSameDay = start.toDateString() === end.toDateString();

        if (isSameDay) {
            return `${dateLabel}, ${startTimeLabel} - ${endTimeLabel}`;
        }

        const endDateLabel = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(end);

        return `${dateLabel}, ${startTimeLabel} - ${endDateLabel}`;
    }

    truncateText(value, maxLength) {
        if (!value || value.length <= maxLength) {
            return value;
        }

        return `${value.slice(0, maxLength).trimEnd()}...`;
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
