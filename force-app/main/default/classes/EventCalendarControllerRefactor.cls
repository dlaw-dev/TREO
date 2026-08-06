public with sharing class EventCalendarControllerRefactor {

    @AuraEnabled(cacheable=false)
    public static List<Calendar_Event__c> getUpcomingEvents(Id parentId) {
        if (parentId == null) return new List<Calendar_Event__c>();
        Datetime now = System.now();
        Datetime todayStart = Datetime.newInstanceGmt(Date.today(), Time.newInstance(0, 0, 0, 0));

        return [
            SELECT
                Id,
                Subject__c,
                Description__c,
                Status__c,
                Event_Type__c,
                Location__c,
                Is_All_Day__c,
                Show_Time_As__c,
                Start_DateTime__c,
                End_DateTime__c,
                Mediator__c,
                Matter__r.State_Court__r.Name,
                Matter__r.Federal_Court__r.Name,
                (
                    SELECT User__c, User__r.Name
                    FROM Calendar_Attendees__r
                )
            FROM Calendar_Event__c
            WHERE IsDeleted = false
              AND Matter__c = :parentId
              AND (
                  (Is_All_Day__c = true  AND Start_DateTime__c >= :todayStart)
                  OR (Is_All_Day__c = false AND Start_DateTime__c >= :now)
              )
            ORDER BY Start_DateTime__c ASC
            LIMIT 200
        ];
    }

    @AuraEnabled(cacheable=false)
    public static List<Calendar_Event__c> getPastEvents(Id parentId) {
        if (parentId == null) return new List<Calendar_Event__c>();
        Datetime now = System.now();
        Datetime todayStart = Datetime.newInstanceGmt(Date.today(), Time.newInstance(0, 0, 0, 0));

        return [
            SELECT
                Id,
                Subject__c,
                Description__c,
                Status__c,
                Event_Type__c,
                Location__c,
                Is_All_Day__c,
                Show_Time_As__c,
                Start_DateTime__c,
                End_DateTime__c,
                Mediator__c,
                Matter__r.State_Court__r.Name,
                Matter__r.Federal_Court__r.Name,
                (
                    SELECT User__c, User__r.Name
                    FROM Calendar_Attendees__r
                )
            FROM Calendar_Event__c
            WHERE IsDeleted = false
              AND Matter__c = :parentId
              AND (
                  (Is_All_Day__c = true  AND Start_DateTime__c < :todayStart)
                  OR (Is_All_Day__c = false AND Start_DateTime__c < :now)
              )
            ORDER BY Start_DateTime__c DESC
            LIMIT 200
        ];
    }
}