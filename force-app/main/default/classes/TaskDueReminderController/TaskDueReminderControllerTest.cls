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

        Task dueBeyondWindowTask = new Task(
            Subject      = 'Due Beyond Window Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(10),
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
            overdueTask, dueTodayTask, dueTomorrowTask, dueThisWeekTask,
            dueBeyondWindowTask, completedOverdueTask, noDueDateTask
        };

        Test.startTest();
        List<TaskDueReminderController.DueTask> results = TaskDueReminderController.getMyDueTasks();
        Test.stopTest();

        System.assertEquals(5, results.size());

        Map<Id, TaskDueReminderController.DueTask> byId =
            new Map<Id, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            byId.put(dt.Id, dt);
        }

        System.assert(byId.containsKey(overdueTask.Id));
        System.assert(byId.containsKey(dueTodayTask.Id));
        System.assert(byId.containsKey(dueTomorrowTask.Id));
        System.assert(byId.containsKey(dueThisWeekTask.Id));
        System.assert(byId.containsKey(noDueDateTask.Id));
        System.assert(!byId.containsKey(dueBeyondWindowTask.Id));
        System.assert(!byId.containsKey(completedOverdueTask.Id));

        System.assertEquals(-2, byId.get(overdueTask.Id).DaysUntil);
        System.assertEquals(true, byId.get(overdueTask.Id).IsOverdue);

        System.assertEquals(0, byId.get(dueTodayTask.Id).DaysUntil);
        System.assertEquals(false, byId.get(dueTodayTask.Id).IsOverdue);

        System.assertEquals(1, byId.get(dueTomorrowTask.Id).DaysUntil);
        System.assertEquals(5, byId.get(dueThisWeekTask.Id).DaysUntil);

        System.assertEquals(null, byId.get(noDueDateTask.Id).DaysUntil);
        System.assertEquals(false, byId.get(noDueDateTask.Id).IsOverdue);
    }

    @IsTest
    static void testGetMyDueTasks_noneDue_returnsEmptyList() {

        Task farFutureTask = new Task(
            Subject      = 'Far Future Task',
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(30),
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
    static void testGetMyDueTasks_excludesSnoozedInFuture_includesSnoozeExpired() {

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

        Set<Id> returnedIds = new Set<Id>();
        for (TaskDueReminderController.DueTask dt : results) {
            returnedIds.add(dt.Id);
        }

        System.assert(!returnedIds.contains(snoozedIntoFuture.Id));
        System.assert(returnedIds.contains(snoozeExpired.Id));
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
}
