@IsTest
private class EventCalendarControllerRefactorTest {

    private static final Id FIRM_CALENDAR_USER_ID = '005Hs00000GDhuK';

    private static User createUser(String prefix) {
        Profile sysAdmin = [
            SELECT Id
            FROM Profile
            WHERE Name = 'System Administrator'
            LIMIT 1
        ];

        User userRecord = new User(
            Alias = prefix.left(4),
            Email = prefix + '@example.com',
            EmailEncodingKey = 'UTF-8',
            LastName = prefix,
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'America/Los_Angeles',
            Username = prefix + System.currentTimeMillis() + '@example.com',
            ProfileId = sysAdmin.Id
        );

        insert userRecord;
        return userRecord;
    }

    @IsTest
    static void testUpcomingEvents() {
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Matter'
        );
        insert matter;

        Calendar_Event__c upcoming = new Calendar_Event__c(
            Subject__c               = 'Upcoming Event',
            Start_DateTime__c        = System.now().addDays(1),
            End_DateTime__c          = System.now().addDays(1).addHours(1),
            Matter__c                = matter.Id,
            Is_All_Day__c            = false,
            Sync_To_Firm_Calendar__c = false,
            OwnerId                  = FIRM_CALENDAR_USER_ID
        );
        insert upcoming;

        User attendee = createUser('upcomingattendee');
        insert new Calendar_Attendee__c(
            Calendar_Event__c = upcoming.Id,
            User__c           = attendee.Id,
            Email__c          = attendee.Email
        );

        Test.startTest();
        List<Calendar_Event__c> results =
            EventCalendarControllerRefactor.getUpcomingEvents(matter.Id);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return one upcoming event');
        System.assertEquals(upcoming.Id, results[0].Id);
        System.assertEquals(1, results[0].Calendar_Attendees__r.size(), 'Should include attendee');
    }

    @IsTest
    static void testPastEvents() {
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter Past',
            Case_Title__c = 'Test Matter Past'
        );
        insert matter;

        Calendar_Event__c past = new Calendar_Event__c(
            Subject__c               = 'Past Event',
            Start_DateTime__c        = System.now().addDays(-2),
            End_DateTime__c          = System.now().addDays(-2).addHours(1),
            Matter__c                = matter.Id,
            Is_All_Day__c            = false,
            Sync_To_Firm_Calendar__c = false,
            OwnerId                  = FIRM_CALENDAR_USER_ID
        );
        insert past;

        Test.startTest();
        List<Calendar_Event__c> results =
            EventCalendarControllerRefactor.getPastEvents(matter.Id);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return one past event');
        System.assertEquals(past.Id, results[0].Id);
    }

    @IsTest
    static void testNullParentId() {
        Test.startTest();
        List<Calendar_Event__c> upcoming =
            EventCalendarControllerRefactor.getUpcomingEvents(null);
        List<Calendar_Event__c> past =
            EventCalendarControllerRefactor.getPastEvents(null);
        Test.stopTest();

        System.assertEquals(0, upcoming.size());
        System.assertEquals(0, past.size());
    }
}