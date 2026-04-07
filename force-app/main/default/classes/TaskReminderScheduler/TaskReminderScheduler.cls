global with sharing class TaskReminderScheduler implements Schedulable {

    global void execute(SchedulableContext sc) {
        TaskReminderProcessor.run();
    }
}