import { LightningElement, api, wire, track } from 'lwc';
import getMatterEvents from '@salesforce/apex/NeosMatterCalendarController.getMatterEvents';

export default class NeosMatterCalendar extends LightningElement {
    @api recordId;

    @track events = [];
    @track calendarDays = [];
    @track month;
    @track year;

    connectedCallback() {
        const today = new Date();
        this.month = today.getMonth(); // 0–11
        this.year = today.getFullYear();
        this.buildCalendar();
    }

    @wire(getMatterEvents, { matterId: '$recordId' })
    wiredEvents({ data, error }) {
        if (data) {
            this.events = data.map(evt => {
                const subject = evt.Subject || 'No Subject';
                let label = subject;

                // Build a local time label like "2:30 PM Subject"
                if (evt.StartDateTime) {
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
                    start: evt.StartDateTime,
                    end: evt.EndDateTime
                };
            });
            this.buildCalendar();
        } else if (error) {
            console.error('Error loading events', error);
            this.events = [];
            this.buildCalendar();
        }
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

                const dt = new Date(evt.start); // Converts to local time
                if (isNaN(dt.getTime())) return;

                const yyyy = dt.getFullYear();
                const mm = String(dt.getMonth() + 1).padStart(2, '0');
                const dd = String(dt.getDate()).padStart(2, '0');
                const dateKey = `${yyyy}-${mm}-${dd}`;

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

            const dayEvents = eventsByDate[dateStr] || null;

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

    handleEventClick(event) {
        event.stopPropagation();
        const id = event.currentTarget.dataset.id;
        if (id) {
            window.open('/' + id, '_blank');
        }
    }
}