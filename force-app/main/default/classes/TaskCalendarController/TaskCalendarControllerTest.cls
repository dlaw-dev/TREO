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

    @IsTest
    static void returnsEmptyListWithoutErrorWhenNoTasksExist() {
        // A parent record with zero Tasks against it (e.g. a brand new
        // Matter, or one where the running user's sharing shows none) -
        // attachmentsFor() must not run its ContentDocumentLink query with
        // an empty Id set in this case.
        Account a = new Account(Name = 'Empty Parent Account');
        insert a;

        Test.startTest();
        List<TaskCalendarController.TaskRow> rows = TaskCalendarController.getTasksForMatter(a.Id);
        Test.stopTest();

        System.assertNotEquals(null, rows);
        System.assertEquals(0, rows.size());
    }

    @IsTest
    static void returnsReviewerFieldsWhenSet() {
        Profile sysAdmin = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
        User reviewer = new User(
            ProfileId = sysAdmin.Id,
            LastName = 'CalendarReviewer',
            Email = 'taskcalendar.reviewer@test.example',
            Username = 'taskcalendar.reviewer+' + System.now().getTime() + '@test.example',
            Alias = 'calrev1',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert reviewer;
        reviewer = [SELECT Id, Name FROM User WHERE Id = :reviewer.Id];

        Account a = new Account(Name = 'Test Account');
        insert a;

        Task t = new Task(
            Subject             = 'Task Pending Review',
            Status              = 'Pending Review',
            WhatId              = a.Id,
            Reviewer__c         = reviewer.Id,
            Review_Feedback__c  = 'Looked good last time.'
        );
        insert t;

        Test.startTest();
        List<TaskCalendarController.TaskRow> rows = TaskCalendarController.getTasksForMatter(a.Id);
        Test.stopTest();

        TaskCalendarController.TaskRow row;
        for (TaskCalendarController.TaskRow r : rows) {
            if (r.Id == t.Id) row = r;
        }

        System.assertNotEquals(null, row);
        System.assertEquals(reviewer.Id, row.ReviewerId);
        System.assertEquals(reviewer.Name, row.ReviewerName);
        System.assertEquals('Looked good last time.', row.ReviewFeedback);
    }
}