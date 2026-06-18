@IsTest
private class NeosMatterCustomNotesControllerTest {

    @IsTest
    static void testGetCustomNotes_returnsNotesForMatter() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Matter');
        insert matter;

        NEOS_Notes__c n1 = new NEOS_Notes__c(
            NEOS_Matter__c = matter.Id,
            Note_Title__c = 'Title 1',
            Note_Description__c = 'Desc 1',
            Pinned_Note__c = false
        );

        NEOS_Notes__c n2 = new NEOS_Notes__c(
            NEOS_Matter__c = matter.Id,
            Note_Title__c = 'Title 2',
            Note_Description__c = 'Desc 2',
            Pinned_Note__c = true
        );

        insert new List<NEOS_Notes__c>{ n1, n2 };

        Test.startTest();
        List<NEOS_Notes__c> results = NeosMatterCustomNotesController.getCustomNotes(matter.Id);
        Test.stopTest();

        System.assertNotEquals(null, results, 'Results should not be null');
        System.assertEquals(2, results.size(), 'Should return both notes for the matter');
    }

    @IsTest
    static void testGetPinnedNotes_returnsOnlyPinned() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Pinned Matter', Case_Title__c = 'Pinned Matter');
        insert matter;

        NEOS_Notes__c pinned = new NEOS_Notes__c(
            NEOS_Matter__c = matter.Id,
            Note_Title__c = 'Pinned',
            Pinned_Note__c = true
        );

        NEOS_Notes__c notPinned = new NEOS_Notes__c(
            NEOS_Matter__c = matter.Id,
            Note_Title__c = 'Not pinned',
            Pinned_Note__c = false
        );

        insert new List<NEOS_Notes__c>{ pinned, notPinned };

        Test.startTest();
        List<NEOS_Notes__c> results = NeosMatterCustomNotesController.getPinnedNotes(matter.Id);
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return only pinned notes');
        System.assertEquals(pinned.Id, results[0].Id, 'Should return the pinned note');
    }

    @IsTest
    static void testNullParentId_returnsEmpty() {
        Test.startTest();
        List<NEOS_Notes__c> customNotes = NeosMatterCustomNotesController.getCustomNotes(null);
        List<NEOS_Notes__c> pinnedNotes = NeosMatterCustomNotesController.getPinnedNotes(null);
        Test.stopTest();

        System.assertEquals(0, customNotes.size(), 'Null parentId should return empty list');
        System.assertEquals(0, pinnedNotes.size(), 'Null parentId should return empty list');
    }
}