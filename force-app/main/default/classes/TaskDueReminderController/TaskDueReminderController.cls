public with sharing class TaskDueReminderController {

    @AuraEnabled(cacheable=false)
    public static List<DueTask> getMyDueTasks() {

        Date todayDate = Date.today();
        Date upperBound = todayDate.addDays(30);
        Datetime nowDt = Datetime.now();

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
                   What.Name
            FROM Task
            WHERE OwnerId = :UserInfo.getUserId()
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
                   What.Name
            FROM Task
            WHERE OwnerId = :UserInfo.getUserId()
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
        @AuraEnabled public Id      MatterId;
        @AuraEnabled public String  MatterName;
        @AuraEnabled public String  TaskSubtype;
        @AuraEnabled public Boolean IsOverdue;
        @AuraEnabled public Integer DaysUntil;

        public DueTask(Task t, Date todayDate) {
            Id           = t.Id;
            Subject      = t.Subject;
            ActivityDate = t.ActivityDate;
            Priority     = t.Priority;
            TaskSubtype  = t.Task_Subtype__c;

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
