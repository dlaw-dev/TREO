public with sharing class TaskDueReminderController {

    /**
     * Server-authoritative "done today" count for the progress ring - not
     * derived from a client-side counter, since a task can be completed
     * from more than one surface (Task Hub itself, the Matter's task list,
     * etc.) and only the server sees all of them.
     */
    @AuraEnabled(cacheable=false)
    public static Integer getCompletedTodayCount() {
        Id currentUserId = UserInfo.getUserId();
        return [
            SELECT COUNT()
            FROM Task
            WHERE OwnerId = :currentUserId
              AND Status = 'Completed'
              AND LastModifiedDate = TODAY
        ];
    }

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
                   Owner.Name,
                   CreatedById,
                   Snoozed_Until__c,
                   Subtask_Template_Item__c,
                   Bypassed__c
            FROM Task
            WHERE OwnerId = :currentUserId
              AND Status != 'Completed'
              AND Status != 'Waiting'
              AND ActivityDate != null
              AND ActivityDate <= :upperBound
            ORDER BY ActivityDate ASC
            LIMIT 150
        ]) {
            results.add(new DueTask(t, todayDate, nowDt));
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
                   Owner.Name,
                   CreatedById,
                   Snoozed_Until__c,
                   Subtask_Template_Item__c,
                   Bypassed__c
            FROM Task
            WHERE OwnerId = :currentUserId
              AND Status != 'Completed'
              AND Status != 'Waiting'
              AND ActivityDate = null
            ORDER BY CreatedDate DESC
            LIMIT 20
        ]) {
            results.add(new DueTask(t, todayDate, nowDt));
        }

        attachAttachments(results);
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
                   Owner.Name,
                   CreatedById,
                   Subtask_Template_Item__c,
                   Bypassed__c
            FROM Task
            WHERE CreatedById = :currentUserId
              AND OwnerId != :currentUserId
              AND Status != 'Completed'
              AND Status != 'Waiting'
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
                   Owner.Name,
                   CreatedById,
                   Subtask_Template_Item__c,
                   Bypassed__c
            FROM Task
            WHERE CreatedById = :currentUserId
              AND OwnerId != :currentUserId
              AND Status != 'Completed'
              AND Status != 'Waiting'
              AND ActivityDate = null
            ORDER BY CreatedDate DESC
            LIMIT 20
        ]) {
            results.add(new DueTask(t, todayDate));
        }

        attachAttachments(results);
        return results;
    }

    @AuraEnabled(cacheable=false)
    public static List<DueTask> getMyWaitingTasks() {

        Date todayDate = Date.today();
        Id currentUserId = UserInfo.getUserId();

        List<Task> waitingTasks = [
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
                   CreatedById,
                   Parent_Task__c,
                   Subtask_Template_Item__c,
                   Bypassed__c,
                   Subtask_Template_Item__r.Assignee_Type__c,
                   Subtask_Template_Item__r.Static_Assignee__c,
                   Subtask_Template_Item__r.Dynamic_Assignee_Field__c,
                   Subtask_Template_Item__r.Depends_On_Step__c
            FROM Task
            WHERE Status = 'Waiting'
              AND Subtask_Template_Item__c != null
            ORDER BY CreatedDate DESC
            LIMIT 200
        ];

        // Resolve all pending assignees in one bulk pass - one query per
        // distinct dynamic field referenced, not one per Waiting task - so
        // this stays within governor limits no matter how many chains are
        // in flight org-wide.
        Map<Id, Subtask_Template_Item__c> keyToItem = new Map<Id, Subtask_Template_Item__c>();
        Map<Id, Id> keyToMatterId = new Map<Id, Id>();

        for (Task t : waitingTasks) {
            keyToItem.put(t.Id, t.Subtask_Template_Item__r);
            keyToMatterId.put(t.Id, t.NEOS_Matter__c);
        }

        Map<Id, Id> resolvedAssigneeByTaskId = SubtaskAssigneeResolver.resolveAssigneesBulk(keyToItem, keyToMatterId);

        List<Task> matchingTasks = new List<Task>();
        Set<String> chainIds = new Set<String>();

        for (Task t : waitingTasks) {
            if (resolvedAssigneeByTaskId.get(t.Id) == currentUserId) {
                matchingTasks.add(t);

                if (t.Parent_Task__c != null) {
                    chainIds.add(t.Parent_Task__c);
                }
            }
        }

        // With branching, more than one task can be Open in the same chain
        // at once - resolve each Waiting task's own specific blocker (via
        // its item's Depends_On_Step__c) rather than assuming "the chain's
        // one Open task" is necessarily the thing holding it up.
        Set<Id> dependsOnItemIds = new Set<Id>();
        for (Task t : matchingTasks) {
            if (t.Subtask_Template_Item__r.Depends_On_Step__c != null) {
                dependsOnItemIds.add(t.Subtask_Template_Item__r.Depends_On_Step__c);
            }
        }

        Map<String, Task> blockerByCompositeKey = new Map<String, Task>();

        if (!dependsOnItemIds.isEmpty() && !chainIds.isEmpty()) {
            for (Task blockerTask : [
                SELECT Id, Subject, Owner.Name, Subtask_Template_Item__c, Parent_Task__c
                FROM Task
                WHERE Subtask_Template_Item__c IN :dependsOnItemIds
                  AND Parent_Task__c IN :chainIds
            ]) {
                blockerByCompositeKey.put(blockerTask.Subtask_Template_Item__c + ':' + blockerTask.Parent_Task__c, blockerTask);
            }
        }

        List<DueTask> results = new List<DueTask>();

        for (Task t : matchingTasks) {
            DueTask dueTask = new DueTask(t, todayDate);
            Id dependsOnItemId = t.Subtask_Template_Item__r.Depends_On_Step__c;
            Task blockerTask = (dependsOnItemId != null && t.Parent_Task__c != null)
                ? blockerByCompositeKey.get(dependsOnItemId + ':' + t.Parent_Task__c)
                : null;

            if (blockerTask != null) {
                dueTask.WaitingOnSubject = blockerTask.Subject;
                dueTask.WaitingOnOwnerName = blockerTask.Owner.Name;
            }

            results.add(dueTask);
        }

        results.addAll(getMyAdHocWaitingTasks(currentUserId, todayDate));

        attachAttachments(results);
        return results;
    }

    /**
     * Ad hoc (non-chain) tasks a user manually marked Waiting on another
     * task via the New Task modal. Unlike chain steps, these already have
     * a concrete OwnerId up front, so no assignee resolution is needed -
     * just a bulk lookup of whatever task each one references.
     */
    private static List<DueTask> getMyAdHocWaitingTasks(Id currentUserId, Date todayDate) {
        List<Task> adHocWaitingTasks = [
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
                   CreatedById,
                   Waiting_On_Task__c,
                   Subtask_Template_Item__c,
                   Bypassed__c
            FROM Task
            WHERE Status = 'Waiting'
              AND Subtask_Template_Item__c = null
              AND OwnerId = :currentUserId
            ORDER BY CreatedDate DESC
            LIMIT 200
        ];

        Set<String> waitingOnIds = new Set<String>();
        for (Task t : adHocWaitingTasks) {
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

        List<DueTask> results = new List<DueTask>();
        for (Task t : adHocWaitingTasks) {
            DueTask dueTask = new DueTask(t, todayDate);
            Task waitingOnTask = String.isNotBlank(t.Waiting_On_Task__c)
                ? waitingOnTaskById.get(t.Waiting_On_Task__c)
                : null;

            if (waitingOnTask != null) {
                dueTask.WaitingOnSubject = waitingOnTask.Subject;
                dueTask.WaitingOnOwnerName = (waitingOnTask.Owner == null) ? null : waitingOnTask.Owner.Name;
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
        @AuraEnabled public Id      OwnerId;
        @AuraEnabled public Id      CreatedById;
        @AuraEnabled public String  WaitingOnSubject;
        @AuraEnabled public String  WaitingOnOwnerName;
        @AuraEnabled public Datetime SnoozedUntil;
        @AuraEnabled public Boolean IsSnoozed;
        @AuraEnabled public Boolean IsChainStep;
        @AuraEnabled public Boolean IsBypassed;
        @AuraEnabled public List<TaskUiController.TaskAttachmentDto> AttachmentDtos;

        public DueTask(Task t, Date todayDate) {
            Id           = t.Id;
            Subject      = t.Subject;
            ActivityDate = t.ActivityDate;
            Priority     = t.Priority;
            Status       = t.Status;
            TaskSubtype  = t.Task_Subtype__c;
            OwnerName    = t.Owner != null ? t.Owner.Name : null;
            OwnerId      = t.OwnerId;
            CreatedById  = t.CreatedById;
            IsChainStep  = t.Subtask_Template_Item__c != null;
            IsBypassed   = t.Bypassed__c;

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

        // Used where a snoozed-but-still-owned task needs to stay visible
        // (dimmed, with a "Snoozed" label) instead of just disappearing -
        // see getMyDueTasks().
        public DueTask(Task t, Date todayDate, Datetime nowDt) {
            this(t, todayDate);
            SnoozedUntil = t.Snoozed_Until__c;
            IsSnoozed    = SnoozedUntil != null && SnoozedUntil > nowDt;
        }
    }

    // Bulk-resolves attachments for every task in one query rather than one
    // per row - used to show a clickable paperclip indicator on the Task Hub
    // list without opening the Edit/Reassign modal.
    private static void attachAttachments(List<DueTask> results) {
        if (results.isEmpty()) return;

        Map<Id, DueTask> byId = new Map<Id, DueTask>();
        for (DueTask d : results) byId.put(d.Id, d);

        Map<Id, List<TaskUiController.TaskAttachmentDto>> attachmentsByTaskId = new Map<Id, List<TaskUiController.TaskAttachmentDto>>();

        for (ContentDocumentLink link : [
            SELECT LinkedEntityId, ContentDocumentId, ContentDocument.Title, ContentDocument.LatestPublishedVersionId
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :byId.keySet()
        ]) {
            if (!attachmentsByTaskId.containsKey(link.LinkedEntityId)) {
                attachmentsByTaskId.put(link.LinkedEntityId, new List<TaskUiController.TaskAttachmentDto>());
            }

            TaskUiController.TaskAttachmentDto dto = new TaskUiController.TaskAttachmentDto();
            dto.contentDocumentId = link.ContentDocumentId;
            dto.title = link.ContentDocument.Title;
            dto.latestVersionId = link.ContentDocument.LatestPublishedVersionId;
            attachmentsByTaskId.get(link.LinkedEntityId).add(dto);
        }

        for (DueTask d : results) {
            List<TaskUiController.TaskAttachmentDto> found = attachmentsByTaskId.get(d.Id);
            d.AttachmentDtos = (found != null) ? found : new List<TaskUiController.TaskAttachmentDto>();
        }
    }
}
