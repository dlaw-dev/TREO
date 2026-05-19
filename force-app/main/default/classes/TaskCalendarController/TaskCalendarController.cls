public with sharing class TaskCalendarController {

    @AuraEnabled(cacheable=true)
    public static List<TaskRow> getTasksForMatter(Id parentId) {
        if (parentId == null) return new List<TaskRow>();

        List<TaskRow> rows = new List<TaskRow>();

        for (Task t : [
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
                   Description
            FROM Task
            WHERE IsDeleted = false
              AND (WhatId = :parentId OR NEOS_Matter__c = :parentId)
            ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC
            LIMIT 200
        ]) {
            rows.add(new TaskRow(t));
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

        public TaskRow(Task t) {
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
        }
    }
}
