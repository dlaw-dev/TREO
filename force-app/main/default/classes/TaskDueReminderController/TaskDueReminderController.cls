public with sharing class TaskDueReminderController {

    @AuraEnabled(cacheable=false)
    public static List<DueTask> getMyDueTasks() {

        Date todayDate = Date.today();
        Date upperBound = todayDate.addDays(30);
        Datetime nowDt = Datetime.now();
        Id currentUserId = UserInfo.getUserId();

        List<DueTask> results = new List<DueTask>();

        for (Task t : [
            SELECT Id,
                   Subject,
                   ActivityDate,
                   Priority,
                   Status,
                   Task_Subtype__c,
                   NEOS_Matter__c,
                   NEOS_Matter__r.Name,
                   WhatId,
                   What.Name,
                   OwnerId,
                   Owner.Name
            FROM Task
            WHERE OwnerId = :currentUserId
              AND Status != 'Completed'
              AND ActivityDate != null
              AND ActivityDate <= :upperBound
              AND (Snoozed_Until__c = null OR Snoozed_Until__c <= :nowDt)
            ORDER BY ActivityDate ASC
            LIMIT 150
        ]) {
            results.add(new DueTask(t, todayDate));
        }

        for (Task t : [
            SELECT Id,
                   Subject,
                   ActivityDate,
                   Priority,
                   Status,
                   Task_Subtype__c,
                   NEOS_Matter__c,
                   NEOS_Matter__r.Name,
                   WhatId,
                   What.Name,
                   OwnerId,
                   Owner.Name
            FROM Task
            WHERE OwnerId = :currentUserId
              AND Status != 'Completed'
              AND ActivityDate = null
              AND (Snoozed_Until__c = null OR Snoozed_Until__c <= :nowDt)
            ORDER BY CreatedDate DESC
            LIMIT 20
        ]) {
            results.add(new DueTask(t, todayDate));
        }

        return results;
    }

    @AuraEnabled(cacheable=false)
    public static List<DueTask> getTasksAssignedByMe() {

        Date todayDate = Date.today();
        Date upperBound = todayDate.addDays(30);
        Id currentUserId = UserInfo.getUserId();

        List<DueTask> results = new List<DueTask>();

        for (Task t : [
            SELECT Id,
                   Subject,
                   ActivityDate,
                   Priority,
                   Status,
                   Task_Subtype__c,
                   NEOS_Matter__c,
                   NEOS_Matter__r.Name,
                   WhatId,
                   What.Name,
                   OwnerId,
                   Owner.Name
            FROM Task
            WHERE CreatedById = :currentUserId
              AND OwnerId != :currentUserId
              AND Status != 'Completed'
              AND ActivityDate != null
              AND ActivityDate <= :upperBound
            ORDER BY ActivityDate ASC
            LIMIT 150
        ]) {
            results.add(new DueTask(t, todayDate));
        }

        for (Task t : [
            SELECT Id,
                   Subject,
                   ActivityDate,
                   Priority,
                   Status,
                   Task_Subtype__c,
                   NEOS_Matter__c,
                   NEOS_Matter__r.Name,
                   WhatId,
                   What.Name,
                   OwnerId,
                   Owner.Name
            FROM Task
            WHERE CreatedById = :currentUserId
              AND OwnerId != :currentUserId
              AND Status != 'Completed'
              AND ActivityDate = null
            ORDER BY CreatedDate DESC
            LIMIT 20
        ]) {
            results.add(new DueTask(t, todayDate));
        }

        return results;
    }

    @AuraEnabled(cacheable=false)
    public static List<DueTask> getMyWaitingTasks() {

        Date todayDate = Date.today();
        Id currentUserId = UserInfo.getUserId();

        List<Task> matchingTasks = new List<Task>();
        Set<String> chainIds = new Set<String>();

        for (Task t : [
            SELECT Id,
                   Subject,
                   ActivityDate,
                   Priority,
                   Status,
                   Task_Subtype__c,
                   NEOS_Matter__c,
                   NEOS_Matter__r.Name,
                   WhatId,
                   What.Name,
                   OwnerId,
                   Owner.Name,
                   Parent_Task__c,
                   Subtask_Template_Item__r.Assignee_Type__c,
                   Subtask_Template_Item__r.Static_Assignee__c,
                   Subtask_Template_Item__r.Dynamic_Assignee_Field__c
            FROM Task
            WHERE Status = 'Waiting'
              AND Subtask_Template_Item__c != null
            ORDER BY CreatedDate DESC
            LIMIT 200
        ]) {
            Id resolvedAssigneeId = SubtaskAssigneeResolver.resolveAssignee(
                t.Subtask_Template_Item__r, t.NEOS_Matter__c);

            if (resolvedAssigneeId == currentUserId) {
                matchingTasks.add(t);

                if (t.Parent_Task__c != null) {
                    chainIds.add(t.Parent_Task__c);
                }
            }
        }

        // Exactly one task per chain is ever Open at a time - whoever owns it
        // is the person actually holding up every Waiting step behind it.
        Map<String, Task> openTaskByChain = new Map<String, Task>();

        if (!chainIds.isEmpty()) {
            for (Task openTask : [
                SELECT Id, Subject, Owner.Name, Parent_Task__c
                FROM Task
                WHERE Parent_Task__c IN :chainIds
                  AND Status = 'Open'
            ]) {
                openTaskByChain.put(openTask.Parent_Task__c, openTask);
            }
        }

        List<DueTask> results = new List<DueTask>();

        for (Task t : matchingTasks) {
            DueTask dueTask = new DueTask(t, todayDate);
            Task openTask = t.Parent_Task__c != null ? openTaskByChain.get(t.Parent_Task__c) : null;

            if (openTask != null) {
                dueTask.WaitingOnSubject = openTask.Subject;
                dueTask.WaitingOnOwnerName = openTask.Owner.Name;
            }

            results.add(dueTask);
        }

        return results;
    }

    @AuraEnabled
    public static void snoozeTask(Id taskId, Datetime snoozeUntil) {
        try {
            Task t = [
                SELECT Id
                FROM Task
                WHERE Id = :taskId
                  AND OwnerId = :UserInfo.getUserId()
                LIMIT 1
            ];

            t.Snoozed_Until__c = snoozeUntil;
            update t;
        } catch (Exception e) {
            throw new AuraHandledException('Error snoozing task: ' + e.getMessage());
        }
    }

    public class DueTask {
        @AuraEnabled public Id      Id;
        @AuraEnabled public String  Subject;
        @AuraEnabled public Date    ActivityDate;
        @AuraEnabled public String  Priority;
        @AuraEnabled public String  Status;
        @AuraEnabled public Id      MatterId;
        @AuraEnabled public String  MatterName;
        @AuraEnabled public String  TaskSubtype;
        @AuraEnabled public Boolean IsOverdue;
        @AuraEnabled public Integer DaysUntil;
        @AuraEnabled public String  OwnerName;
        @AuraEnabled public String  WaitingOnSubject;
        @AuraEnabled public String  WaitingOnOwnerName;

        public DueTask(Task t, Date todayDate) {
            Id           = t.Id;
            Subject      = t.Subject;
            ActivityDate = t.ActivityDate;
            Priority     = t.Priority;
            Status       = t.Status;
            TaskSubtype  = t.Task_Subtype__c;
            OwnerName    = t.Owner != null ? t.Owner.Name : null;

            if (t.ActivityDate != null) {
                DaysUntil = todayDate.daysBetween(t.ActivityDate);
                IsOverdue = DaysUntil < 0;
            } else {
                DaysUntil = null;
                IsOverdue = false;
            }

            Id matterCandidateId = (t.NEOS_Matter__c != null) ? t.NEOS_Matter__c : t.WhatId;
            String matterCandidateName = (t.NEOS_Matter__r != null)
                ? t.NEOS_Matter__r.Name
                : (t.What != null ? t.What.Name : null);

            Boolean isMatter = matterCandidateId != null
                && matterCandidateId.getSobjectType() == NEOS_Matter__c.SObjectType;

            MatterId   = isMatter ? matterCandidateId : null;
            MatterName = isMatter ? matterCandidateName : null;
        }
    }
}
