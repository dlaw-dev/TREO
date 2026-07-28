@IsTest
private class SubtaskTemplateApplierTest {

    @IsTest
    static void testApply_preCreatesAllStepsWithFirstOpenAndRestWaiting() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Test Template');
        insert template;

        Subtask_Template_Item__c stepOne = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Step One',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );
        insert stepOne;

        insert new Subtask_Template_Item__c(
            Subtask_Template__c        = template.Id,
            Sequence_Order__c          = 2,
            Subject__c                 = 'Step Two (Master)',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'Senior_Attorney__c',
            Depends_On_Step__c         = stepOne.Id
        );

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
    static void testApply_laterStepDynamicFieldAlreadySet_resolvesRealOwnerWhileWaiting() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        User paralegal = [SELECT Id FROM User WHERE Id != :staticAssignee.Id AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Test Template');
        insert template;

        Subtask_Template_Item__c stepOne = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Step One',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );
        insert stepOne;

        insert new Subtask_Template_Item__c(
            Subtask_Template__c        = template.Id,
            Sequence_Order__c          = 2,
            Subject__c                 = 'Step Two (Master)',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'LSS_Paralegal__c',
            Depends_On_Step__c         = stepOne.Id
        );

        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Case',
            LSS_Paralegal__c = paralegal.Id
        );
        insert matter;

        Test.startTest();
        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);
        Test.stopTest();

        Task master = [SELECT Status, OwnerId FROM Task WHERE Id = :masterId];
        System.assertEquals('Waiting', master.Status);
        System.assertEquals(
            paralegal.Id,
            master.OwnerId,
            'A Waiting step whose dynamic field is already set on the Matter should show its real eventual assignee, not the template applier.'
        );
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
    static void testApply_throwsWhenNoStepHasAStartingPoint() {
        Subtask_Template__c template = new Subtask_Template__c(Name = 'Misconfigured Template');
        insert template;

        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template_Item__c stepOne = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Step One',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );
        insert stepOne;

        // Make Step One depend on itself - contrived, but guarantees every
        // item in the template has a non-null Depends_On_Step__c, which is
        // the actual condition being tested (no entry point at all).
        stepOne.Depends_On_Step__c = stepOne.Id;
        update stepOne;

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Boolean threw = false;
        Test.startTest();
        try {
            SubtaskTemplateApplier.apply(template.Id, matter.Id);
        } catch (SubtaskTemplateApplier.SubtaskTemplateApplierException e) {
            threw = true;
            System.assert(e.getMessage().contains('no starting step'));
        }
        Test.stopTest();

        System.assert(threw, 'Expected an exception when no step in the template has a null Depends_On_Step__c.');
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

    @IsTest
    static void testApply_branchingTemplate_bothEntryStepsOpenTogether() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        User paralegal = [SELECT Id FROM User WHERE Id != :staticAssignee.Id AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Branching Template');
        insert template;

        // Two entry steps (no Depends_On_Step__c) - both should open at
        // once. The third (master, by sequence) depends on the first.
        Subtask_Template_Item__c stepOne = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Entry Step A',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );
        Subtask_Template_Item__c stepTwo = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 2,
            Subject__c          = 'Entry Step B',
            Assignee_Type__c    = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c = 'LSS_Paralegal__c'
        );
        insert new List<Subtask_Template_Item__c>{ stepOne, stepTwo };

        insert new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 3,
            Subject__c          = 'Dependent Step (Master)',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id,
            Depends_On_Step__c  = stepOne.Id
        );

        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter', Case_Title__c = 'Test Case', LSS_Paralegal__c = paralegal.Id
        );
        insert matter;

        Test.startTest();
        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);
        Test.stopTest();

        Task entryA = [SELECT Status, OwnerId FROM Task WHERE Subject = 'Entry Step A'];
        Task entryB = [SELECT Status, OwnerId FROM Task WHERE Subject = 'Entry Step B'];
        Task dependent = [SELECT Id, Status FROM Task WHERE Id = :masterId];

        System.assertEquals('Open', entryA.Status, 'Both entry steps should open together.');
        System.assertEquals('Open', entryB.Status, 'Both entry steps should open together.');
        System.assertEquals(staticAssignee.Id, entryA.OwnerId);
        System.assertEquals(paralegal.Id, entryB.OwnerId);
        System.assertEquals('Waiting', dependent.Status, 'A step depending on only one of the two entry steps stays Waiting.');
    }
}
