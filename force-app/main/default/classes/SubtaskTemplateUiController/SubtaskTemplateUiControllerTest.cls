@IsTest
private class SubtaskTemplateUiControllerTest {

    private static Subtask_Template__c buildTemplate() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'UI Test Template');
        insert template;

        insert new List<Subtask_Template_Item__c>{
            new Subtask_Template_Item__c(
                Subtask_Template__c = template.Id,
                Sequence_Order__c   = 1,
                Subject__c          = 'Step One',
                Assignee_Type__c    = 'Static User',
                Static_Assignee__c  = staticAssignee.Id
            ),
            new Subtask_Template_Item__c(
                Subtask_Template__c        = template.Id,
                Sequence_Order__c          = 2,
                Subject__c                 = 'Step Two',
                Assignee_Type__c           = 'Dynamic Matter Field',
                Dynamic_Assignee_Field__c  = 'Senior_Attorney__c'
            )
        };

        return template;
    }

    @IsTest
    static void testGetTemplates_returnsTemplate() {
        Subtask_Template__c template = buildTemplate();

        Test.startTest();
        List<Subtask_Template__c> results = SubtaskTemplateUiController.getTemplates();
        Test.stopTest();

        Set<Id> ids = new Set<Id>();
        for (Subtask_Template__c t : results) {
            ids.add(t.Id);
        }
        System.assert(ids.contains(template.Id));
    }

    @IsTest
    static void testGetTemplateItems_returnsOrderedSteps() {
        Subtask_Template__c template = buildTemplate();

        Test.startTest();
        List<Subtask_Template_Item__c> items = SubtaskTemplateUiController.getTemplateItems(template.Id);
        Test.stopTest();

        System.assertEquals(2, items.size());
        System.assertEquals('Step One', items[0].Subject__c);
        System.assertEquals('Step Two', items[1].Subject__c);
    }

    @IsTest
    static void testApplyTemplate_createsChain() {
        Subtask_Template__c template = buildTemplate();
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Test.startTest();
        Id masterId = SubtaskTemplateUiController.applyTemplate(template.Id, matter.Id);
        Test.stopTest();

        List<Task> tasks = [SELECT Id FROM Task WHERE NEOS_Matter__c = :matter.Id];
        System.assertEquals(2, tasks.size());
        System.assertNotEquals(null, masterId);
    }

    @IsTest
    static void testApplyTemplate_wrapsApplierExceptionAsAuraHandled() {
        Subtask_Template__c emptyTemplate = new Subtask_Template__c(Name = 'Empty Template');
        insert emptyTemplate;

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Boolean threw = false;
        Test.startTest();
        try {
            SubtaskTemplateUiController.applyTemplate(emptyTemplate.Id, matter.Id);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw);
    }
}
