@IsTest
private class SubtaskChainViewerControllerTest {

    @IsTest
    static void testGetChainsForMatter_groupsStepsByChainInOrder() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Viewer Test Template');
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

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Test.startTest();
        List<SubtaskChainViewerController.ChainDto> chains = SubtaskChainViewerController.getChainsForMatter(matter.Id);
        Test.stopTest();

        System.assertEquals(1, chains.size());
        System.assertEquals('Viewer Test Template', chains[0].templateName);
        System.assertEquals(2, chains[0].steps.size());
        System.assertEquals('Step One', chains[0].steps[0].subject);
        System.assertEquals('Open', chains[0].steps[0].status);
        System.assertEquals('Step Two', chains[0].steps[1].subject);
        System.assertEquals('Waiting', chains[0].steps[1].status);
    }

    @IsTest
    static void testGetChainsForMatter_returnsEmptyWhenNoChains() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Test.startTest();
        List<SubtaskChainViewerController.ChainDto> chains = SubtaskChainViewerController.getChainsForMatter(matter.Id);
        Test.stopTest();

        System.assertEquals(0, chains.size());
    }
}
