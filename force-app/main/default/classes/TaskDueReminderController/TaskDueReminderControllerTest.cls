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

        System.assertEquals(4, results.size());

        Map<Id, TaskDueReminderController.DueTask> byId =
            new Map<Id, TaskDueReminderController.DueTask>();
        for (TaskDueReminderController.DueTask dt : results) {
            byId.put(dt.Id, dt);
        }

        System.assert(byId.containsKey(overdueTask.Id));
        System.assert(byId.containsKey(dueTodayTask.Id));
        System.assert(byId.containsKey(dueTomorrowTask.Id));
        System.assert(byId.containsKey(dueThisWeekTask.Id));
        System.assert(!byId.containsKey(dueBeyondWindowTask.Id));
        System.assert(!byId.containsKey(completedOverdueTask.Id));
        System.assert(!byId.containsKey(noDueDateTask.Id));

        System.assertEquals(-2, byId.get(overdueTask.Id).DaysUntil);
        System.assertEquals(true, byId.get(overdueTask.Id).IsOverdue);

        System.assertEquals(0, byId.get(dueTodayTask.Id).DaysUntil);
        System.assertEquals(false, byId.get(dueTodayTask.Id).IsOverdue);

        System.assertEquals(1, byId.get(dueTomorrowTask.Id).DaysUntil);
        System.assertEquals(5, byId.get(dueThisWeekTask.Id).DaysUntil);
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
}
