@IsTest
private class SubtaskTemplateApplierTest {

    @IsTest
    static void testApply_preCreatesAllStepsWithFirstOpenAndRestWaiting() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Test Template');
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
                Subject__c                 = 'Step Two (Master)',
                Assignee_Type__c           = 'Dynamic Matter Field',
                Dynamic_Assignee_Field__c  = 'Senior_Attorney__c'
            )
        };

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Test.startTest();
        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);
        Test.stopTest();

        List<Task> tasks = [
            SELECT Id, Subject, Status, OwnerId, Parent_Task__c, ActivityDate
            FROM Task
            WHERE NEOS_Matter__c = :matter.Id
            ORDER BY Subject ASC
        ];

        System.assertEquals(2, tasks.size());

        Task master = [SELECT Id, Status, Parent_Task__c FROM Task WHERE Id = :masterId];
        System.assertEquals('Waiting', master.Status);
        System.assertEquals(masterId, master.Parent_Task__c);

        Task firstTask = [
            SELECT Status, OwnerId, ActivityDate, Parent_Task__c
            FROM Task
            WHERE Subject = 'Step One'
        ];
        System.assertEquals('Open', firstTask.Status);
        System.assertEquals(staticAssignee.Id, firstTask.OwnerId);
        System.assertEquals(Date.today().addDays(7), firstTask.ActivityDate);
        System.assertEquals(masterId, firstTask.Parent_Task__c);
    }

    @IsTest
    static void testApply_throwsWhenTemplateHasNoSteps() {
        Subtask_Template__c emptyTemplate = new Subtask_Template__c(Name = 'Empty Template');
        insert emptyTemplate;

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Boolean threw = false;
        Test.startTest();
        try {
            SubtaskTemplateApplier.apply(emptyTemplate.Id, matter.Id);
        } catch (SubtaskTemplateApplier.SubtaskTemplateApplierException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'Expected an exception when applying a template with no steps.');
    }

    @IsTest
    static void testApply_singleStepTemplate_activatesImmediately() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Single Step Template');
        insert template;

        insert new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Only Step',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Test.startTest();
        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);
        Test.stopTest();

        Task master = [SELECT Status, OwnerId, Parent_Task__c FROM Task WHERE Id = :masterId];
        System.assertEquals('Open', master.Status);
        System.assertEquals(staticAssignee.Id, master.OwnerId);
        System.assertEquals(masterId, master.Parent_Task__c);
    }
}
