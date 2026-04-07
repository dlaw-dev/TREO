public with sharing class NeosMatterCalendarController {

    @AuraEnabled(cacheable=true)
    public static List<Event> getMatterEvents(Id matterId) {
        if (matterId == null) {
            return new List<Event>();
        }

        return [
            SELECT Id,
                   Subject,
                   StartDateTime,
                   EndDateTime,
                   Neos_Matter__c
            FROM Event
            WHERE Neos_Matter__c = :matterId
            ORDER BY StartDateTime ASC
        ];
    }
}