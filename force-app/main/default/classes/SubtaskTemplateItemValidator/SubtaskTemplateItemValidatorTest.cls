@IsTest
private class SubtaskTemplateItemValidatorTest {

    @IsTest
    static void testValidDynamicField_savesWithoutError() {
        Subtask_Template__c template = new Subtask_Template__c(Name = 'Validator Test Template');
        insert template;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Subtask_Template__c        = template.Id,
            Sequence_Order__c          = 1,
            Subject__c                 = 'Valid Step',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'Senior_Attorney__c'
        );

        Test.startTest();
        insert item;
        Test.stopTest();

        System.assertNotEquals(null, [SELECT Id FROM Subtask_Template_Item__c WHERE Id = :item.Id].Id);
    }

    @IsTest
    static void testUnknownFieldName_blocksSave() {
        Subtask_Template__c template = new Subtask_Template__c(Name = 'Validator Test Template');
        insert template;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Subtask_Template__c        = template.Id,
            Sequence_Order__c          = 1,
            Subject__c                 = 'Bad Step',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'Not_A_Real_Field__c'
        );

        Boolean threw = false;
        Test.startTest();
        try {
            insert item;
        } catch (DmlException e) {
            threw = true;
            System.assert(e.getMessage().contains('is not a field on the Matter'));
        }
        Test.stopTest();

        System.assert(threw, 'Expected an unknown Dynamic_Assignee_Field__c value to block the save.');
    }

    @IsTest
    static void testNonUserLookupField_blocksSave() {
        Subtask_Template__c template = new Subtask_Template__c(Name = 'Validator Test Template');
        insert template;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Subtask_Template__c        = template.Id,
            Sequence_Order__c          = 1,
            Subject__c                 = 'Bad Step',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'Case_Title__c'
        );

        Boolean threw = false;
        Test.startTest();
        try {
            insert item;
        } catch (DmlException e) {
            threw = true;
            System.assert(e.getMessage().contains('must be a Lookup field to User'));
        }
        Test.stopTest();

        System.assert(threw, 'Expected a non-User-lookup field to block the save.');
    }

    @IsTest
    static void testStaticAssignee_skipsValidationEntirely() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Validator Test Template');
        insert template;

        Subtask_Template_Item__c item = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Static Step',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );

        Test.startTest();
        insert item;
        Test.stopTest();

        System.assertNotEquals(null, [SELECT Id FROM Subtask_Template_Item__c WHERE Id = :item.Id].Id);
    }
}
