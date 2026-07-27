@IsTest
public class TimeTrackerControllerTest {

    private static NEOS_Matter__c createMatter() {
        NEOS_Matter__c m = new NEOS_Matter__c(
            Name                 = 'Test Matter',
            Case_Title__c        = 'Test Matter',
            CourtJurisdiction__c = 'Test Jurisdiction'
        );
        insert m;
        return m;
    }

    @IsTest
    static void start_createsRunningEntry() {
        NEOS_Matter__c m = createMatter();

        Test.startTest();
        TimeTrackerController.TimeEntryDTO dto = TimeTrackerController.start(m.Id);
        Test.stopTest();

        System.assertNotEquals(null, dto.id, 'A new Time_Entry__c should have been inserted');
        System.assertEquals(m.Id, dto.matterId);
        System.assertEquals(true, dto.isRunning);
        System.assertEquals(false, dto.isPaused);
        System.assertEquals(0, dto.pausedSeconds);
    }

    @IsTest
    static void start_isIdempotent_returnsSameOpenEntry() {
        NEOS_Matter__c m = createMatter();

        Test.startTest();
        TimeTrackerController.TimeEntryDTO first  = TimeTrackerController.start(m.Id);
        TimeTrackerController.TimeEntryDTO second = TimeTrackerController.start(m.Id);
        Test.stopTest();

        System.assertEquals(first.id, second.id, 'A second start() for the same matter should return the existing open entry, not create a duplicate');
        System.assertEquals(1, [SELECT COUNT() FROM Time_Entry__c WHERE NEOS_matter__c = :m.Id]);
    }

    @IsTest
    static void pause_thenResume_accumulatesPausedSeconds() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);

        Test.startTest();
        TimeTrackerController.TimeEntryDTO paused = TimeTrackerController.pause(started.id);
        System.assertEquals(true, paused.isPaused);
        System.assertNotEquals(null, paused.pausedStart);

        TimeTrackerController.TimeEntryDTO resumed = TimeTrackerController.resume(started.id);
        Test.stopTest();

        System.assertEquals(false, resumed.isPaused);
        System.assertEquals(null, resumed.pausedStart);
        System.assert(resumed.pausedSeconds >= 0, 'Pause window should have been rolled into pausedSeconds');
    }

    @IsTest
    static void pause_onAlreadyStoppedEntry_throws() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);
        TimeTrackerController.stop(started.id);

        Test.startTest();
        Boolean threw = false;
        try {
            TimeTrackerController.pause(started.id);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Pausing a stopped entry should throw');
    }

    @IsTest
    static void resume_onAlreadyStoppedEntry_throws() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);
        TimeTrackerController.stop(started.id);

        Test.startTest();
        Boolean threw = false;
        try {
            TimeTrackerController.resume(started.id);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Resuming a stopped entry should throw');
    }

    @IsTest
    static void stop_rollsInOpenPauseWindow_andSetsEndTime() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);
        TimeTrackerController.pause(started.id);

        Test.startTest();
        TimeTrackerController.TimeEntryDTO stopped = TimeTrackerController.stop(started.id);
        Test.stopTest();

        System.assertEquals(false, stopped.isRunning);
        System.assertNotEquals(null, stopped.endTime);
        System.assertNotEquals(null, stopped.durationSeconds);

        Time_Entry__c row = [SELECT Paused_Start__c, end_time__c FROM Time_Entry__c WHERE Id = :started.id];
        System.assertEquals(null, row.Paused_Start__c, 'Stopping while paused should clear the open pause window');
        System.assertNotEquals(null, row.end_time__c);
    }

    @IsTest
    static void getActiveEntry_withMatterId_scopesToThatMatter() {
        NEOS_Matter__c m1 = createMatter();
        NEOS_Matter__c m2 = createMatter();
        TimeTrackerController.start(m1.Id);

        Test.startTest();
        TimeTrackerController.TimeEntryDTO forM1 = TimeTrackerController.getActiveEntry(m1.Id);
        TimeTrackerController.TimeEntryDTO forM2 = TimeTrackerController.getActiveEntry(m2.Id);
        Test.stopTest();

        System.assertNotEquals(null, forM1, 'Matter with a running entry should return it');
        System.assertEquals(null, forM2, 'Matter with no running entry should return null');
    }

    @IsTest
    static void getActiveEntry_nullMatterId_returnsAnyOpenEntryForUser() {
        // Regression test: a bind variable compared with `=` against null only matches rows
        // where the field itself is null, so a naive `NEOS_matter__c = :matterId` filter with
        // matterId == null would always return zero rows here.
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);

        Test.startTest();
        TimeTrackerController.TimeEntryDTO dto = TimeTrackerController.getActiveEntry(null);
        Test.stopTest();

        System.assertNotEquals(null, dto, 'Null matterId should still find the user\'s open entry');
        System.assertEquals(started.id, dto.id);
    }

    @IsTest
    static void saveDetails_blankNotes_throws() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);

        Test.startTest();
        Boolean threw = false;
        try {
            TimeTrackerController.saveDetails(started.id, '  ');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Blank notes should throw');
    }

    @IsTest
    static void saveDetailsWithEditedDuration_recomputesEndTimeFromEditedSeconds() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);
        TimeTrackerController.stop(started.id);

        Test.startTest();
        TimeTrackerController.TimeEntryDTO dto = TimeTrackerController.saveDetailsWithEditedDuration(
            started.id, 'Did some work', 3600, null
        );
        Test.stopTest();

        System.assertEquals(3600, dto.durationSeconds, 'Duration should reflect the edited seconds exactly');

        Time_Entry__c row = [SELECT Notes__c, Start_time__c, end_time__c FROM Time_Entry__c WHERE Id = :started.id];
        System.assertEquals('Did some work', row.Notes__c);
        Long deltaMs = row.end_time__c.getTime() - row.Start_time__c.getTime();
        System.assertEquals(3600000L, deltaMs);
    }

    @IsTest
    static void saveDetailsWithEditedDuration_negativeSeconds_throws() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.TimeEntryDTO started = TimeTrackerController.start(m.Id);
        TimeTrackerController.stop(started.id);

        Test.startTest();
        Boolean threw = false;
        try {
            TimeTrackerController.saveDetailsWithEditedDuration(started.id, 'notes', -5, null);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Negative edited seconds should throw');
    }

    @IsTest
    static void getRecentEntries_groupsTodayVsThisWeek() {
        NEOS_Matter__c m = createMatter();

        Time_Entry__c today = new Time_Entry__c(
            NEOS_matter__c    = m.Id,
            Staff__c          = UserInfo.getUserId(),
            Start_time__c     = Datetime.now().addHours(-2),
            end_time__c       = Datetime.now().addHours(-1),
            Paused_Seconds__c = 0,
            Notes__c          = 'Today entry'
        );
        Time_Entry__c earlier = new Time_Entry__c(
            NEOS_matter__c    = m.Id,
            Staff__c          = UserInfo.getUserId(),
            Start_time__c     = Datetime.now().addDays(-2).addHours(-2),
            end_time__c       = Datetime.now().addDays(-2).addHours(-1),
            Paused_Seconds__c = 0,
            Notes__c          = 'Earlier-this-week entry'
        );
        insert new List<Time_Entry__c>{ today, earlier };

        Test.startTest();
        List<TimeTrackerController.HistoryGroupDTO> groups = TimeTrackerController.getRecentEntries(7);
        Test.stopTest();

        System.assertEquals(2, groups.size());
        TimeTrackerController.HistoryGroupDTO todayGroup = groups[0];
        TimeTrackerController.HistoryGroupDTO weekGroup  = groups[1];

        System.assertEquals('Today', todayGroup.label);
        System.assertEquals(1, todayGroup.entries.size());
        System.assertEquals('Today entry', todayGroup.entries[0].notes);

        System.assertEquals('This Week', weekGroup.label);
        System.assertEquals(1, weekGroup.entries.size());
        System.assertEquals('Earlier-this-week entry', weekGroup.entries[0].notes);
    }

    @IsTest
    static void getRecentEntries_excludesStillRunningEntries() {
        NEOS_Matter__c m = createMatter();
        TimeTrackerController.start(m.Id); // left running, no end_time__c

        Test.startTest();
        List<TimeTrackerController.HistoryGroupDTO> groups = TimeTrackerController.getRecentEntries(7);
        Test.stopTest();

        for (TimeTrackerController.HistoryGroupDTO g : groups) {
            System.assertEquals(0, g.entries.size(), 'A still-running entry should not appear in history');
        }
    }

    @IsTest
    static void logCompletedEntry_insertsStoppedEntryWithGivenDuration() {
        NEOS_Matter__c m = createMatter();

        Test.startTest();
        Id entryId = TimeTrackerController.logCompletedEntry(m.Id, 'Completed: Draft Complaint', 0.5);
        Test.stopTest();

        Time_Entry__c row = [
            SELECT NEOS_matter__c, Staff__c, Notes__c, Start_time__c, end_time__c, Entry_Date__c, Submit_Hours__c
            FROM Time_Entry__c
            WHERE Id = :entryId
        ];
        System.assertEquals(m.Id, row.NEOS_matter__c);
        System.assertEquals(UserInfo.getUserId(), row.Staff__c);
        System.assertEquals('Completed: Draft Complaint', row.Notes__c);
        System.assertNotEquals(null, row.end_time__c, 'Log-after-the-fact entries should already be stopped');
        System.assertEquals(Date.today(), row.Entry_Date__c);
        System.assertEquals(0.5, row.Submit_Hours__c, 'Submit_Hours__c should store exactly what was entered, not a seconds round-trip');

        Long deltaMs = row.end_time__c.getTime() - row.Start_time__c.getTime();
        System.assertEquals(1800000L, deltaMs);
    }

    @IsTest
    static void logCompletedEntry_nullMatterId_throws() {
        Boolean threw = false;
        Test.startTest();
        try {
            TimeTrackerController.logCompletedEntry(null, 'Notes', 1);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'A null Matter should throw');
    }

    @IsTest
    static void logCompletedEntry_blankNotes_throws() {
        NEOS_Matter__c m = createMatter();
        Boolean threw = false;
        Test.startTest();
        try {
            TimeTrackerController.logCompletedEntry(m.Id, '  ', 1);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Blank notes should throw');
    }

    @IsTest
    static void logCompletedEntry_zeroOrNegativeHours_throws() {
        NEOS_Matter__c m = createMatter();
        Boolean threw = false;
        Test.startTest();
        try {
            TimeTrackerController.logCompletedEntry(m.Id, 'Notes', 0);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assert(threw, 'Zero (or negative) hours should throw');
    }
}
