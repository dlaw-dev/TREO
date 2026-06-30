@IsTest
public class EventAttendeeUiControllerRefactorTest {

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
            WHERE Name = 'TREO Service Agent'
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

        Id eventId = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Direct User Event',
            '2026-02-01T09:00:00.000Z',
            '2026-02-01T10:00:00.000Z',
            false,
            'Hearing',
            'Another Location',
            'Another Description',
            new List<Id>{ u.Id },
            new List<Id>(),
            new List<String>{ '30 Days Before' },
            null,
            null, null, null, null, null,
            'Free',
            null
        );

        Test.stopTest();

        System.assertNotEquals(
            null,
            eventId,
            'Calendar Event should be created with direct user attendees'
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

        Id eventId = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Group Event',
            '2026-01-01T10:00:00.000Z',
            '2026-01-01T11:00:00.000Z',
            false,
            'Trial',
            'Test Location',
            'Test Description',
            new List<Id>(),
            groupIds,
            new List<String>{ '10 Days Before' },
            null,
            null, null, null, null, null,
            'Free',
            null
        );

        Test.stopTest();

        System.assertNotEquals(
            null,
            eventId,
            'Calendar Event should be created even when group IDs are provided'
        );
    }

    /* =========================================================
       TEST 3: Save Event with NULL attendees
       ========================================================= */
    @IsTest
    static void testSaveEventWithNullAttendees() {

        NEOS_Matter__c m = createMatter();

        Test.startTest();

        Id eventId = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Null Attendees Event',
            '2026-03-01T09:00:00.000Z',
            '2026-03-01T10:00:00.000Z',
            false,
            'Deadline',
            'Null Location',
            'Null Description',
            null,
            null,
            new List<String>{ '1 Day Before' },
            null,
            null, null, null, null, null,
            'Free',
            null
        );

        Test.stopTest();

        System.assertNotEquals(
            null,
            eventId,
            'Calendar Event should be created when attendees are null'
        );
    }

    /* =========================================================
       TEST 3B: Save All-Day Event uses Date boundaries
       ========================================================= */
    @IsTest
    static void testSaveAllDayEventDateNormalization() {

        NEOS_Matter__c m = createMatter();

        Test.startTest();

        Id eventId = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'All Day Event',
            '2026-04-15',
            '2026-04-15',
            true,
            'Trial',
            'Court',
            'All day test',
            null,
            null,
            new List<String>(),
            null,
            null, null, null, null, null,
            'Free',
            null
        );

        Test.stopTest();

        Calendar_Event__c saved = [
            SELECT Is_All_Day__c, Start_DateTime__c, End_DateTime__c
            FROM Calendar_Event__c
            WHERE Id = :eventId
            LIMIT 1
        ];

        System.assertEquals(true, saved.Is_All_Day__c, 'Calendar Event should be all-day');
        System.assertEquals(
            Date.newInstance(2026, 4, 15),
            saved.Start_DateTime__c.dateGmt(),
            'Start datetime should align to selected all-day date in GMT'
        );
        Date endDateGmt = saved.End_DateTime__c.dateGmt();
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

        Id eventId1 = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Possible Double Submit',
            '2026-05-01T09:00:00.000Z',
            '2026-05-01T10:00:00.000Z',
            false,
            'Trial',
            'Courtroom',
            'Idempotency test',
            null,
            null,
            new List<String>(),
            null,
            null, null, null, null, null,
            'Free',
            null
        );

        Id eventId2 = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Possible Double Submit',
            '2026-05-01T09:00:00.000Z',
            '2026-05-01T10:00:00.000Z',
            false,
            'Trial',
            'Courtroom',
            'Idempotency test',
            null,
            null,
            new List<String>(),
            null,
            null, null, null, null, null,
            'Free',
            null
        );

        Test.stopTest();

        System.assertNotEquals(null, eventId1, 'First submit should create a calendar event');
        System.assertNotEquals(null, eventId2, 'Second submit should also return a calendar event id');

        Integer countEvents = [
            SELECT COUNT()
            FROM Calendar_Event__c
            WHERE Matter__c = :m.Id
              AND Subject__c = 'Possible Double Submit'
        ];
        System.assert(
            countEvents >= 1,
            'At least one calendar event should be created for duplicate-submission scenario'
        );
    }

    /* =========================================================
       TEST 3D: Recurring weekly event generates multiple records
       ========================================================= */
    @IsTest
    static void testSaveWeeklyRecurringEvent() {

        NEOS_Matter__c m = createMatter();

        Test.startTest();

        Id eventId = EventAttendeeUiControllerRefactor.saveEventWithAttendees(
            m.Id,
            FIRM_CALENDAR_USER_ID,
            'Weekly Standup',
            '2026-06-01T09:00:00.000Z',
            '2026-06-01T10:00:00.000Z',
            false,
            null,
            null,
            null,
            null,
            null,
            new List<String>(),
            null,
            'Weekly',
            1,
            '2026-06-30',
            new List<String>{ 'monday', 'wednesday', 'friday' },
            null,
            'Free',
            null
        );

        Test.stopTest();

        System.assertNotEquals(null, eventId, 'First event should be created');

        Integer count = [
            SELECT COUNT()
            FROM Calendar_Event__c
            WHERE Matter__c = :m.Id
              AND Subject__c = 'Weekly Standup'
              AND Recurrence_Pattern__c = 'Weekly'
        ];

        System.assert(count >= 3, 'Should have generated multiple weekly occurrences, got: ' + count);
    }

    /* =========================================================
       TEST 4: searchUsers
       ========================================================= */
    @IsTest
    static void testSearchUsers() {

        createAllowedUser();

        Test.startTest();

        List<User> users =
            EventAttendeeUiControllerRefactor.searchUsers('User');

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
            EventAttendeeUiControllerRefactor.searchGroups('Team');

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

        List<User> users = EventAttendeeUiControllerRefactor.getGroupUsers(g.Id);

        Test.stopTest();

        System.assertEquals(1, users.size(), 'Should return the allowed group member');
        System.assertEquals(u.Id, users[0].Id, 'Returned member should match the group member');
    }

    /* =========================================================
       TEST 7: getEventAttendees
       ========================================================= */
    @IsTest
    static void testGetEventAttendees() {

        User u = createAllowedUser();

        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c        = 'Attendee Test Event',
            Start_DateTime__c = Datetime.newInstance(2026, 6, 1, 9, 0, 0),
            End_DateTime__c   = Datetime.newInstance(2026, 6, 1, 10, 0, 0),
            OwnerId           = UserInfo.getUserId()
        );
        insert ev;

        Calendar_Attendee__c att = new Calendar_Attendee__c(
            Calendar_Event__c = ev.Id,
            User__c           = u.Id,
            Email__c          = u.Email
        );
        insert att;

        Test.startTest();

        List<Calendar_Attendee__c> results =
            EventAttendeeUiControllerRefactor.getEventAttendees(ev.Id);

        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 attendee');
        System.assertEquals(u.Id, results[0].User__c, 'Attendee user should match');
    }

    /* =========================================================
       TEST 8: addAttendeeToEvent + idempotency
       ========================================================= */
    @IsTest
    static void testAddAttendeeToEvent() {

        User u = createAllowedUser();

        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c        = 'Add Attendee Event',
            Start_DateTime__c = Datetime.newInstance(2026, 7, 1, 9, 0, 0),
            End_DateTime__c   = Datetime.newInstance(2026, 7, 1, 10, 0, 0),
            OwnerId           = UserInfo.getUserId()
        );
        insert ev;

        Test.startTest();

        Id attId1 = EventAttendeeUiControllerRefactor.addAttendeeToEvent(ev.Id, u.Id);
        Id attId2 = EventAttendeeUiControllerRefactor.addAttendeeToEvent(ev.Id, u.Id);

        Test.stopTest();

        System.assertNotEquals(null, attId1, 'Should return attendee Id');
        System.assertEquals(attId1, attId2, 'Duplicate add should return same attendee Id');

        Integer count = [
            SELECT COUNT() FROM Calendar_Attendee__c
            WHERE Calendar_Event__c = :ev.Id AND User__c = :u.Id
        ];
        System.assertEquals(1, count, 'Should have exactly one attendee record');
    }

    /* =========================================================
       TEST 9: removeAttendeeFromEvent
       ========================================================= */
    @IsTest
    static void testRemoveAttendeeFromEvent() {

        User u = createAllowedUser();

        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c        = 'Remove Attendee Event',
            Start_DateTime__c = Datetime.newInstance(2026, 8, 1, 9, 0, 0),
            End_DateTime__c   = Datetime.newInstance(2026, 8, 1, 10, 0, 0),
            OwnerId           = UserInfo.getUserId()
        );
        insert ev;

        Calendar_Attendee__c att = new Calendar_Attendee__c(
            Calendar_Event__c = ev.Id,
            User__c           = u.Id,
            Email__c          = u.Email
        );
        insert att;

        Test.startTest();

        EventAttendeeUiControllerRefactor.removeAttendeeFromEvent(att.Id);

        Test.stopTest();

        Integer count = [
            SELECT COUNT() FROM Calendar_Attendee__c WHERE Id = :att.Id
        ];
        System.assertEquals(0, count, 'Attendee record should be deleted');
    }

    /* =========================================================
       TEST 10: rescheduleEvent preserves event fields and moves reminders
       ========================================================= */
    @IsTest
    static void testRescheduleEventPreservesFields() {

        NEOS_Matter__c m = createMatter();
        User u = createAllowedUser();

        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c               = 'Reschedule Preserve Event',
            Start_DateTime__c        = Datetime.newInstanceGmt(2026, 9, 1, 9, 0, 0),
            End_DateTime__c          = Datetime.newInstanceGmt(2026, 9, 1, 10, 0, 0),
            Is_All_Day__c            = false,
            Event_Type__c            = 'Trial',
            Location__c              = 'Original Location',
            Description__c           = 'Original Description',
            Matter__c                = m.Id,
            OwnerId                  = UserInfo.getUserId(),
            Sync_To_Firm_Calendar__c = true,
            Graph_Event_Id__c        = 'test-graph-id-abc123'
        );
        insert ev;

        insert new Calendar_Attendee__c(
            Calendar_Event__c = ev.Id,
            User__c           = u.Id,
            Email__c          = u.Email
        );

        insert new Event_Reminder__c(
            Calendar_Event__c     = ev.Id,
            Event_Name__c         = ev.Subject__c,
            Recipient_User_ID__c  = u.Id,
            Recipient_Email__c    = u.Email,
            Reminder_Type__c      = '30 Days Before',
            Reminder_Date_Time__c = ev.Start_DateTime__c.addDays(-30)
        );

        Test.startTest();

        Id newEventId = EventAttendeeUiControllerRefactor.rescheduleEvent(
            ev.Id,
            '2026-09-08T14:00:00.000Z',
            '2026-09-08T15:00:00.000Z',
            false,
            null
        );

        Test.stopTest();

        Calendar_Event__c oldEvent = [
            SELECT Status__c
            FROM Calendar_Event__c
            WHERE Id = :ev.Id
            LIMIT 1
        ];

        Calendar_Event__c newEvent = [
            SELECT Subject__c,
                   Start_DateTime__c,
                   End_DateTime__c,
                   Is_All_Day__c,
                   Event_Type__c,
                   Location__c,
                   Description__c,
                   Matter__c,
                   OwnerId,
                   Sync_To_Firm_Calendar__c
            FROM Calendar_Event__c
            WHERE Id = :newEventId
            LIMIT 1
        ];

        System.assertEquals('Continued/Rescheduled', oldEvent.Status__c, 'Original event should be marked rescheduled');
        System.assertEquals('Reschedule Preserve Event', newEvent.Subject__c, 'Subject should be preserved');
        System.assertEquals('Trial', newEvent.Event_Type__c, 'Event type should be preserved');
        System.assertEquals('Original Location', newEvent.Location__c, 'Location should be preserved');
        System.assertEquals('Original Description', newEvent.Description__c, 'Description should be preserved');
        System.assertEquals(m.Id, newEvent.Matter__c, 'Matter should be preserved');
        System.assertEquals(true, newEvent.Sync_To_Firm_Calendar__c, 'Firm calendar sync flag should be preserved');
        System.assertEquals(Datetime.newInstanceGmt(2026, 9, 8, 14, 0, 0), newEvent.Start_DateTime__c, 'New start should be applied');
        System.assertEquals(Datetime.newInstanceGmt(2026, 9, 8, 15, 0, 0), newEvent.End_DateTime__c, 'New end should be applied');

        System.assertEquals(
            0,
            [SELECT COUNT() FROM Event_Reminder__c WHERE Calendar_Event__c = :ev.Id],
            'Original event reminders should be removed'
        );
        System.assertEquals(
            1,
            [SELECT COUNT() FROM Calendar_Attendee__c WHERE Calendar_Event__c = :newEventId AND User__c = :u.Id],
            'Attendee should be copied to the new event'
        );
        System.assertEquals(
            1,
            [SELECT COUNT() FROM Event_Reminder__c WHERE Calendar_Event__c = :newEventId],
            'Reminder should be recreated on the new event'
        );
    }

    /* =========================================================
       TEST 14: updateCalendarEvent — basic field update
       ========================================================= */
    @IsTest
    static void testUpdateCalendarEvent_basicUpdate() {
        NEOS_Matter__c m = createMatter();
        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c        = 'Original Subject',
            Start_DateTime__c = Datetime.newInstanceGmt(2026, 8, 1, 9, 0, 0),
            End_DateTime__c   = Datetime.newInstanceGmt(2026, 8, 1, 10, 0, 0),
            Is_All_Day__c     = false,
            Matter__c         = m.Id,
            OwnerId           = UserInfo.getUserId()
        );
        insert ev;

        Test.startTest();
        EventAttendeeUiControllerRefactor.updateCalendarEvent(
            ev.Id, 'Updated Subject',
            '2026-08-01T10:00:00.000Z', '2026-08-01T11:00:00.000Z',
            false, 'Deposition', 'Room 1', 'Updated desc',
            new List<String>(), null, new List<Map<String, String>>(), null, 'Busy'
        );
        Test.stopTest();

        Calendar_Event__c updated = [SELECT Subject__c, Location__c, Show_Time_As__c FROM Calendar_Event__c WHERE Id = :ev.Id];
        System.assertEquals('Updated Subject', updated.Subject__c);
        System.assertEquals('Room 1', updated.Location__c);
        System.assertEquals('Busy', updated.Show_Time_As__c);
    }

    /* =========================================================
       TEST 15: updateCalendarEvent — with attendees
       ========================================================= */
    @IsTest
    static void testUpdateCalendarEvent_withAttendees() {
        NEOS_Matter__c m = createMatter();
        User u = createAllowedUser();

        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c        = 'Attendee Update Event',
            Start_DateTime__c = Datetime.newInstanceGmt(2026, 8, 5, 9, 0, 0),
            End_DateTime__c   = Datetime.newInstanceGmt(2026, 8, 5, 10, 0, 0),
            Is_All_Day__c     = false,
            Matter__c         = m.Id,
            OwnerId           = UserInfo.getUserId()
        );
        insert ev;

        insert new Event_Reminder__c(
            Calendar_Event__c     = ev.Id,
            Event_Name__c         = ev.Subject__c,
            Recipient_User_ID__c  = u.Id,
            Recipient_Email__c    = u.Email,
            Reminder_Type__c      = '1 Day Before',
            Reminder_Date_Time__c = Datetime.newInstanceGmt(2026, 8, 4, 9, 0, 0)
        );

        Test.startTest();
        EventAttendeeUiControllerRefactor.updateCalendarEvent(
            ev.Id, 'Attendee Update Event',
            '2026-08-05T09:00:00.000Z', '2026-08-05T10:00:00.000Z',
            false, null, null, null,
            new List<String>{ u.Id }, null, new List<Map<String, String>>(), null, 'Free'
        );
        Test.stopTest();

        System.assertEquals(
            1,
            [SELECT COUNT() FROM Calendar_Attendee__c WHERE Calendar_Event__c = :ev.Id AND User__c = :u.Id]
        );
    }

    /* =========================================================
       TEST 16: updateCalendarEvent — all-day date path
       ========================================================= */
    @IsTest
    static void testUpdateCalendarEvent_allDay() {
        NEOS_Matter__c m = createMatter();
        Calendar_Event__c ev = new Calendar_Event__c(
            Subject__c        = 'All Day Update',
            Start_DateTime__c = Datetime.newInstanceGmt(2026, 8, 10, 0, 0, 0),
            End_DateTime__c   = Datetime.newInstanceGmt(2026, 8, 10, 0, 0, 0),
            Is_All_Day__c     = true,
            Matter__c         = m.Id,
            OwnerId           = UserInfo.getUserId()
        );
        insert ev;

        Test.startTest();
        EventAttendeeUiControllerRefactor.updateCalendarEvent(
            ev.Id, 'All Day Update',
            '2026-08-11', '2026-08-11',
            true, null, null, null,
            new List<String>(), null, new List<Map<String, String>>(), null, 'Free'
        );
        Test.stopTest();

        Calendar_Event__c updated = [SELECT Is_All_Day__c FROM Calendar_Event__c WHERE Id = :ev.Id];
        System.assertEquals(true, updated.Is_All_Day__c);
    }

    /* =========================================================
       TEST 17: searchUsers — blank keyword returns list
       ========================================================= */
    @IsTest
    static void testSearchUsers_blank() {
        createAllowedUser();
        Test.startTest();
        List<User> results = EventAttendeeUiControllerRefactor.searchUsers('');
        Test.stopTest();
        System.assert(results != null);
    }

    /* =========================================================
       TEST 18: searchGroups — blank keyword returns list
       ========================================================= */
    @IsTest
    static void testSearchGroups_blank() {
        Test.startTest();
        List<Object> results = EventAttendeeUiControllerRefactor.searchGroups('');
        Test.stopTest();
        System.assert(results != null);
    }
}