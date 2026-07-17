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
}
