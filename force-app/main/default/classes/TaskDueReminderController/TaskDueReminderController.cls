public with sharing class TaskDueReminderController {

    @AuraEnabled(cacheable=false)
    public static List<DueTask> getMyDueTasks() {

        Date todayDate = Date.today();
        Date upperBound = todayDate.addDays(7);

        List<DueTask> results = new List<DueTask>();

        for (Task t : [
            SELECT Id,
                   Subject,
                   ActivityDate,
                   Priority,
                   Status,
                   Task_Subtype__c,
                   NEOS_Matter__c,
                   NEOS_Matter__r.Name
            FROM Task
            WHERE OwnerId = :UserInfo.getUserId()
              AND Status != 'Completed'
              AND ActivityDate != null
              AND ActivityDate <= :upperBound
            ORDER BY ActivityDate ASC
            LIMIT 100
        ]) {
            results.add(new DueTask(t, todayDate));
        }

        return results;
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
            MatterId     = t.NEOS_Matter__c;
            MatterName   = (t.NEOS_Matter__r != null) ? t.NEOS_Matter__r.Name : null;
            TaskSubtype  = t.Task_Subtype__c;
            DaysUntil    = todayDate.daysBetween(t.ActivityDate);
            IsOverdue    = DaysUntil < 0;
        }
    }
}
