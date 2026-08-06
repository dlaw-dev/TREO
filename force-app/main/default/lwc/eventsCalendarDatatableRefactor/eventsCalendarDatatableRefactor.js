import LightningDatatable from 'lightning/datatable';
import eventTextTemplate from './eventTextRefactor.html';
import eventUrlTemplate from './eventUrlRefactor.html';

export default class EventsCalendarDatatable extends LightningDatatable {
    static customTypes = {
        eventText: {
            template: eventTextTemplate,
            standardCellLayout: true,
            typeAttributes: ['value', 'isCancelled', 'isVacated', 'isRescheduled']
        },
        eventUrl: {
            template: eventUrlTemplate,
            standardCellLayout: true,
            typeAttributes: ['label', 'value', 'isCancelled', 'isVacated', 'isRescheduled', 'tooltipDateTime', 'eventType', 'location', 'attendees', 'description', 'stateCourt', 'federalCourt']
        }
    };
}