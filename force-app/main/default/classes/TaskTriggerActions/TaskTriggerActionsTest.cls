@IsTest
private class TaskTriggerActionsTest {

    private static Subtask_Template__c buildSeniorToAssociateTemplate() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Test Attorney Assignment');
        insert template;

        Subtask_Template_Item__c stepOne = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Assign Senior Attorney',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );
        insert stepOne;

        insert new Subtask_Template_Item__c(
            Subtask_Template__c        = template.Id,
            Sequence_Order__c          = 2,
            Subject__c                 = 'Assign Associate Attorney',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'Senior_Attorney__c',
            Depends_On_Step__c         = stepOne.Id
        );

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

    @IsTest
    static void testChainAdvances_bulkCompletionAcrossManyChains_staysWithinQueryLimits() {
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        User seniorAttorney = [
            SELECT Id FROM User
            WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true
            LIMIT 1
        ];

        Integer chainCount = 5;
        List<Id> masterIds = new List<Id>();

        for (Integer i = 0; i < chainCount; i++) {
            NEOS_Matter__c matter = new NEOS_Matter__c(
                Name = 'Bulk Chain Matter ' + i,
                Case_Title__c = 'Bulk Chain Case ' + i,
                Senior_Attorney__c = seniorAttorney.Id
            );
            insert matter;
            masterIds.add(SubtaskTemplateApplier.apply(template.Id, matter.Id));
        }

        Set<Id> masterIdSet = new Set<Id>(masterIds);
        List<Task> firstTasks = new List<Task>();

        for (Task t : [SELECT Id, Status, Parent_Task__c FROM Task WHERE Parent_Task__c IN :masterIds]) {
            if (!masterIdSet.contains(t.Id)) {
                firstTasks.add(t);
            }
        }
        System.assertEquals(chainCount, firstTasks.size());

        for (Task t : firstTasks) {
            t.Status = 'Completed';
        }

        Test.startTest();
        Integer queriesBefore = Limits.getQueries();
        update firstTasks;
        Integer queriesUsed = Limits.getQueries() - queriesBefore;
        Test.stopTest();

        System.assert(queriesUsed < chainCount * 3,
            'Expected query count independent of chain count (bulkified), got ' + queriesUsed
            + ' for ' + chainCount + ' chains completing at once.');

        List<Task> masters = [SELECT Id, Status, OwnerId FROM Task WHERE Id IN :masterIds];
        for (Task master : masters) {
            System.assertEquals('Open', master.Status);
            System.assertEquals(seniorAttorney.Id, master.OwnerId);
        }
    }

    @IsTest
    static void testAdvanceChain_reCompletingEarlierStep_doesNotRegressAlreadyCompletedMaster() {
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        NEOS_Matter__c matter = createMatter();

        User seniorAttorney = [
            SELECT Id FROM User
            WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true
            LIMIT 1
        ];
        matter.Senior_Attorney__c = seniorAttorney.Id;
        update matter;

        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Task firstTask = [
            SELECT Id, Status FROM Task
            WHERE Parent_Task__c = :masterId AND Id != :masterId
            LIMIT 1
        ];
        firstTask.Status = 'Completed';
        update firstTask;

        // Complete the master too - the whole chain is now fully done.
        Task master = [SELECT Id, Status, OwnerId, ActivityDate FROM Task WHERE Id = :masterId];
        master.Status = 'Completed';
        update master;

        // Reopen and re-complete the first step - this must NOT regress the
        // already-completed master back to Waiting/Open.
        firstTask.Status = 'Open';
        update firstTask;

        Test.startTest();
        firstTask.Status = 'Completed';
        update firstTask;
        Test.stopTest();

        Task masterReloaded = [SELECT Id, Status, OwnerId, ActivityDate FROM Task WHERE Id = :masterId];
        System.assertEquals('Completed', masterReloaded.Status);
        System.assertEquals(master.OwnerId, masterReloaded.OwnerId);
        System.assertEquals(master.ActivityDate, masterReloaded.ActivityDate);
    }

    @IsTest
    static void testChainAdvances_respectsManualReassignment_doesNotOverwriteOwner() {
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        NEOS_Matter__c matter = createMatter();

        User seniorAttorney = [
            SELECT Id FROM User
            WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true
            LIMIT 1
        ];
        matter.Senior_Attorney__c = seniorAttorney.Id;
        update matter;

        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
        User manualOverrideUser = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'ManualOverride',
            Email = 'manualoverride@test.example',
            Username = 'manualoverride+' + System.now().getTime() + '@test.example',
            Alias = 'manover',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert manualOverrideUser;

        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Task firstTask = [
            SELECT Id, Status FROM Task
            WHERE Parent_Task__c = :masterId AND Id != :masterId
            LIMIT 1
        ];

        // Manually reassign the not-yet-active master step (mirrors what
        // TaskUiController.updateTask does when Edit/Reassign is used on a
        // Waiting chain step) before its predecessor ever completes.
        Task master = [SELECT Id, OwnerId, Manually_Reassigned__c FROM Task WHERE Id = :masterId];
        master.OwnerId = manualOverrideUser.Id;
        master.Manually_Reassigned__c = true;
        update master;

        Test.startTest();
        firstTask.Status = 'Completed';
        update firstTask;
        Test.stopTest();

        Task masterReloaded = [SELECT Status, OwnerId FROM Task WHERE Id = :masterId];
        System.assertEquals('Open', masterReloaded.Status);
        System.assertEquals(manualOverrideUser.Id, masterReloaded.OwnerId,
            'A manually reassigned Waiting step should keep its manually-set owner instead of being overwritten by dynamic resolution.');
    }

    @IsTest
    static void testValidator_manuallyReassignedStep_doesNotBlockPredecessorCompletion_evenWithFieldUnset() {
        // Deliberately do NOT set matter.Senior_Attorney__c - the whole
        // point is proving completion isn't blocked on it once the
        // dependent step has already been manually reassigned to a real
        // owner and no longer needs that field resolved at all.
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        NEOS_Matter__c matter = createMatter();

        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
        User manualOverrideUser = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'ManualOverrideNoField',
            Email = 'manualoverridenofield@test.example',
            Username = 'manualoverridenofield+' + System.now().getTime() + '@test.example',
            Alias = 'manover2',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert manualOverrideUser;

        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Task firstTask = [
            SELECT Id, Status FROM Task
            WHERE Parent_Task__c = :masterId AND Id != :masterId
            LIMIT 1
        ];

        Task master = [SELECT Id, OwnerId, Manually_Reassigned__c FROM Task WHERE Id = :masterId];
        master.OwnerId = manualOverrideUser.Id;
        master.Manually_Reassigned__c = true;
        update master;

        Test.startTest();
        firstTask.Status = 'Completed';
        update firstTask;
        Test.stopTest();

        Task firstTaskReloaded = [SELECT Status FROM Task WHERE Id = :firstTask.Id];
        System.assertEquals('Completed', firstTaskReloaded.Status,
            'Completing the predecessor must not be blocked just because the Matter field behind a manually reassigned dependent is unset.');

        Task masterReloaded = [SELECT Status, OwnerId FROM Task WHERE Id = :masterId];
        System.assertEquals('Open', masterReloaded.Status);
        System.assertEquals(manualOverrideUser.Id, masterReloaded.OwnerId);
    }

    @IsTest
    static void testAdHocWaitingTask_activatesWhenBlockerCompletes() {
        Task blocker = new Task(Subject = 'Blocker Task', Status = 'Open');
        insert blocker;

        Task dependent = new Task(
            Subject = 'Dependent Task',
            Status = 'Waiting',
            Waiting_On_Task__c = blocker.Id
        );
        insert dependent;

        Test.startTest();
        blocker.Status = 'Completed';
        update blocker;
        Test.stopTest();

        Task reloaded = [SELECT Status FROM Task WHERE Id = :dependent.Id];
        System.assertEquals('Open', reloaded.Status);
    }

    @IsTest
    static void testAdHocWaitingTask_unrelatedWaitingTaskUnaffected() {
        Task blocker = new Task(Subject = 'Blocker Task', Status = 'Open');
        insert blocker;

        Task unrelatedWaiting = new Task(Subject = 'Unrelated Waiting Task', Status = 'Waiting');
        insert unrelatedWaiting;

        Test.startTest();
        blocker.Status = 'Completed';
        update blocker;
        Test.stopTest();

        Task reloaded = [SELECT Status FROM Task WHERE Id = :unrelatedWaiting.Id];
        System.assertEquals('Waiting', reloaded.Status);
    }

    /* =========================================================
       Branching chains
    ========================================================== */

    private static Subtask_Template__c buildBranchingTemplate() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        // 1 -> (2 and 3 together) ; 2 depends on 1, 3 depends on 1, master(4) depends on 2 only.
        Subtask_Template__c template = new Subtask_Template__c(Name = 'Test Branching Template');
        insert template;

        Subtask_Template_Item__c stepOne = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'Step One',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id
        );
        insert stepOne;

        List<Subtask_Template_Item__c> dependents = new List<Subtask_Template_Item__c>{
            new Subtask_Template_Item__c(
                Subtask_Template__c = template.Id,
                Sequence_Order__c   = 2,
                Subject__c          = 'Step Two',
                Assignee_Type__c    = 'Static User',
                Static_Assignee__c  = staticAssignee.Id,
                Depends_On_Step__c  = stepOne.Id
            ),
            new Subtask_Template_Item__c(
                Subtask_Template__c = template.Id,
                Sequence_Order__c   = 3,
                Subject__c          = 'Step Three (side quest)',
                Assignee_Type__c    = 'Static User',
                Static_Assignee__c  = staticAssignee.Id,
                Depends_On_Step__c  = stepOne.Id
            )
        };
        insert dependents;

        insert new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 4,
            Subject__c          = 'Step Four (Master)',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = staticAssignee.Id,
            Depends_On_Step__c  = dependents[0].Id
        );

        return template;
    }

    @IsTest
    static void testChainAdvances_completingOneStepActivatesBothDependentsAtOnce() {
        Subtask_Template__c template = buildBranchingTemplate();
        NEOS_Matter__c matter = createMatter();

        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Task stepOne = [SELECT Id, Status FROM Task WHERE Subject = 'Step One' AND Parent_Task__c = :masterId];
        System.assertEquals('Open', stepOne.Status);

        Test.startTest();
        stepOne.Status = 'Completed';
        update stepOne;
        Test.stopTest();

        Task stepTwo = [SELECT Status FROM Task WHERE Subject = 'Step Two' AND Parent_Task__c = :masterId];
        Task stepThree = [SELECT Status FROM Task WHERE Subject = 'Step Three (side quest)' AND Parent_Task__c = :masterId];

        System.assertEquals('Open', stepTwo.Status, 'Completing the shared dependency should activate both dependents at once.');
        System.assertEquals('Open', stepThree.Status, 'Completing the shared dependency should activate both dependents at once.');
    }

    @IsTest
    static void testCompleteTask_completingOneLeafBranchAloneDoesNotCompleteWholeChain() {
        Subtask_Template__c template = buildBranchingTemplate();
        NEOS_Matter__c matter = createMatter();

        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Task stepOne = [SELECT Id, Status FROM Task WHERE Subject = 'Step One' AND Parent_Task__c = :masterId];
        stepOne.Status = 'Completed';
        update stepOne;

        Task stepThree = [SELECT Id FROM Task WHERE Subject = 'Step Three (side quest)' AND Parent_Task__c = :masterId];

        Test.startTest();
        Boolean chainCompleteAfterOneLeaf = TaskUiController.completeTask(stepThree.Id);
        Test.stopTest();

        System.assertEquals(false, chainCompleteAfterOneLeaf,
            'Completing only the side-quest leaf must not report the whole (multi-branch) chain as complete.');

        Task stepTwo = [SELECT Id FROM Task WHERE Subject = 'Step Two' AND Parent_Task__c = :masterId];
        Task master = [SELECT Id FROM Task WHERE Id = :masterId];

        Boolean chainCompleteAfterStepTwo = TaskUiController.completeTask(stepTwo.Id);
        System.assertEquals(false, chainCompleteAfterStepTwo, 'Master step is still open - chain is not yet complete.');

        Boolean chainCompleteAfterMaster = TaskUiController.completeTask(master.Id);
        System.assertEquals(true, chainCompleteAfterMaster, 'Every branch is now complete - the chain should report complete.');
    }

    /* =========================================================
       Reviewer redirect (universal, trigger-enforced)
    ========================================================== */

    @IsTest
    static void testManualCompletion_withReviewerSet_redirectsToPendingReview() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        User reviewer = [SELECT Id FROM User WHERE IsActive = true AND Id != :owner.Id LIMIT 1];

        Task t = new Task(Subject = 'Manually Completed', Status = 'Open', OwnerId = owner.Id, Reviewer__c = reviewer.Id);
        insert t;

        Test.startTest();
        t.Status = 'Completed';
        update t;
        Test.stopTest();

        Task reloaded = [SELECT Status FROM Task WHERE Id = :t.Id];
        System.assertEquals('Pending Review', reloaded.Status,
            'Any path that marks a reviewed task Completed - not just the custom Mark Done button - should redirect to Pending Review.');
    }

    @IsTest
    static void testApprovalTransition_fromPendingReviewToCompleted_isNotReRedirected() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        User reviewer = [SELECT Id FROM User WHERE IsActive = true AND Id != :owner.Id LIMIT 1];

        Task t = new Task(Subject = 'Awaiting Approval', Status = 'Pending Review', OwnerId = owner.Id, Reviewer__c = reviewer.Id);
        insert t;

        Test.startTest();
        t.Status = 'Completed';
        update t;
        Test.stopTest();

        Task reloaded = [SELECT Status FROM Task WHERE Id = :t.Id];
        System.assertEquals('Completed', reloaded.Status,
            'A task actually being approved out of Pending Review must not be redirected back into review.');
    }

    @IsTest
    static void testChainStepWithReviewer_dependentDoesNotActivateUntilApproved() {
        Subtask_Template__c template = buildSeniorToAssociateTemplate();
        NEOS_Matter__c matter = createMatter();

        User seniorAttorney = [
            SELECT Id FROM User
            WHERE UserRole.Name = 'Senior Counsel' AND IsActive = true
            LIMIT 1
        ];
        matter.Senior_Attorney__c = seniorAttorney.Id;
        update matter;

        User reviewer = [SELECT Id FROM User WHERE IsActive = true AND Id != :seniorAttorney.Id LIMIT 1];

        Id masterId = SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Task firstTask = [
            SELECT Id, Status FROM Task
            WHERE Parent_Task__c = :masterId AND Id != :masterId
            LIMIT 1
        ];
        firstTask.Reviewer__c = reviewer.Id;
        update firstTask;

        Test.startTest();
        firstTask.Status = 'Completed';
        update firstTask;
        Test.stopTest();

        Task firstReloaded = [SELECT Status FROM Task WHERE Id = :firstTask.Id];
        System.assertEquals('Pending Review', firstReloaded.Status);

        Task master = [SELECT Status FROM Task WHERE Id = :masterId];
        System.assertEquals('Waiting', master.Status,
            'The dependent step must not activate while its predecessor is only Pending Review, not actually Completed.');

        // Simulate approval - the dependent should now activate.
        firstTask.Status = 'Completed';
        update firstTask;

        Task masterAfterApproval = [SELECT Status FROM Task WHERE Id = :masterId];
        System.assertEquals('Open', masterAfterApproval.Status,
            'Once actually approved (Pending Review -> Completed), the dependent step should activate as normal.');
    }
}
