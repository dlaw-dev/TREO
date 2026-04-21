import { LightningElement, api, track } from 'lwc';

import EventCreateModalAction from 'c/eventCreateModalAction';

import getUpcomingEvents from '@salesforce/apex/EventCalendarController.getUpcomingEvents';
import getPastEvents from '@salesforce/apex/EventCalendarController.getPastEvents';

export default class EventsCalendar extends LightningElement {

    /* ======================
       Record Id (Reactive)
       ====================== */

    _recordId;

    @api
    set recordId(value) {
        this._recordId = value;
        if (value) {
            this.loadEvents();
        }
    }

    get recordId() {
        return this._recordId;
    }

    /* ======================
       State
       ====================== */

    @track upcomingEvents = [];
    @track pastEvents = [];
    @track cancelledEvents = [];
    @track allEvents = [];

    isLoadingAll = false;
    focusHandler;

    columns = [
        {
            label: 'Start',
            fieldName: 'displayStart',
            type: 'text',
            sortable: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Subject',
            fieldName: 'recordLink',
            type: 'url',
            typeAttributes: {
                label: { fieldName: 'Subject' },
                target: '_self'
            },
            sortable: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Type',
            fieldName: 'Type',
            type: 'text',
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Location',
            fieldName: 'Location',
            type: 'text',
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Attendees',
            fieldName: 'displayAttendees',
            type: 'text',
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        }
    ];

    highlightedColumns = [
        {
            label: 'Start',
            fieldName: 'displayStart',
            type: 'eventText',
            sortable: true,
            typeAttributes: {
                value: { fieldName: 'displayStart' },
                isCancelled: { fieldName: 'isCancelled' }
            }
        },
        {
            label: 'Subject',
            fieldName: 'recordLink',
            type: 'eventUrl',
            sortable: true,
            typeAttributes: {
                label: { fieldName: 'Subject' },
                value: { fieldName: 'recordLink' },
                target: '_self',
                isCancelled: { fieldName: 'isCancelled' }
            }
        },
        {
            label: 'Type',
            fieldName: 'Type',
            type: 'eventText',
            typeAttributes: {
                value: { fieldName: 'Type' },
                isCancelled: { fieldName: 'isCancelled' }
            }
        },
        {
            label: 'Location',
            fieldName: 'Location',
            type: 'eventText',
            typeAttributes: {
                value: { fieldName: 'Location' },
                isCancelled: { fieldName: 'isCancelled' }
            }
        },
        {
            label: 'Attendees',
            fieldName: 'displayAttendees',
            type: 'eventText',
            typeAttributes: {
                value: { fieldName: 'displayAttendees' },
                isCancelled: { fieldName: 'isCancelled' }
            }
        }
    ];

    connectedCallback() {
        this.focusHandler = () => {
            if (this.recordId) {
                this.loadEvents();
            }
        };

        window.addEventListener('focus', this.focusHandler);
    }

    disconnectedCallback() {
        if (this.focusHandler) {
            window.removeEventListener('focus', this.focusHandler);
        }
    }

    /* ======================
       Data Loader
       ====================== */

    async loadEvents() {
        this.isLoadingAll = true;

        try {
            const [upcoming, past] = await Promise.all([
                getUpcomingEvents({ parentId: this.recordId }),
                getPastEvents({ parentId: this.recordId })
            ]);

            const normalizedUpcoming = (upcoming || []).map(ev => ({
                ...this.normalizeEvent(ev),
                recordLink: `/lightning/r/Event/${ev.Id}/view`
            }));

            const normalizedPast = (past || []).map(ev => ({
                ...this.normalizeEvent(ev),
                recordLink: `/lightning/r/Event/${ev.Id}/view`
            }));

            this.cancelledEvents = [...normalizedUpcoming, ...normalizedPast]
                .filter(ev => ev.isCancelled)
                .sort((a, b) => {
                    const aTime = a.StartDateTime ? new Date(a.StartDateTime).getTime() : 0;
                    const bTime = b.StartDateTime ? new Date(b.StartDateTime).getTime() : 0;

                    return bTime - aTime;
                });

            this.upcomingEvents = normalizedUpcoming.filter(ev => !ev.isCancelled);
            this.pastEvents = normalizedPast.filter(ev => !ev.isCancelled);

            this.allEvents = [
                ...normalizedUpcoming,
                ...normalizedPast
            ].sort((a, b) => {
                const aTime = a.StartDateTime ? new Date(a.StartDateTime).getTime() : 0;
                const bTime = b.StartDateTime ? new Date(b.StartDateTime).getTime() : 0;

                return bTime - aTime;
            });

        } catch (error) {
            console.error('Error loading events', error);
            this.upcomingEvents = [];
            this.pastEvents = [];
            this.cancelledEvents = [];
            this.allEvents = [];
        }

        this.isLoadingAll = false;
    }

    /* ======================
       Tab Labels
       ====================== */

    get allTabLabel() {
        return `All Events (${this.allEvents.length})`;
    }

    get upcomingTabLabel() {
        return `Upcoming Events (${this.upcomingEvents.length})`;
    }

    get pastTabLabel() {
        return `Past Events (${this.pastEvents.length})`;
    }

    get cancelledTabLabel() {
        return `Cancelled Events (${this.cancelledEvents.length})`;
    }

    /* ======================
       New Event
       ====================== */

    async handleNewEvent() {
        const result = await EventCreateModalAction.open({
            size: 'medium',
            recordId: this.recordId
        });

        if (result === 'success') {
            await this.loadEvents();
        }
    }

    normalizeEvent(ev) {
        const isCancelled = this.isCancelled(ev.Status__c);

        return {
            ...ev,
            isCancelled,
            displayStart: this.formatEventDateTime(ev.StartDateTime, ev.IsAllDayEvent),
            displayAttendees: this.formatAttendees(ev.EventRelations),
            statusCellClass: isCancelled ? 'slds-text-color_error slds-text-title_bold' : ''
        };
    }

    isCancelled(status) {
        return typeof status === 'string' && ['cancelled', 'canceled'].includes(status.trim().toLowerCase());
    }

    formatAttendees(eventRelations) {
        if (!eventRelations?.length) {
            return '';
        }

        return eventRelations
            .map(relation => relation?.Relation?.Name)
            .filter(Boolean)
            .join(', ');
    }

    formatEventDateTime(value, isAllDay) {
        if (!value) {
            return '';
        }

        const date = new Date(value);

        if (isAllDay) {
            return new Intl.DateTimeFormat('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: '2-digit'
            }).format(date);
        }

        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }
}
