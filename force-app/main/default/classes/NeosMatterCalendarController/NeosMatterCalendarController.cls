public with sharing class NeosMatterCalendarController {
    private static final Id FIRM_CALENDAR_USER_ID = '005Hs00000GDhuK';

    @AuraEnabled(cacheable=true)
    public static List<Event> getMatterEvents(Id matterId) {
        if (matterId == null) {
            return new List<Event>();
        }

        return [
            SELECT Id,
                   Subject,
                   Status__c,
                   StartDateTime,
                   EndDateTime,
                   IsAllDayEvent,
                   Type,
                   Location,
                   Description,
                   Neos_Matter__c
            FROM Event
            WHERE Neos_Matter__c = :matterId
            AND OwnerId = :FIRM_CALENDAR_USER_ID
            ORDER BY StartDateTime ASC
        ];
    }
}
