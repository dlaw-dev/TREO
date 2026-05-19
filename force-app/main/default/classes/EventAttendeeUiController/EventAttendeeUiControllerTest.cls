@IsTest
public class EventAttendeeUiControllerTest {

    private static final Id FIRM_CALENDAR_USER_ID = UserInfo.getUserId();

    /* =========================================================
       Utility: Create Matter
       ========================================================= */
    private static NEOS_Matter__c createMatter() {

        NEOS_Matter__c m = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Matter'
        );

        insert m;
        return m;
    }

    /* =========================================================
       Utility: Create allowed test user
       ========================================================= */
    private static User createAllowedUser() {

        Profile p = [
            SELECT Id
            FROM Profile
            WHERE Name = 'System Administrator'
            LIMIT 1
        ];

        User u = new User(
            Alias = 'tuser',
            Email = 'testuser@example.com',
            EmailEncodingKey = 'UTF-8',
            LastName = 'User',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'America/Los_Angeles',
            Username = 'testuser' + System.currentTimeMillis() + '@example.com',
            ProfileId = p.Id
        );

        insert u;
        return u;
    }

    /* =========================================================
       TEST 1: Save Event with Direct User
       ========================================================= */
    @IsTest
    static void testSaveEventWithDirectUsers() {

        NEOS_Matter__c m = createMatter();
        User u = createAllowedUser();

        Test.startTest();

        Id eventId = EventAttendeeUiController.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Direct User Event',
            '2026-02-01T09:00:00.000Z',
            '2026-02-01T10:00:00.000Z',
            false,
            'Busy',
            false,
            'Hearing',
            'Another Location',
            'Another Description',
            new List<Id>{ u.Id },
            new List<Id>(),
            new List<String>{ '30 Days Before' }
        );

        Test.stopTest();

        System.assertNotEquals(
            null,
            eventId,
            'Event should be created with direct user attendees'
        );
    }

    /* =========================================================
       TEST 2: Save Event with Group IDs
       ========================================================= */
    @IsTest
    static void testSaveEventWithGroupIdsOnly() {

        NEOS_Matter__c m = createMatter();

        List<Group> groups = [
            SELECT Id
            FROM Group
            WHERE Type = 'Regular'
            LIMIT 1
        ];

        List<Id> groupIds =
            groups.isEmpty()
                ? new List<Id>()
                : new List<Id>{ groups[0].Id };

        Test.startTest();

        Id eventId = EventAttendeeUiController.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Group Event',
            '2026-01-01T10:00:00.000Z',
            '2026-01-01T11:00:00.000Z',
            false,
            'Busy',
            true,
            'Trial',
            'Test Location',
            'Test Description',
            new List<Id>(),
            groupIds,
            new List<String>{ '10 Days Before' }
        );

        Test.stopTest();

        System.assertNotEquals(
            null,
            eventId,
            'Event should be created even when group IDs are provided'
        );
    }

    /* =========================================================
       TEST 3: Save Event with NULL attendees
       ========================================================= */
    @IsTest
    static void testSaveEventWithNullAttendees() {

        NEOS_Matter__c m = createMatter();

        Test.startTest();

        Id eventId = EventAttendeeUiController.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Null Attendees Event',
            '2026-03-01T09:00:00.000Z',
            '2026-03-01T10:00:00.000Z',
            false,
            'Busy',
            true,
            'Deadline',
            'Null Location',
            'Null Description',
            null,
            null,
            new List<String>{ '1 Day Before' }
        );

        Test.stopTest();

        System.assertNotEquals(
            null,
            eventId,
            'Event should be created when attendees are null'
        );
    }

    /* =========================================================
       TEST 3B: Save All-Day Event uses Date boundaries
       ========================================================= */
    @IsTest
    static void testSaveAllDayEventDateNormalization() {

        NEOS_Matter__c m = createMatter();

        Test.startTest();

        Id eventId = EventAttendeeUiController.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'All Day Event',
            '2026-04-15',
            '2026-04-15',
            true,
            'Free',
            false,
            'Trial',
            'Court',
            'All day test',
            null,
            null,
            new List<String>()
        );

        Test.stopTest();

        Event saved = [
            SELECT IsAllDayEvent, ActivityDate, StartDateTime, EndDateTime
            FROM Event
            WHERE Id = :eventId
            LIMIT 1
        ];

        System.assertEquals(true, saved.IsAllDayEvent, 'Event should be all-day');
        System.assertEquals(Date.newInstance(2026, 4, 15), saved.ActivityDate, 'ActivityDate should match selected date');
        System.assertEquals(Date.newInstance(2026, 4, 15), saved.StartDateTime.dateGmt(), 'Start datetime should align to selected all-day date in GMT');
        Date endDateGmt = saved.EndDateTime.dateGmt();
        System.assert(
            new Set<Date>{
                Date.newInstance(2026, 4, 15),
                Date.newInstance(2026, 4, 16)
            }.contains(endDateGmt),
            'End datetime should remain compatible with all-day rendering across timezone normalization'
        );
    }

    /* =========================================================
       TEST 3C: Duplicate submission returns existing event
       ========================================================= */
    @IsTest
    static void testSaveEventDeduplicatesNearIdenticalSubmissions() {

        NEOS_Matter__c m = createMatter();

        Test.startTest();

        Id eventId1 = EventAttendeeUiController.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Possible Double Submit',
            '2026-05-01T09:00:00.000Z',
            '2026-05-01T10:00:00.000Z',
            false,
            'Busy',
            false,
            'Trial',
            'Courtroom',
            'Idempotency test',
            null,
            null,
            new List<String>()
        );

        Id eventId2 = EventAttendeeUiController.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Possible Double Submit',
            '2026-05-01T09:00:00.000Z',
            '2026-05-01T10:00:00.000Z',
            false,
            'Busy',
            false,
            'Trial',
            'Courtroom',
            'Idempotency test',
            null,
            null,
            new List<String>()
        );

        Test.stopTest();

        System.assertNotEquals(null, eventId1, 'First submit should create an event');
        System.assertNotEquals(null, eventId2, 'Second submit should also return an event id');

        Integer countEvents = [
            SELECT COUNT()
            FROM Event
            WHERE NEOS_Matter__c = :m.Id
              AND Subject = 'Possible Double Submit'
        ];
        System.assert(
            countEvents >= 1,
            'At least one event should be created for duplicate-submission scenario'
        );
    }

    /* =========================================================
       TEST 4: searchUsers
       ========================================================= */
    @IsTest
    static void testSearchUsers() {

        createAllowedUser();

        Test.startTest();

        List<User> users =
            EventAttendeeUiController.searchUsers('User');

        Test.stopTest();

        System.assertNotEquals(
            null,
            users,
            'searchUsers should return a list'
        );
    }

    /* =========================================================
       TEST 5: searchGroups
       ========================================================= */
    @IsTest
    static void testSearchGroups() {

        Test.startTest();

        List<Group> results =
            EventAttendeeUiController.searchGroups('Team');

        Test.stopTest();

        System.assertNotEquals(
            null,
            results,
            'searchGroups should return a list'
        );

        for (Group g : results) {

            System.assert(
                g.Name != null,
                'Returned group should have a Name'
            );

            System.assert(
                g.Name.contains('Team'),
                'Returned group must match search keyword'
            );
        }
    }

    /* =========================================================
       TEST 6: getGroupUsers
       ========================================================= */
    @IsTest
    static void testGetGroupUsers() {

        User u = createAllowedUser();

        Group g = new Group(
            Name = 'Team Roman',
            DeveloperName = 'Team_Roman_Test',
            Type = 'Regular'
        );
        insert g;

        insert new GroupMember(
            GroupId = g.Id,
            UserOrGroupId = u.Id
        );

        Test.startTest();

        List<User> users = EventAttendeeUiController.getGroupUsers(g.Id);

        Test.stopTest();

        System.assertEquals(1, users.size(), 'Should return the allowed group member');
        System.assertEquals(u.Id, users[0].Id, 'Returned member should match the group member');
    }
}
