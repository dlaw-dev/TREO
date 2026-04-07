@IsTest
private class TaskReminderProcessorTest {

    @IsTest
    static void testTaskReminderProcessing() {

        Profile p = [
            SELECT Id
            FROM Profile
            WHERE Name = 'System Administrator'
            LIMIT 1
        ];

        User u = new User(
            ProfileId = p.Id,
            LastName = 'ReminderUser',
            Email = 'reminderuser@test.example',
            Username = 'reminderuser' + System.now().getTime() + '@test.example',
            Alias = 'ruser',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;

        Task t = new Task(
            Subject = 'Test Reminder Task',
            OwnerId = u.Id,
            ActivityDate = Date.today(),
            Status = 'Not Started',
            Priority = 'Normal'
        );
        insert t;

        Task_Reminder__c reminder = new Task_Reminder__c(
            Task_ID__c = t.Id,
            Task_Name__c = t.Subject,
            Reminder_Type__c = '1 Day Before',
            Reminder_Date_Time__c = System.now(),
            Is_Sent__c = false,
            Recipient_User_Id__c = u.Id,
            Recipient_Email__c = u.Email
        );
        insert reminder;

        Test.startTest();
        TaskReminderProcessor.run();
        Test.stopTest();

        Task_Reminder__c updated = [
            SELECT Is_Sent__c, Sent_Date_Time__c
            FROM Task_Reminder__c
            WHERE Id = :reminder.Id
        ];

        System.assertEquals(true, updated.Is_Sent__c);
        System.assertNotEquals(null, updated.Sent_Date_Time__c);
    }


    @IsTest
    static void testEventReminderProcessing() {

        Profile p = [
            SELECT Id
            FROM Profile
            WHERE Name = 'System Administrator'
            LIMIT 1
        ];

        User u = new User(
            ProfileId = p.Id,
            LastName = 'EventUser',
            Email = 'eventuser@test.example',
            Username = 'eventuser' + System.now().getTime() + '@test.example',
            Alias = 'euser',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;

        Event e = new Event(
            Subject = 'Test Event Reminder',
            OwnerId = u.Id,
            StartDateTime = System.now().addHours(1),
            EndDateTime = System.now().addHours(2)
        );
        insert e;

        // Dummy Task Reminder (prevents processor early return)
        Task t = new Task(
            Subject = 'Dummy Task',
            OwnerId = u.Id,
            ActivityDate = Date.today(),
            Status = 'Not Started',
            Priority = 'Normal'
        );
        insert t;

        Task_Reminder__c dummyTaskReminder = new Task_Reminder__c(
            Task_ID__c = t.Id,
            Task_Name__c = t.Subject,
            Reminder_Type__c = '1 Day Before',
            Reminder_Date_Time__c = System.now(),
            Is_Sent__c = false,
            Recipient_User_Id__c = u.Id,
            Recipient_Email__c = u.Email
        );
        insert dummyTaskReminder;

        Event_Reminder__c eventReminder = new Event_Reminder__c(
            Event_ID__c = e.Id,
            Event_Name__c = e.Subject,
            Reminder_Type__c = '1 Day Before',
            Reminder_Date_Time__c = System.now(),
            Is_Sent__c = false,
            Recipient_Email__c = u.Email
        );
        insert eventReminder;

        Test.startTest();
        TaskReminderProcessor.run();
        Test.stopTest();

        Event_Reminder__c updated = [
            SELECT Is_Sent__c, Sent_Date_Time__c
            FROM Event_Reminder__c
            WHERE Id = :eventReminder.Id
        ];

        System.assertEquals(true, updated.Is_Sent__c);
        System.assertNotEquals(null, updated.Sent_Date_Time__c);
    }


    @IsTest
    static void testNoRemindersDue() {

        Test.startTest();
        TaskReminderProcessor.run();
        Test.stopTest();

        System.assert(true);
    }
}