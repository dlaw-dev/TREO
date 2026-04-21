import LightningDatatable from 'lightning/datatable';
import eventTextTemplate from './eventText.html';
import eventUrlTemplate from './eventUrl.html';

export default class EventsCalendarDatatable extends LightningDatatable {
    static customTypes = {
        eventText: {
            template: eventTextTemplate,
            standardCellLayout: true,
            typeAttributes: ['value', 'isCancelled']
        },
        eventUrl: {
            template: eventUrlTemplate,
            standardCellLayout: true,
            typeAttributes: ['label', 'value', 'target', 'isCancelled']
        }
    };
}
