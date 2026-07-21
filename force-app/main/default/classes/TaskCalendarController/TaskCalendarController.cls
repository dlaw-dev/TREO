public with sharing class TaskCalendarController {

    @AuraEnabled(cacheable=true)
    public static List<TaskRow> getTasksForMatter(Id parentId) {
        if (parentId == null) return new List<TaskRow>();

        List<Task> tasks = [
            SELECT Id,
                   Subject,
                   Status,
                   Priority,
                   ActivityDate,
                   OwnerId,
                   Owner.Name,
                   WhatId,
                   NEOS_Matter__c,
                   Task_Subtype__c,
                   Task_Subtype_If_Other__c,
                   Internal_External_Type__c,
                   Description,
                   Waiting_On_Task__c
            FROM Task
            WHERE IsDeleted = false
              AND (WhatId = :parentId OR NEOS_Matter__c = :parentId)
            ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC
            LIMIT 200
        ];

        // Bulk-resolve every referenced "waiting on" task in one query
        // rather than one per row.
        Set<String> waitingOnIds = new Set<String>();
        for (Task t : tasks) {
            if (String.isNotBlank(t.Waiting_On_Task__c)) {
                waitingOnIds.add(t.Waiting_On_Task__c);
            }
        }

        Map<Id, Task> waitingOnTaskById = new Map<Id, Task>();
        if (!waitingOnIds.isEmpty()) {
            waitingOnTaskById = new Map<Id, Task>([
                SELECT Id, Subject, Owner.Name
                FROM Task
                WHERE Id IN :waitingOnIds
            ]);
        }

        List<TaskRow> rows = new List<TaskRow>();
        for (Task t : tasks) {
            Task waitingOnTask = String.isNotBlank(t.Waiting_On_Task__c)
                ? waitingOnTaskById.get(t.Waiting_On_Task__c)
                : null;
            rows.add(new TaskRow(t, waitingOnTask));
        }

        return rows;
    }

    public class TaskRow {
        @AuraEnabled public Id     Id;
        @AuraEnabled public String Subject;
        @AuraEnabled public String Status;
        @AuraEnabled public String Priority;
        @AuraEnabled public Date   ActivityDate;
        @AuraEnabled public Id     OwnerId;
        @AuraEnabled public String OwnerName;
        @AuraEnabled public String TaskSubtype;
        @AuraEnabled public String TaskSubtypeIfOther;
        @AuraEnabled public String InternalExternalType;
        @AuraEnabled public String Description;
        @AuraEnabled public String WaitingOnSubject;
        @AuraEnabled public String WaitingOnOwnerName;

        public TaskRow(Task t, Task waitingOnTask) {
            Id                  = t.Id;
            Subject             = t.Subject;
            Status              = t.Status;
            Priority            = t.Priority;
            ActivityDate        = t.ActivityDate;
            OwnerId             = t.OwnerId;
            OwnerName           = (t.Owner == null) ? null : t.Owner.Name;
            TaskSubtype         = t.Task_Subtype__c;
            TaskSubtypeIfOther  = t.Task_Subtype_If_Other__c;
            InternalExternalType = t.Internal_External_Type__c;
            Description         = t.Description;

            if (waitingOnTask != null) {
                WaitingOnSubject   = waitingOnTask.Subject;
                WaitingOnOwnerName = (waitingOnTask.Owner == null) ? null : waitingOnTask.Owner.Name;
            }
        }
    }
}
