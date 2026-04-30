public with sharing class EventCalendarController {

    private static final Id FIRM_CALENDAR_USER_ID = '005Hs00000GDhuK';

    @AuraEnabled(cacheable=false)
    public static List<Event> getUpcomingEvents(Id parentId) {
        if (parentId == null) return new List<Event>();

        return [
            SELECT
                Id,
                Subject,
                Description,
                Status__c,
                Type,
                Location,
                IsAllDayEvent,
                StartDateTime,
                EndDateTime,
                (
                    SELECT Relation.Name
                    FROM EventRelations
                    WHERE IsParent = false
                )
            FROM Event
            WHERE IsDeleted = false
              AND OwnerId = :FIRM_CALENDAR_USER_ID
              AND NEOS_Matter__c = :parentId
              AND StartDateTime >= :System.now()
            ORDER BY StartDateTime ASC
            LIMIT 200
        ];
    }

    @AuraEnabled(cacheable=false)
    public static List<Event> getPastEvents(Id parentId) {
        if (parentId == null) return new List<Event>();

        return [
            SELECT
                Id,
                Subject,
                Description,
                Status__c,
                Type,
                Location,
                IsAllDayEvent,
                StartDateTime,
                EndDateTime,
                (
                    SELECT Relation.Name
                    FROM EventRelations
                    WHERE IsParent = false
                )
            FROM Event
            WHERE IsDeleted = false
              AND OwnerId = :FIRM_CALENDAR_USER_ID
              AND NEOS_Matter__c = :parentId
              AND StartDateTime < :System.now()
            ORDER BY StartDateTime DESC
            LIMIT 200
        ];
    }
}
