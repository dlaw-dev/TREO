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

    @IsTest
    static void returnsAttachmentsAndCreatedById() {
        Account a = new Account(Name = 'Test Account');
        insert a;

        Task t = new Task(
            Subject = 'Task With File',
            Status = 'Not Started',
            WhatId = a.Id
        );
        insert t;

        ContentVersion cv = new ContentVersion(
            Title = 'matter-file.pdf',
            PathOnClient = 'matter-file.pdf',
            VersionData = Blob.valueOf('file contents'),
            FirstPublishLocationId = t.Id
        );
        insert cv;

        Test.startTest();
        List<TaskCalendarController.TaskRow> rows = TaskCalendarController.getTasksForMatter(a.Id);
        Test.stopTest();

        TaskCalendarController.TaskRow row;
        for (TaskCalendarController.TaskRow r : rows) {
            if (r.Id == t.Id) row = r;
        }

        System.assertNotEquals(null, row);
        System.assertEquals(UserInfo.getUserId(), row.CreatedById);
        System.assertEquals(1, row.AttachmentDtos.size());
        System.assertEquals('matter-file.pdf', row.AttachmentDtos[0].title);
        System.assertEquals(false, row.IsChainStep);
        System.assertEquals(false, row.IsBypassed);
    }
}