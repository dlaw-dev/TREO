@IsTest
private class TaskCalendarControllerTest {
    @IsTest
    static void returnsTasksWithoutError() {
        // Create a parent record the Task can relate to.
        // Use something always available: Account.
        Account a = new Account(Name = 'Test Account');
        insert a;

        // Task requires Subject and Status
        Task t = new Task(
            Subject = 'Test Task',
            Status = 'Not Started',
            WhatId = a.Id
        );
        insert t;

        Test.startTest();
        List<TaskCalendarController.TaskRow> rows =
            TaskCalendarController.getTasksForMatter(a.Id);
        Test.stopTest();

        System.assertNotEquals(null, rows, 'Rows should not be null');
        System.assert(rows.size() >= 1, 'Should return at least one task');
    }
}