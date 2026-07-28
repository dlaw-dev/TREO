@IsTest
private class TaskDueReminderControllerTest {

    @IsTest
    static void testGetMyDueTasks_returnsWithinWindow_excludesOutOfRange() {

        Task overdueTask = new Task(
            Subject      = 'Overdue Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(-2),
            OwnerId      = UserInfo.getUserId()
        );

        Task dueTodayTask = new Task(
            Subject      = 'Due Today Task',
            Status       = 'In Progress',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId()
        );

        Task dueTomorrowTask = new Task(
            Subject      = 'Due Tomorrow Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(1),
            OwnerId      = UserInfo.getUserId()
        );

        Task dueThisWeekTask = new Task(
            Subject      = 'Due This Week Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(5),
            OwnerId      = UserInfo.getUserId()
        );

        Task dueThisMonthTask = new Task(
            Subject      = 'Due This Month Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(20),
            OwnerId      = UserInfo.getUserId()
        );

        Task dueBeyondWindowTask = new Task(
            Subject      = 'Due Beyond Window Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(35),
            OwnerId      = UserInfo.getUserId()
        );

        Task completedOverdueTask = new Task(
            Subject      = 'Completed Overdue Task',
            Status       = 'Completed',
            ActivityDate = Date.today().addDays(-3),
            OwnerId      = UserInfo.getUserId()
        );

        Task noDueDateTask = new Task(
            Subject = 'No Due Date Task',
            Status  = 'Not Started',
            OwnerId = UserInfo.getUserId()
        );

        insert new List<Task>{
            overdueTask, dueTodayTask, dueTomorrowTask, dueThisWeekTask, dueThisMonthTask,
            dueBeyondWindowTask, completedOverdueTask, noDueDateTask
        };

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        System.assertEquals(6, results.size());

        Map<Id, TaskDueReminderController.DueTask> byId =
            new Map<Id, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            byId.put(dt.Id, dt);
        }

        System.assert(byId.containsKey(overdueTask.Id));
        System.assert(byId.containsKey(dueTodayTask.Id));
        System.assert(byId.containsKey(dueTomorrowTask.Id));
        System.assert(byId.containsKey(dueThisWeekTask.Id));
        System.assert(byId.containsKey(dueThisMonthTask.Id));
        System.assert(byId.containsKey(noDueDateTask.Id));
        System.assert(!byId.containsKey(dueBeyondWindowTask.Id));
        System.assert(!byId.containsKey(completedOverdueTask.Id));

        System.assertEquals(-2, byId.get(overdueTask.Id).DaysUntil);
        System.assertEquals(true, byId.get(overdueTask.Id).IsOverdue);

        System.assertEquals(0, byId.get(dueTodayTask.Id).DaysUntil);
        System.assertEquals(false, byId.get(dueTodayTask.Id).IsOverdue);

        System.assertEquals(1, byId.get(dueTomorrowTask.Id).DaysUntil);
        System.assertEquals(5, byId.get(dueThisWeekTask.Id).DaysUntil);
        System.assertEquals(20, byId.get(dueThisMonthTask.Id).DaysUntil);

        System.assertEquals(null, byId.get(noDueDateTask.Id).DaysUntil);
        System.assertEquals(false, byId.get(noDueDateTask.Id).IsOverdue);
    }

    @IsTest
    static void testGetMyDueTasks_excludesWaitingStatus_evenWhenOwnedByCurrentUser() {

        // A Waiting subtask's placeholder owner is whoever applied its
        // template - typically the current user in this scenario - but it
        // must never show up as "assigned to me" since it isn't actionable
        // yet; it belongs on the dedicated Waiting tab instead.
        Task waitingNoDueDate = new Task(
            Subject      = 'Waiting Placeholder No Due Date',
            Status       = 'Waiting',
            OwnerId      = UserInfo.getUserId()
        );

        Task waitingWithDueDate = new Task(
            Subject      = 'Waiting Placeholder With Due Date',
            Status       = 'Waiting',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId()
        );

        insert new List<Task>{ waitingNoDueDate, waitingWithDueDate };

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        Set<Id> resultIds = new Set<Id>();
        for (TaskDueReminderController.DueTask dt : results) {
            resultIds.add(dt.Id);
        }

        System.assert(!resultIds.contains(waitingNoDueDate.Id));
        System.assert(!resultIds.contains(waitingWithDueDate.Id));
    }

    @IsTest
    static void testGetMyDueTasks_noneDue_returnsEmptyList() {

        Task farFutureTask = new Task(
            Subject      = 'Far Future Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(60),
            OwnerId      = UserInfo.getUserId()
        );
        insert farFutureTask;

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        System.assertEquals(0, results.size());
    }

    @IsTest
    static void testGetMyDueTasks_matterViaCustomField_and_viaWhatId() {

        NEOS_Matter__c matterA = new NEOS_Matter__c(Case_Title__c = 'Matter A Title');
        NEOS_Matter__c matterB = new NEOS_Matter__c(Case_Title__c = 'Matter B Title');
        insert new List<NEOS_Matter__c>{ matterA, matterB };

        matterA = [SELECT Id, Name FROM NEOS_Matter__c WHERE Id = :matterA.Id];
        matterB = [SELECT Id, Name FROM NEOS_Matter__c WHERE Id = :matterB.Id];

        Task viaCustomField = new Task(
            Subject        = 'Via Custom Field',
            Status         = 'Not Started',
            ActivityDate   = Date.today(),
            OwnerId        = UserInfo.getUserId(),
            NEOS_Matter__c = matterA.Id
        );

        Task viaWhatId = new Task(
            Subject      = 'Via WhatId',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId(),
            WhatId       = matterB.Id
        );

        Task noMatter = new Task(
            Subject      = 'No Matter',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId()
        );

        insert new List<Task>{ viaCustomField, viaWhatId, noMatter };

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        Map<Id, TaskDueReminderController.DueTask> byId =
            new Map<Id, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            byId.put(dt.Id, dt);
        }

        System.assertEquals(matterA.Id, byId.get(viaCustomField.Id).MatterId);
        System.assertEquals(matterA.Name, byId.get(viaCustomField.Id).MatterName);

        System.assertEquals(matterB.Id, byId.get(viaWhatId.Id).MatterId);
        System.assertEquals(matterB.Name, byId.get(viaWhatId.Id).MatterName);

        System.assertEquals(null, byId.get(noMatter.Id).MatterId);
        System.assertEquals(null, byId.get(noMatter.Id).MatterName);
    }

    @IsTest
    static void testGetMyDueTasks_includesSnoozedTasksFlagged_expiredSnoozeNotFlagged() {

        // Snoozed tasks stay in the list (dimmed with a "Snoozed" label in
        // the UI) rather than disappearing entirely - see IsSnoozed below.
        Task snoozedIntoFuture = new Task(
            Subject          = 'Snoozed Task',
            Status           = 'Not Started',
            ActivityDate     = Date.today(),
            OwnerId          = UserInfo.getUserId(),
            Snoozed_Until__c = Datetime.now().addDays(1)
        );

        Task snoozeExpired = new Task(
            Subject          = 'Snooze Expired Task',
            Status           = 'Not Started',
            ActivityDate     = Date.today(),
            OwnerId          = UserInfo.getUserId(),
            Snoozed_Until__c = Datetime.now().addMinutes(-5)
        );

        insert new List<Task>{ snoozedIntoFuture, snoozeExpired };

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        Map<Id, TaskDueReminderController.DueTask> byId = new Map<Id, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            byId.put(dt.Id, dt);
        }

        System.assert(byId.containsKey(snoozedIntoFuture.Id));
        System.assertEquals(true, byId.get(snoozedIntoFuture.Id).IsSnoozed);

        System.assert(byId.containsKey(snoozeExpired.Id));
        System.assertEquals(false, byId.get(snoozeExpired.Id).IsSnoozed);
    }

    @IsTest
    static void testSnoozeTask_setsSnoozedUntil() {

        Task t = new Task(
            Subject      = 'Task To Snooze',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId()
        );
        insert t;

        Datetime snoozeUntil = Datetime.now().addDays(7);

        Test.startTest();
        TaskDueReminderController.snoozeTask(t.Id, snoozeUntil);
        Test.stopTest();

        Task updated = [SELECT Snoozed_Until__c FROM Task WHERE Id = :t.Id];
        System.assertEquals(snoozeUntil, updated.Snoozed_Until__c);
    }

    @IsTest
    static void testGetTasksAssignedByMe_returnsOnlyDelegatedOpenTasks() {

        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];

        User otherUser = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'Delegate',
            Email = 'taskduereminder.delegate@test.example',
            Username = 'taskduereminder.delegate+' + System.now().getTime() + '@test.example',
            Alias = 'deleg1',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert otherUser;
        otherUser = [SELECT Id, Name FROM User WHERE Id = :otherUser.Id];

        Task delegatedOpenTask = new Task(
            Subject      = 'Delegated Open Task',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = otherUser.Id
        );

        Task delegatedCompletedTask = new Task(
            Subject      = 'Delegated Completed Task',
            Status       = 'Completed',
            ActivityDate = Date.today(),
            OwnerId      = otherUser.Id
        );

        Task ownTask = new Task(
            Subject      = 'My Own Task',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId()
        );

        insert new List<Task>{ delegatedOpenTask, delegatedCompletedTask, ownTask };

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getTasksAssignedByMe();
        Test.stopTest();

        Map<Id, TaskDueReminderController.DueTask> byId =
            new Map<Id, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            byId.put(dt.Id, dt);
        }

        System.assertEquals(1, results.size());
        System.assert(byId.containsKey(delegatedOpenTask.Id));
        System.assert(!byId.containsKey(delegatedCompletedTask.Id));
        System.assert(!byId.containsKey(ownTask.Id));

        System.assertEquals(otherUser.Name, byId.get(delegatedOpenTask.Id).OwnerName);
        System.assertEquals('Not Started', byId.get(delegatedOpenTask.Id).Status);
    }

    @IsTest
    static void testGetMyWaitingTasks_returnsOnlyTasksResolvingToCurrentUser() {
        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];

        User staticAssignee = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'WaitingOnTest',
            Email = 'waitingontest@test.example',
            Username = 'waitingontest+' + System.now().getTime() + '@test.example',
            Alias = 'waiton1',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert staticAssignee;
        staticAssignee = [SELECT Id, Name FROM User WHERE Id = :staticAssignee.Id];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'Waiting Tab Test Template');
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
            Subject__c                 = 'Step Two Waiting On Me',
            Assignee_Type__c           = 'Dynamic Matter Field',
            Dynamic_Assignee_Field__c  = 'Senior_Attorney__c',
            Depends_On_Step__c         = stepOne.Id
        );

        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Case',
            Senior_Attorney__c = UserInfo.getUserId()
        );
        insert matter;

        SubtaskTemplateApplier.apply(template.Id, matter.Id);

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyWaitingTasks();
        Test.stopTest();

        Map<String, TaskDueReminderController.DueTask> bySubject = new Map<String, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            bySubject.put(dt.Subject, dt);
        }

        System.assert(bySubject.containsKey('Step Two Waiting On Me'));
        System.assertEquals('Waiting', bySubject.get('Step Two Waiting On Me').Status);
        System.assertEquals('Step One', bySubject.get('Step Two Waiting On Me').WaitingOnSubject);
        System.assertEquals(staticAssignee.Name, bySubject.get('Step Two Waiting On Me').WaitingOnOwnerName);
        System.assert(!bySubject.containsKey('Step One'));
    }

    @IsTest
    static void testGetMyWaitingTasks_notPushedOutByUnrelatedWaitingTasksElsewhereInOrg() {
        Subtask_Template__c template = new Subtask_Template__c(Name = 'Volume Test Template');
        insert template;

        Subtask_Template_Item__c myItem = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 1,
            Subject__c          = 'My Real Waiting Step',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = UserInfo.getUserId()
        );
        insert myItem;

        Task myWaitingTask = new Task(
            Subject                  = 'My Real Waiting Step',
            Status                   = 'Waiting',
            OwnerId                  = UserInfo.getUserId(),
            Subtask_Template_Item__c = myItem.Id
        );
        insert myWaitingTask;

        // Flood with 200 unrelated Waiting chain steps owned by someone
        // else, inserted AFTER the real task so they'd rank ahead of it
        // under an org-wide "ORDER BY CreatedDate DESC LIMIT 200" scan with
        // no owner pre-filter - the exact scenario that used to be able to
        // push a user's own due task out of their Waiting tab.
        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
        User otherUser = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'Decoy',
            Email = 'decoy@test.example',
            Username = 'decoy+' + System.now().getTime() + '@test.example',
            Alias = 'decoy1',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert otherUser;

        Subtask_Template_Item__c decoyItem = new Subtask_Template_Item__c(
            Subtask_Template__c = template.Id,
            Sequence_Order__c   = 2,
            Subject__c          = 'Decoy Step',
            Assignee_Type__c    = 'Static User',
            Static_Assignee__c  = otherUser.Id
        );
        insert decoyItem;

        List<Task> decoys = new List<Task>();
        for (Integer i = 0; i < 200; i++) {
            decoys.add(new Task(
                Subject                  = 'Decoy Waiting ' + i,
                Status                   = 'Waiting',
                OwnerId                  = otherUser.Id,
                Subtask_Template_Item__c = decoyItem.Id
            ));
        }
        insert decoys;

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyWaitingTasks();
        Test.stopTest();

        Boolean found = false;
        for (TaskDueReminderController.DueTask dt : results) {
            if (dt.Subject == 'My Real Waiting Step') found = true;
        }
        System.assert(found, 'The current user\'s own waiting task must not be pushed out by unrelated waiting tasks elsewhere in the org.');
    }

    @IsTest
    static void testSnoozeTask_notOwner_throws() {

        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];

        User otherUser = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'OtherOwner',
            Email = 'taskduereminder.other@test.example',
            Username = 'taskduereminder.other+' + System.now().getTime() + '@test.example',
            Alias = 'other1',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert otherUser;

        Task t = new Task(
            Subject      = 'Not My Task',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = otherUser.Id
        );
        insert t;

        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            TaskDueReminderController.snoozeTask(t.Id, Datetime.now().addDays(1));
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        System.assertEquals(true, exceptionThrown);
    }

    @IsTest
    static void testGetMyDueTasks_returnsAttachmentsAndOwnerCreatedByIds() {
        Task t = new Task(
            Subject      = 'Task With File',
            Status       = 'Not Started',
            ActivityDate = Date.today(),
            OwnerId      = UserInfo.getUserId()
        );
        insert t;

        ContentVersion cv = new ContentVersion(
            Title = 'due-task-file.pdf',
            PathOnClient = 'due-task-file.pdf',
            VersionData = Blob.valueOf('file contents'),
            FirstPublishLocationId = t.Id
        );
        insert cv;

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        TaskDueReminderController.DueTask dueTask;
        for (TaskDueReminderController.DueTask dt : results) {
            if (dt.Id == t.Id) dueTask = dt;
        }

        System.assertNotEquals(null, dueTask);
        System.assertEquals(UserInfo.getUserId(), dueTask.OwnerId);
        System.assertEquals(UserInfo.getUserId(), dueTask.CreatedById);
        System.assertEquals(1, dueTask.AttachmentDtos.size());
        System.assertEquals('due-task-file.pdf', dueTask.AttachmentDtos[0].title);
        System.assertEquals(false, dueTask.IsChainStep);
        System.assertEquals(false, dueTask.IsBypassed);
    }
}
