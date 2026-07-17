@IsTest
private class SubtaskAssigneeResolverTest {

    @IsTest
    static void testResolveAssignee_staticUser_returnsConfiguredUser() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Assignee_Type__c   = 'Static User',
            Static_Assignee__c = staticAssignee.Id
        );

        Test.startTest();
        Id result = SubtaskAssigneeResolver.resolveAssignee(item, null);
        Test.stopTest();

        System.assertEquals(staticAssignee.Id, result);
    }

    @IsTest
    static void testResolveAssignee_dynamicField_readsPopulatedMatterField() {
        User seniorAttorney = [
            SELECT Id FROM User
            WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true
            LIMIT 1
        ];

        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Case',
            Senior_Attorney__c = seniorAttorney.Id
        );
        insert matter;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Assignee_Type__c          = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c = 'Senior_Attorney__c'
        );

        Test.startTest();
        Id result = SubtaskAssigneeResolver.resolveAssignee(item, matter.Id);
        Test.stopTest();

        System.assertEquals(seniorAttorney.Id, result);
    }

    @IsTest
    static void testResolveAssignee_dynamicField_returnsNullWhenFieldNotSet() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Assignee_Type__c          = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c = 'Senior_Attorney__c'
        );

        Test.startTest();
        Id result = SubtaskAssigneeResolver.resolveAssignee(item, matter.Id);
        Test.stopTest();

        System.assertEquals(null, result);
    }

    @IsTest
    static void testResolveAssignee_unknownFieldName_returnsNullSafely() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Assignee_Type__c          = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c = 'Not_A_Real_Field__c'
        );

        Test.startTest();
        Id result = SubtaskAssigneeResolver.resolveAssignee(item, matter.Id);
        Test.stopTest();

        System.assertEquals(null, result);
    }

    @IsTest
    static void testResolveAssigneesBulk_resolvesManyPairsWithBoundedQueryCount() {
        User seniorAttorney = [SELECT Id FROM User WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true LIMIT 1];
        User associateAttorney = [SELECT Id FROM User WHERE UserRole.Name = 'Associate Attorney' AND IsActive = true LIMIT 1];
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        List<NEOS_Matter__c> matters = new List<NEOS_Matter__c>();
        for (Integer i = 0; i < 5; i++) {
            matters.add(new NEOS_Matter__c(
                Name = 'Bulk Test Matter ' + i,
                Case_Title__c = 'Bulk Test Case ' + i,
                Senior_Attorney__c = seniorAttorney.Id,
                Associate_Attorney__c = associateAttorney.Id
            ));
        }
        insert matters;

        // Real Ids to use as caller-defined correlation keys, mirroring how
        // real callers key by Task Id.
        List<Task> keyTasks = new List<Task>();
        for (Integer i = 0; i < matters.size(); i++) {
            keyTasks.add(new Task(Subject = 'Key Task ' + i, Status = 'Waiting'));
        }
        keyTasks.add(new Task(Subject = 'Static Key Task', Status = 'Waiting'));
        insert keyTasks;

        Map<Id, Subtask_Template_Item__c> keyToItem = new Map<Id, Subtask_Template_Item__c>();
        Map<Id, Id> keyToMatterId = new Map<Id, Id>();

        for (Integer i = 0; i < matters.size(); i++) {
            keyToItem.put(keyTasks[i].Id, new Subtask_Template_Item__c(
                Assignee_Type__c          = 'Dynamic Matter Field',
                Dynamic_Assignee_Field__c = Math.mod(i, 2) == 0 ? 'Senior_Attorney__c' : 'Associate_Attorney__c'
            ));
            keyToMatterId.put(keyTasks[i].Id, matters[i].Id);
        }

        Id staticKey = keyTasks[keyTasks.size() - 1].Id;
        keyToItem.put(staticKey, new Subtask_Template_Item__c(
            Assignee_Type__c   = 'Static User',
            Static_Assignee__c = staticAssignee.Id
        ));
        keyToMatterId.put(staticKey, null);

        Test.startTest();
        Integer queriesBefore = Limits.getQueries();
        Map<Id, Id> results = SubtaskAssigneeResolver.resolveAssigneesBulk(keyToItem, keyToMatterId);
        Integer queriesUsed = Limits.getQueries() - queriesBefore;
        Test.stopTest();

        System.assert(queriesUsed <= 3,
            'Expected a small, bounded query count regardless of pair count, got ' + queriesUsed);

        for (Integer i = 0; i < matters.size(); i++) {
            Id expected = Math.mod(i, 2) == 0 ? seniorAttorney.Id : associateAttorney.Id;
            System.assertEquals(expected, results.get(keyTasks[i].Id));
        }
        System.assertEquals(staticAssignee.Id, results.get(staticKey));
    }
}
