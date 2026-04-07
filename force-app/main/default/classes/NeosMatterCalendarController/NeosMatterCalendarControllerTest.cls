@IsTest
private class NeosMatterCalendarControllerTest {

    @IsTest
    static void testGetMatterEvents_withMatter() {
        // Create a Matter
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter'
        );
        insert matter;

        // Create an Event related to the Matter
        Event e = new Event(
            Subject = 'Test Event',
            StartDateTime = System.now(),
            EndDateTime = System.now().addHours(1),
            Neos_Matter__c = matter.Id
        );
        insert e;

        Test.startTest();
        List<Event> results =
            NeosMatterCalendarController.getMatterEvents(matter.Id);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return one event');
        System.assertEquals(matter.Id, results[0].Neos_Matter__c);
    }

    @IsTest
    static void testGetMatterEvents_nullMatter() {
        Test.startTest();
        List<Event> results =
            NeosMatterCalendarController.getMatterEvents(null);
        Test.stopTest();

        System.assertNotEquals(null, results);
        System.assertEquals(0, results.size(), 'Should return empty list');
    }
}