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
    @track allEvents = [];

    isLoadingAll = false;

    columns = [
        {
            label: 'Subject',
            fieldName: 'recordLink',
            type: 'url',
            typeAttributes: {
                label: { fieldName: 'Subject' },
                target: '_self'
            },
            sortable: true
        },
        { label: 'Type', fieldName: 'Type', type: 'text' },
        { label: 'Location', fieldName: 'Location', type: 'text' },
        {
            label: 'Start',
            fieldName: 'StartDateTime',
            type: 'date',
            typeAttributes: {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            },
            sortable: true
        },
        {
            label: 'End',
            fieldName: 'EndDateTime',
            type: 'date',
            typeAttributes: {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            },
            sortable: true
        }
    ];

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

            this.upcomingEvents = (upcoming || []).map(ev => ({
                ...ev,
                recordLink: `/lightning/r/Event/${ev.Id}/view`
            }));

            this.pastEvents = (past || []).map(ev => ({
                ...ev,
                recordLink: `/lightning/r/Event/${ev.Id}/view`
            }));

            this.allEvents = [
                ...this.upcomingEvents,
                ...this.pastEvents
            ];

        } catch (error) {
            console.error('Error loading events', error);
            this.upcomingEvents = [];
            this.pastEvents = [];
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
}