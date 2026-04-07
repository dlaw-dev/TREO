@IsTest
private class TaskReminderSchedulerTest {

    @IsTest
    static void testSchedulerExecutes() {

        Test.startTest();

        // Schedule the job
        String cron = '0 0 0 1 1 ? 2099';
        System.schedule('Test Task Reminder Scheduler', cron, new TaskReminderScheduler());

        Test.stopTest();

        // If no exception occurs, test passes
        System.assert(true);
    }
}