@IsTest
private class EventCalendarControllerTest {

    @IsTest
    static void testUpcomingEvents() {
        // Create Matter
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter'
        );
        insert matter;

        // Upcoming Event
        Event upcoming = new Event(
            Subject = 'Upcoming Event',
            StartDateTime = System.now().addDays(1),
            EndDateTime   = System.now().addDays(1).addHours(1),
            NEOS_Matter__c = matter.Id
        );
        insert upcoming;

        Test.startTest();
        List<Event> results =
            EventCalendarController.getUpcomingEvents(matter.Id);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return one upcoming event');
        System.assertEquals(upcoming.Id, results[0].Id);
    }

    @IsTest
    static void testPastEvents() {
        // Create Matter
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter Past'
        );
        insert matter;

        // Past Event
        Event past = new Event(
            Subject = 'Past Event',
            StartDateTime = System.now().addDays(-2),
            EndDateTime   = System.now().addDays(-2).addHours(1),
            NEOS_Matter__c = matter.Id
        );
        insert past;

        Test.startTest();
        List<Event> results =
            EventCalendarController.getPastEvents(matter.Id);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return one past event');
        System.assertEquals(past.Id, results[0].Id);
    }

    @IsTest
    static void testNullParentId() {
        Test.startTest();
        List<Event> upcoming =
            EventCalendarController.getUpcomingEvents(null);
        List<Event> past =
            EventCalendarController.getPastEvents(null);
        Test.stopTest();

        System.assertEquals(0, upcoming.size());
        System.assertEquals(0, past.size());
    }
}