import { LightningElement, api, track, wire } from 'lwc';
import { updateRecord } from 'lightning/uiRecordApi';
import LightningConfirm from 'lightning/confirm';
import { publish, subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import CALENDAR_EVENT_CHANGED from '@salesforce/messageChannel/calendarEventChanged__c';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { formatEventDateTime, formatEventDateTimeRange, isCancelled, isVacated, isRescheduled, isInactive, stripMatterUrl, stripHtml, truncateText } from 'c/calendarUtils';

import EventCreateModalAction from 'c/eventCreateModalActionRefactor';
import EventRescheduleModal from 'c/eventRescheduleModalRefactor';

import getUpcomingEvents from '@salesforce/apex/EventCalendarControllerRefactor.getUpcomingEvents';
import getPastEvents from '@salesforce/apex/EventCalendarControllerRefactor.getPastEvents';

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
    @track rescheduledEvents = [];
    @track allEvents = [];

    @wire(MessageContext) messageContext;

    isLoadingAll = false;
    _isRowActionInFlight = false;
    focusHandler;
    visibilityHandler;
    _subscription;

    getRowActions = (row, doneCallback) => {
        if (!row || row.isInactive) {
            doneCallback([]);
            return;
        }
        doneCallback([
            { label: 'Edit', name: 'edit' },
            { label: 'Duplicate', name: 'duplicate' },
            { label: 'Reschedule', name: 'reschedule' },
            { label: 'Cancel', name: 'cancel' }
        ]);
    };

    columns = [
        {
            label: 'Start',
            fieldName: 'displayStart',
            type: 'text',
            sortable: true,
            wrapText: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Subject',
            fieldName: 'recordLink',
            type: 'eventUrl',
            typeAttributes: {
                label: { fieldName: 'Subject' },
                value: { fieldName: 'recordLink' },
                isCancelled: { fieldName: 'isCancelled' },
                isVacated: { fieldName: 'isVacated' },
                tooltipDateTime: { fieldName: 'tooltipDateTime' },
                eventType: { fieldName: 'Type' },
                location: { fieldName: 'Location' },
                attendees: { fieldName: 'displayAttendees' },
                description: { fieldName: 'shortDescription' },
                stateCourt: { fieldName: 'stateCourtName' },
                federalCourt: { fieldName: 'federalCourtName' }
            },
            sortable: true,
            wrapText: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Type',
            fieldName: 'Type',
            type: 'text',
            wrapText: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Location',
            fieldName: 'Location',
            type: 'text',
            wrapText: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            label: 'Attendees',
            fieldName: 'displayAttendees',
            type: 'text',
            wrapText: true,
            cellAttributes: {
                class: { fieldName: 'statusCellClass' }
            }
        },
        {
            type: 'action',
            typeAttributes: { rowActions: this.getRowActions }
        }
    ];

    highlightedColumns = [
        {
            label: 'Start',
            fieldName: 'displayStart',
            type: 'eventText',
            sortable: true,
            wrapText: true,
            typeAttributes: {
                value: { fieldName: 'displayStart' },
                isCancelled:   { fieldName: 'isCancelled' },
                isVacated:     { fieldName: 'isVacated' },
                isRescheduled: { fieldName: 'isRescheduled' }
            }
        },
        {
            label: 'Subject',
            fieldName: 'recordLink',
            type: 'eventUrl',
            sortable: true,
            wrapText: true,
            typeAttributes: {
                label: { fieldName: 'Subject' },
                value: { fieldName: 'recordLink' },
                isCancelled:   { fieldName: 'isCancelled' },
                isVacated:     { fieldName: 'isVacated' },
                isRescheduled: { fieldName: 'isRescheduled' },
                tooltipDateTime: { fieldName: 'tooltipDateTime' },
                eventType: { fieldName: 'Type' },
                location: { fieldName: 'Location' },
                attendees: { fieldName: 'displayAttendees' },
                description: { fieldName: 'shortDescription' },
                stateCourt: { fieldName: 'stateCourtName' },
                federalCourt: { fieldName: 'federalCourtName' }
            }
        },
        {
            label: 'Type',
            fieldName: 'Type',
            type: 'eventText',
            wrapText: true,
            typeAttributes: {
                value: { fieldName: 'Type' },
                isCancelled:   { fieldName: 'isCancelled' },
                isVacated:     { fieldName: 'isVacated' },
                isRescheduled: { fieldName: 'isRescheduled' }
            }
        },
        {
            label: 'Location',
            fieldName: 'Location',
            type: 'eventText',
            wrapText: true,
            typeAttributes: {
                value: { fieldName: 'Location' },
                isCancelled:   { fieldName: 'isCancelled' },
                isVacated:     { fieldName: 'isVacated' },
                isRescheduled: { fieldName: 'isRescheduled' }
            }
        },
        {
            label: 'Attendees',
            fieldName: 'displayAttendees',
            type: 'eventText',
            wrapText: true,
            typeAttributes: {
                value: { fieldName: 'displayAttendees' },
                isCancelled:   { fieldName: 'isCancelled' },
                isVacated:     { fieldName: 'isVacated' },
                isRescheduled: { fieldName: 'isRescheduled' }
            }
        },
        {
            type: 'action',
            typeAttributes: { rowActions: this.getRowActions }
        }
    ];

    connectedCallback() {
        const debouncedRefresh = () => {
            clearTimeout(this._refreshDebounce);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this._refreshDebounce = setTimeout(() => {
                if (this.recordId) this.loadEvents();
            }, 500);
        };

        this.focusHandler = debouncedRefresh;
        this.visibilityHandler = () => { if (!document.hidden) debouncedRefresh(); };

        window.addEventListener('focus', this.focusHandler);
        document.addEventListener('visibilitychange', this.visibilityHandler);

        if (this.messageContext) {
            this._subscription = subscribe(this.messageContext, CALENDAR_EVENT_CHANGED, () => {
                if (this.recordId) this.loadEvents();
            });
        }
    }

    disconnectedCallback() {
        clearTimeout(this._refreshDebounce);
        if (this.focusHandler) window.removeEventListener('focus', this.focusHandler);
        if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
        if (this._subscription) unsubscribe(this._subscription);
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
                recordLink: `/lightning/r/Calendar_Event__c/${ev.Id}/view`
            }));

            const normalizedPast = (past || []).map(ev => ({
                ...this.normalizeEvent(ev),
                recordLink: `/lightning/r/Calendar_Event__c/${ev.Id}/view`
            }));

            const allNormalized = [...normalizedUpcoming, ...normalizedPast];

            this.cancelledEvents = allNormalized
                .filter(ev => ev.isCancelled)
                .sort((a, b) => a.startMs - b.startMs);

            this.rescheduledEvents = allNormalized
                .filter(ev => ev.isVacated || ev.isRescheduled)
                .sort((a, b) => a.startMs - b.startMs);

            this.upcomingEvents = normalizedUpcoming.filter(ev => !ev.isInactive);
            this.pastEvents = normalizedPast.filter(ev => !ev.isInactive);

            this.allEvents = [
                ...normalizedUpcoming,
                ...normalizedPast
            ].sort((a, b) => a.startMs - b.startMs);

        } catch (error) {
            console.error('Error loading events', error);
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error loading events',
                message: error?.body?.message || 'Could not load events. Please refresh.',
                variant: 'error'
            }));
            this.upcomingEvents = [];
            this.pastEvents = [];
            this.cancelledEvents = [];
            this.rescheduledEvents = [];
            this.allEvents = [];
        }

        this.isLoadingAll = false;
    }

    /* ======================
       Tab Labels
       ====================== */

    get cancelledColumns() {
        return this.highlightedColumns.filter(col => col.type !== 'action');
    }

    get allTabLabel() {
        return `All Events (${this.allEvents.length})`;
    }

    get upcomingTabLabel() {
        return `Upcoming Events (${this.upcomingEvents.length})`;
    }

    get pastTabLabel() {
        const n = this.pastEvents.length;
        return n >= 200 ? `Past Events (200+)` : `Past Events (${n})`;
    }

    get cancelledTabLabel() {
        return `Cancelled Events (${this.cancelledEvents.length})`;
    }

    get rescheduledTabLabel() {
        return `Rescheduled Events (${this.rescheduledEvents.length})`;
    }

    get rescheduledColumns() {
        return this.highlightedColumns.filter(col => col.type !== 'action');
    }

    /* ======================
       New Event
       ====================== */

    handleRefresh() {
        if (this.recordId) this.loadEvents();
    }

    async handleNewEvent() {
        const result = await EventCreateModalAction.open({
            size: 'medium',
            recordId: this.recordId
        });

        if (result === 'success') {
            publish(this.messageContext, CALENDAR_EVENT_CHANGED, {});
        }
    }

    async handleRowAction(event) {
        if (this._isRowActionInFlight) return;
        this._isRowActionInFlight = true;

        try {
            const { action, row } = event.detail;

            if (action.name === 'edit') {
                const result = await EventCreateModalAction.open({
                    size: 'medium',
                    recordId:             this.recordId,
                    editEventId:          row.Id,
                    initialSubject:       row.Subject,
                    initialEventType:     row.Type,
                    initialLocation:      row.Location,
                    initialDescription:   stripHtml(stripMatterUrl(row.Description)),
                    initialIsAllDay:      row.IsAllDay,
                    initialShowAs:        row.ShowAs,
                    initialStartDateTime: row.StartDateTime,
                    initialEndDateTime:   row.EndDateTime,
                    initialAttendees:     row.attendeeUsers || []
                });
                if (result === 'success') publish(this.messageContext, CALENDAR_EVENT_CHANGED, {});

            } else if (action.name === 'duplicate') {
                const result = await EventCreateModalAction.open({
                    size: 'medium',
                    recordId: this.recordId,
                    duplicateSourceEventId: row.Id,
                    initialSubject:       row.Subject,
                    initialEventType:     row.Type,
                    initialLocation:      row.Location,
                    initialDescription:   stripHtml(stripMatterUrl(row.Description)),
                    initialIsAllDay:      row.IsAllDay,
                    initialShowAs:        row.ShowAs,
                    initialStartDateTime: row.StartDateTime,
                    initialEndDateTime:   row.EndDateTime,
                    initialAttendees:     row.attendeeUsers || []
                });
                if (result === 'success') publish(this.messageContext, CALENDAR_EVENT_CHANGED, {});

            } else if (action.name === 'reschedule') {
                const result = await EventRescheduleModal.open({
                    size: 'small',
                    eventId:       row.Id,
                    subject:       row.Subject,
                    originalStart: row.StartDateTime,
                    originalEnd:   row.EndDateTime,
                    isAllDay:      row.IsAllDay,
                    description:   stripHtml(stripMatterUrl(row.Description))
                });
                if (result === 'success') publish(this.messageContext, CALENDAR_EVENT_CHANGED, {});

            } else if (action.name === 'cancel') {
                const confirmed = await LightningConfirm.open({
                    message: 'Are you sure you want to cancel this event?',
                    variant: 'header',
                    label: 'Cancel Event'
                });
                if (!confirmed) return;
                try {
                    await updateRecord({ fields: { Id: row.Id, Status__c: 'Cancelled' } });
                    this.dispatchEvent(new ShowToastEvent({
                        title: 'Event Cancelled',
                        message: 'The event has been cancelled.',
                        variant: 'success'
                    }));
                    publish(this.messageContext, CALENDAR_EVENT_CHANGED, {});
                } catch (error) {
                    this.dispatchEvent(new ShowToastEvent({
                        title: 'Error cancelling event',
                        message: error?.body?.message || 'An unexpected error occurred.',
                        variant: 'error'
                    }));
                }
            }
        } finally {
            this._isRowActionInFlight = false;
        }
    }

    normalizeEvent(ev) {
        const cancelled    = isCancelled(ev.Status__c);
        const vacated      = isVacated(ev.Status__c);
        const rescheduled  = isRescheduled(ev.Status__c);
        const inactive     = isInactive(ev.Status__c);
        const startMs      = ev.Start_DateTime__c ? new Date(ev.Start_DateTime__c).getTime() : Number.MAX_SAFE_INTEGER;

        return {
            ...ev,
            startMs,
            Subject:       ev.Subject__c || '(No Subject)',
            Type:          ev.Event_Type__c,
            Location:      ev.Location__c,
            Description:   ev.Description__c,
            IsAllDay:      ev.Is_All_Day__c,
            ShowAs:        ev.Show_Time_As__c,
            StartDateTime: ev.Start_DateTime__c,
            EndDateTime:   ev.End_DateTime__c,
            isCancelled:   cancelled,
            isVacated:     vacated,
            isRescheduled: rescheduled,
            isInactive:    inactive,
            displayStart: formatEventDateTime(ev.Start_DateTime__c, ev.Is_All_Day__c),
            displayAttendees: this.formatAttendees(ev.Calendar_Attendees__r),
            tooltipDateTime: formatEventDateTimeRange(
                ev.Start_DateTime__c,
                ev.End_DateTime__c,
                ev.Is_All_Day__c
            ),
            shortDescription: truncateText(stripHtml(stripMatterUrl(ev.Description__c)), 140),
            stateCourtName:   ev.Matter__r?.State_Court__r?.Name || null,
            federalCourtName: ev.Matter__r?.Federal_Court__r?.Name || null,
            attendeeUsers: (ev.Calendar_Attendees__r || [])
                .filter(a => a.User__c && a.User__r)
                .map(a => ({ id: a.User__c, name: a.User__r.Name })),
            statusCellClass: cancelled   ? 'slds-text-color_error slds-text-title_bold'
                           : vacated     ? 'cell-vacated slds-text-title_bold'
                           : rescheduled ? 'cell-rescheduled slds-text-title_bold'
                           : ''
        };
    }

    formatAttendees(attendees) {
        if (!attendees?.length) {
            return '';
        }

        return attendees
            .map(att => att?.User__r?.Name)
            .filter(Boolean)
            .join(', ');
    }

}