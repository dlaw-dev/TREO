@IsTest
private class TaskTriggerActionsTest {

    private static Subtask_Template__c buildSeniorToAssociateTemplate() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Test Attorney Assignment');
        insert template;

        insert new List<Subtask_Template_Item__c>{
            new Subtask_Template_Item__c(
                Subtask_Template__c = template.Id,
                Sequence_Order__c   = 1,
                Subject__c          = 'Assign Senior Attorney',
                Assignee_Type__c    = 'Static User',
                Static_Assignee__c  = staticAssignee.Id
            ),
            new Subtask_Template_Item__c(
                Subtask_Template__c        = template.Id,
                Sequence_Order__c          = 2,
                Subject__c                 = 'Assign Associate Attorney',
                Assignee_Type__c           = 'Dynamic Matter Field',
                Dynamic_Assignee_Field__c  = 'Senior_Attorney__c'
            )
        };

        return template;
    }

    private static NEOS_Matter__c createMatter() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;
        return matter;
    }

    @IsTest
    static void testSafetyRail_blocksCompletionWhenNextStepDynamicFieldMissing() {
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        NEOS_Matter__c matter = createMatter();

        Test.startTest();
        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);
        Test.stopTest();

        Task firstTask = [
            SELECT Id, Status FROM Task
            WHERE Parent_Task__c = :masterId AND Id != :masterId
            LIMIT 1
        ];

        firstTask.Status = 'Completed';

        Boolean threw = false;
        try {
            update firstTask;
        } catch (DmlException e) {
            threw = true;
            System.assert(e.getMessage().contains('Senior_Attorney__c'));
        }

        System.assert(threw, 'Expected completion to be blocked when the Matter\'s Senior_Attorney__c is not set.');

        Task reloaded = [SELECT Status FROM Task WHERE Id = :firstTask.Id];
        System.assertEquals('Open', reloaded.Status);
    }

    @IsTest
    static void testChainAdvances_whenNextStepDynamicFieldIsSet() {
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        NEOS_Matter__c matter = createMatter();

        User seniorAttorney = [
            SELECT Id FROM User
            WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true
            LIMIT 1
        ];

        Test.startTest();
        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);
        Test.stopTest();

        matter.Senior_Attorney__c = seniorAttorney.Id;
        update matter;

        Task firstTask = [
            SELECT Id, Status FROM Task
            WHERE Parent_Task__c = :masterId AND Id != :masterId
            LIMIT 1
        ];
        firstTask.Status = 'Completed';
        update firstTask;

        Task master = [SELECT Id, Status, OwnerId, ActivityDate FROM Task WHERE Id = :masterId];
        System.assertEquals('Open', master.Status);
        System.assertEquals(seniorAttorney.Id, master.OwnerId);
        System.assertEquals(Date.today().addDays(7), master.ActivityDate);
    }

    @IsTest
    static void testManualTask_unaffectedByChainLogic() {
        Task manualTask = new Task(Subject = 'Just a regular task', Status = 'Open');
        insert manualTask;

        Test.startTest();
        manualTask.Status = 'Completed';
        update manualTask;
        Test.stopTest();

        Task reloaded = [SELECT Status FROM Task WHERE Id = :manualTask.Id];
        System.assertEquals('Completed', reloaded.Status);
    }
}
