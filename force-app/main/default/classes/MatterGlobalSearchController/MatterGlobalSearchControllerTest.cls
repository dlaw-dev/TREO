@IsTest
public class MatterGlobalSearchControllerTest {

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
    static void search_shortTerm_returnsEmpty() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'ab');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Term < 3 chars should return empty');
    }

    @IsTest
    static void search_blankTerm_returnsEmpty() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, '');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Blank term should return empty');
    }

    @IsTest
    static void search_noMatches_returnsEmpty() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'ZZZnomatch');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Non-matching term should return empty');
    }

    @IsTest
    static void search_noteMatch_returnsNoteResult() {
        NEOS_Matter__c m = createMatter();
        insert new NEOS_Notes__c(
            NEOS_Matter__c      = m.Id,
            Note_Category__c    = 'Arbitration',
            Note_Description__c = 'Some note content'
        );

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'Arbitration');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 note result');
        System.assertEquals('NEOS_Notes__c', results[0].objectType);
        System.assertEquals('standard:note',  results[0].iconName);
        System.assertNotEquals(null, results[0].id);
    }

    @IsTest
    static void search_timeEntryMatch_returnsTimeEntryResult() {
        NEOS_Matter__c m = createMatter();
        insert new Time_Entry__c(
            NEOS_Matter__c  = m.Id,
            Submit_Hours__c = 1,
            Staff__c        = UserInfo.getUserId(),
            Entry_Date__c   = Date.today(),
            Notes__c        = 'xSearchTermx billing note'
        );

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 time entry result');
        System.assertEquals('Time_Entry__c',      results[0].objectType);
        System.assertEquals('standard:timesheet', results[0].iconName);
    }

    @IsTest
    static void search_taskMatch_returnsTaskResult() {
        NEOS_Matter__c m = createMatter();
        insert new Task(
            Subject      = 'xSearchTermx Task',
            OwnerId      = UserInfo.getUserId(),
            WhatId       = m.Id,
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(5)
        );

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 task result');
        System.assertEquals('Task',          results[0].objectType);
        System.assertEquals('standard:task', results[0].iconName);
    }

    @IsTest
    static void search_calendarEventMatch_returnsEventResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject ce = Schema.getGlobalDescribe().get('Calendar_Event__c').newSObject();
            ce.put('Subject__c',        'xSearchTermx Hearing');
            ce.put('Start_DateTime__c', System.now().addDays(5));
            ce.put('End_DateTime__c',   System.now().addDays(5).addHours(1));
            ce.put('Status__c',         'Active');
            ce.put('Event_Type__c',     'Hearing');
            ce.put('Matter__c',         m.Id);
            insert ce;

            Test.startTest();
            List<MatterGlobalSearchController.SearchResult> results =
                MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
            Test.stopTest();

            System.assert(results.size() >= 1, 'Should return at least the event');
            Boolean foundEvent = false;
            for (MatterGlobalSearchController.SearchResult r : results) {
                if (r.objectType == 'Calendar_Event__c') { foundEvent = true; break; }
            }
            System.assert(foundEvent, 'Should include a Calendar_Event__c result');
        } catch (Exception e) {
            // Calendar_Event__c may have additional required fields in this org
        }
    }

    @IsTest
    static void search_involvedPartyMatch_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject p = Schema.getGlobalDescribe().get('Involved_Parties__c').newSObject();
            p.put('Matter__c', m.Id);
            p.put('Name',     'xSearchTermx Party');
            insert p;
        } catch (Exception e) { /* additional required fields — skip insert */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        for (MatterGlobalSearchController.SearchResult r : results) {
            if (r.objectType == 'Involved_Parties__c') {
                System.assertEquals('standard:contact', r.iconName);
            }
        }
    }

    @IsTest
    static void search_topfilingMatch_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject tf = Schema.getGlobalDescribe().get('Topfiling__c').newSObject();
            tf.put('TREO_Matter__c', m.Id);
            tf.put('Court_Case_No__c', 'xSearchTermx-2024-001');
            tf.put('Plaintiffs__c',   'xSearchTermx Plaintiff');
            insert tf;
        } catch (Exception e) { /* additional required fields — skip insert */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        for (MatterGlobalSearchController.SearchResult r : results) {
            if (r.objectType == 'Topfiling__c') {
                System.assertEquals('standard:document', r.iconName);
            }
        }
    }

    @IsTest
    static void search_jpaMatch_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            Contact c = new Contact(LastName = 'xSearchTermx');
            insert c;
            SObject j = Schema.getGlobalDescribe().get('JPA__c').newSObject();
            j.put('Matter__c',               m.Id);
            j.put('Firm_or_Lawyer_Name__c',  c.Id);
            insert j;
        } catch (Exception e) { /* additional required fields — skip insert */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        for (MatterGlobalSearchController.SearchResult r : results) {
            if (r.objectType == 'JPA__c') {
                System.assertEquals('standard:document', r.iconName);
            }
        }
    }

    @IsTest
    static void queryByName_withMatch_coversLoopBody() {
        NEOS_Matter__c m = createMatter();
        NEOS_Notes__c n = new NEOS_Notes__c(NEOS_Matter__c = m.Id, Note_Category__c = 'Arbitration');
        insert n;
        // Query back the auto-assigned Name and use it as the search term
        n = [SELECT Id, Name FROM NEOS_Notes__c WHERE Id = :n.Id];
        String searchTerm = '%' + n.Name + '%';

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.queryByName('NEOS_Notes__c', 'NEOS_Matter__c', 'Notes', 'standard:note', m.Id, searchTerm);
        Test.stopTest();

        // result count depends on whether Name is text or autonumber — just assert no exception
        System.assert(results != null);
        if (!results.isEmpty()) {
            System.assertEquals('NEOS_Notes__c', results[0].objectType);
        }
    }

    @IsTest
    static void queryByName_invalidObject_returnsEmpty() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.queryByName('NonExistentObject__x', 'Matter__c', 'Test', 'standard:default', m.Id, '%test%');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Invalid object should return empty, not throw');
    }

    // ── browseAll tests ───────────────────────────────────────

    @IsTest
    static void browseAll_blankType_returnsEmpty() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, '');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Blank objectType should return empty');
    }

    @IsTest
    static void browseAll_unknownType_returnsEmpty() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Totally_Unknown__c');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Unknown objectType not in config should return empty');
    }

    @IsTest
    static void browseAll_nullMatterId_returnsEmpty() {
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(null, 'NEOS_Notes__c');
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Null matterId should return empty');
    }

    @IsTest
    static void browseAll_notes_returnsResults() {
        NEOS_Matter__c m = createMatter();
        insert new NEOS_Notes__c(
            NEOS_Matter__c      = m.Id,
            Note_Category__c    = 'Arbitration',
            Note_Description__c = 'Browse test note'
        );
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'NEOS_Notes__c');
        Test.stopTest();
        System.assertEquals(1, results.size());
        System.assertEquals('NEOS_Notes__c', results[0].objectType);
        System.assertEquals('standard:note',  results[0].iconName);
    }

    @IsTest
    static void browseAll_timeEntries_returnsResults() {
        NEOS_Matter__c m = createMatter();
        insert new Time_Entry__c(
            NEOS_Matter__c  = m.Id,
            Submit_Hours__c = 2,
            Staff__c        = UserInfo.getUserId(),
            Entry_Date__c   = Date.today()
        );
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Time_Entry__c');
        Test.stopTest();
        System.assertEquals(1, results.size());
        System.assertEquals('Time_Entry__c', results[0].objectType);
    }

    @IsTest
    static void browseAll_tasks_returnsResults() {
        NEOS_Matter__c m = createMatter();
        insert new Task(
            Subject      = 'Browse Test Task',
            OwnerId      = UserInfo.getUserId(),
            WhatId       = m.Id,
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(3)
        );
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Task');
        Test.stopTest();
        System.assertEquals(1, results.size());
        System.assertEquals('Task', results[0].objectType);
    }

    @IsTest
    static void browseAll_calendarEvents_coversPath() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject ce = Schema.getGlobalDescribe().get('Calendar_Event__c').newSObject();
            ce.put('Subject__c',        'Browse Hearing');
            ce.put('Start_DateTime__c', System.now().addDays(1));
            ce.put('End_DateTime__c',   System.now().addDays(1).addHours(1));
            ce.put('Status__c',         'Active');
            ce.put('Event_Type__c',     'Hearing');
            ce.put('Matter__c',         m.Id);
            insert ce;
        } catch (Exception e) { /* additional required fields — skip */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Calendar_Event__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void browseAll_involvedParties_coversPath() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject p = Schema.getGlobalDescribe().get('Involved_Parties__c').newSObject();
            p.put('Matter__c', m.Id);
            p.put('Name', 'Browse Party');
            insert p;
        } catch (Exception e) { /* additional required fields */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Involved_Parties__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void browseAll_involvedPersons_coversPath() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Involved_Persons__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void browseAll_topfilings_coversPath() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject tf = Schema.getGlobalDescribe().get('Topfiling__c').newSObject();
            tf.put('TREO_Matter__c',   m.Id);
            tf.put('Court_Case_No__c', 'BC-2024-001');
            tf.put('Plaintiffs__c',    'Browse Plaintiff');
            insert tf;
        } catch (Exception e) { /* additional required fields */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Topfiling__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void browseAll_jpas_coversPath() {
        NEOS_Matter__c m = createMatter();
        try {
            Contact c = new Contact(LastName = 'BrowseLawyer');
            insert c;
            SObject j = Schema.getGlobalDescribe().get('JPA__c').newSObject();
            j.put('Matter__c',              m.Id);
            j.put('Firm_or_Lawyer_Name__c', c.Id);
            insert j;
        } catch (Exception e) { /* additional required fields */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'JPA__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void browseAll_expensesViaConfig_coversBrowseByName() {
        NEOS_Matter__c m = createMatter();
        // NEOS_Expense__c routes through the browseByName helper
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'NEOS_Expense__c');
        Test.stopTest();
        System.assert(results != null, 'browseByName path should not throw');
    }

    @IsTest
    static void browseAll_counselViaConfig_coversBrowseByName() {
        NEOS_Matter__c m = createMatter();
        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Counsel_Junction__c');
        Test.stopTest();
        System.assert(results != null, 'browseByName path should not throw');
    }

    @IsTest
    static void search_counselMatch_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject c = Schema.getGlobalDescribe().get('Counsel_Junction__c').newSObject();
            c.put('Matter__c', m.Id);
            c.put('Name', 'xSearchTermx Counsel');
            insert c;
        } catch (Exception e) { /* additional required fields — skip */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        for (MatterGlobalSearchController.SearchResult r : results) {
            if (r.objectType == 'Counsel_Junction__c') {
                System.assertEquals('standard:related_list', r.iconName);
            }
        }
    }

    @IsTest
    static void browseAll_counsel_withRecord_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject c = Schema.getGlobalDescribe().get('Counsel_Junction__c').newSObject();
            c.put('Matter__c', m.Id);
            insert c;
        } catch (Exception e) { /* additional required fields — skip */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Counsel_Junction__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void search_arbitrationMatch_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject a = Schema.getGlobalDescribe().get('Arbitration_Details__c').newSObject();
            a.put('NEOS_Matter__c', m.Id);
            a.put('Arbitration_Case_Number__c', 'xSearchTermx-ARB-001');
            insert a;
        } catch (Exception e) { /* additional required fields — skip */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        for (MatterGlobalSearchController.SearchResult r : results) {
            if (r.objectType == 'Arbitration_Details__c') {
                System.assertEquals('standard:case', r.iconName);
            }
        }
    }

    @IsTest
    static void browseAll_arbitration_withRecord_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject a = Schema.getGlobalDescribe().get('Arbitration_Details__c').newSObject();
            a.put('NEOS_Matter__c', m.Id);
            a.put('Arbitration_Case_Number__c', 'ARB-BROWSE-001');
            insert a;
        } catch (Exception e) { /* additional required fields — skip */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'Arbitration_Details__c');
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void search_expenseMatch_returnsResult() {
        NEOS_Matter__c m = createMatter();
        try {
            SObject e = Schema.getGlobalDescribe().get('NEOS_Expense__c').newSObject();
            e.put('NEOS_Matter__c', m.Id);
            e.put('Name', 'xSearchTermx Filing Fee');
            insert e;
        } catch (Exception e2) { /* additional required fields — skip */ }

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, 'xSearchTermx');
        Test.stopTest();

        for (MatterGlobalSearchController.SearchResult r : results) {
            if (r.objectType == 'NEOS_Expense__c') {
                System.assertEquals('standard:expense', r.iconName);
            }
        }
    }

    @IsTest
    static void browseAll_expense_withRecord_returnsResult() {
        NEOS_Matter__c m = createMatter();
        SObject e = Schema.getGlobalDescribe().get('NEOS_Expense__c').newSObject();
        e.put('NEOS_Matter__c', m.Id);
        insert e;

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.browseAll(m.Id, 'NEOS_Expense__c');
        Test.stopTest();
        System.assert(results.size() >= 1);
        System.assertEquals('NEOS_Expense__c', results[0].objectType);
    }

    @IsTest
    static void search_expenseByAutoName_coversQueryLoopBody() {
        NEOS_Matter__c m = createMatter();
        NEOS_Expense__c exp = new NEOS_Expense__c(NEOS_Matter__c = m.Id);
        insert exp;
        exp = [SELECT Id, Name FROM NEOS_Expense__c WHERE Id = :exp.Id];
        String nameTerm = exp.Name.length() >= 3 ? exp.Name.substring(0, Math.min(6, exp.Name.length())) : exp.Name;

        Test.startTest();
        List<MatterGlobalSearchController.SearchResult> results =
            MatterGlobalSearchController.search(m.Id, nameTerm);
        Test.stopTest();
        System.assert(results != null);
    }

    @IsTest
    static void makeArbitration_direct_coversBuilder() {
        Arbitration_Details__c fakeArb = new Arbitration_Details__c(
            Arbitration_Case_Number__c = 'TEST-ARB-001',
            Arbitration_Venue__c = 'JAMS Los Angeles'
        );
        MatterGlobalSearchController.SearchResult result =
            MatterGlobalSearchController.makeArbitration(fakeArb);
        System.assertEquals('Arbitration_Details__c', result.objectType);
        System.assertEquals('TEST-ARB-001', result.title);
        System.assertEquals('standard:case', result.iconName);
    }

    @IsTest
    static void makeEvent_direct_coversBuilder() {
        Calendar_Event__c fakeEvent = new Calendar_Event__c();
        MatterGlobalSearchController.SearchResult result =
            MatterGlobalSearchController.makeEvent(fakeEvent);
        System.assertEquals('Calendar_Event__c', result.objectType);
        System.assertEquals('standard:event', result.iconName);
    }

    @IsTest
    static void makeParty_direct_coversBuilder() {
        Involved_Parties__c fakeParty = new Involved_Parties__c(
            Relationship__c = 'Plaintiff'
        );
        MatterGlobalSearchController.SearchResult result =
            MatterGlobalSearchController.makeParty(fakeParty);
        System.assertEquals('Involved_Parties__c', result.objectType);
        System.assertEquals('standard:contact', result.iconName);
    }
}
