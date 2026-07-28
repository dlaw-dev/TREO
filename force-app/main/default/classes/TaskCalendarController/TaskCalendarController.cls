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
                   Waiting_On_Task__c,
                   CreatedById,
                   Subtask_Template_Item__c,
                   Bypassed__c
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

        Map<Id, List<TaskUiController.TaskAttachmentDto>> attachmentsByTaskId = attachmentsFor(
            new Map<Id, Task>(tasks).keySet()
        );

        List<TaskRow> rows = new List<TaskRow>();
        for (Task t : tasks) {
            Task waitingOnTask = String.isNotBlank(t.Waiting_On_Task__c)
                ? waitingOnTaskById.get(t.Waiting_On_Task__c)
                : null;
            rows.add(new TaskRow(t, waitingOnTask, attachmentsByTaskId.get(t.Id)));
        }

        return rows;
    }

    // Bulk-resolves attachments for every task in one query rather than one
    // per row - used to show a clickable paperclip indicator on the list
    // without opening the Edit/Reassign modal.
    private static Map<Id, List<TaskUiController.TaskAttachmentDto>> attachmentsFor(Set<Id> taskIds) {
        Map<Id, List<TaskUiController.TaskAttachmentDto>> results = new Map<Id, List<TaskUiController.TaskAttachmentDto>>();

        // ContentDocumentLink enforces "filter by a single Id or an IN list
        // of Ids" at the query-plan level - an empty IN list still trips
        // that restriction (unlike a normal SOQL IN, which would just match
        // nothing), so this has to short-circuit before the query runs
        // rather than relying on the query itself to return zero rows. This
        // is reachable in practice: a Matter with zero Tasks visible to the
        // running user's sharing (e.g. a different profile/OWD) means
        // getTasksForMatter() returns nothing, and taskIds arrives empty.
        if (taskIds.isEmpty()) {
            return results;
        }

        for (ContentDocumentLink link : [
            SELECT LinkedEntityId, ContentDocumentId, ContentDocument.Title, ContentDocument.LatestPublishedVersionId
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :taskIds
        ]) {
            if (!results.containsKey(link.LinkedEntityId)) {
                results.put(link.LinkedEntityId, new List<TaskUiController.TaskAttachmentDto>());
            }

            TaskUiController.TaskAttachmentDto dto = new TaskUiController.TaskAttachmentDto();
            dto.contentDocumentId = link.ContentDocumentId;
            dto.title = link.ContentDocument.Title;
            dto.latestVersionId = link.ContentDocument.LatestPublishedVersionId;
            results.get(link.LinkedEntityId).add(dto);
        }

        return results;
    }

    public class TaskRow {
        @AuraEnabled public Id     Id;
        @AuraEnabled public String Subject;
        @AuraEnabled public String Status;
        @AuraEnabled public String Priority;
        @AuraEnabled public Date   ActivityDate;
        @AuraEnabled public Id     OwnerId;
        @AuraEnabled public String OwnerName;
        @AuraEnabled public Id     CreatedById;
        @AuraEnabled public String TaskSubtype;
        @AuraEnabled public String TaskSubtypeIfOther;
        @AuraEnabled public String InternalExternalType;
        @AuraEnabled public String Description;
        @AuraEnabled public String WaitingOnSubject;
        @AuraEnabled public String WaitingOnOwnerName;
        @AuraEnabled public Boolean IsChainStep;
        @AuraEnabled public Boolean IsBypassed;
        // Deliberately not named "Attachments" - a plain custom Apex class
        // property with that exact name silently ends up null after an
        // @AuraEnabled round-trip (confirmed empirically - looks like a
        // collision with the standard Attachment child-relationship name).
        @AuraEnabled public List<TaskUiController.TaskAttachmentDto> AttachmentDtos;

        public TaskRow(Task t, Task waitingOnTask, List<TaskUiController.TaskAttachmentDto> attachments) {
            Id                  = t.Id;
            Subject             = t.Subject;
            Status              = t.Status;
            Priority            = t.Priority;
            ActivityDate        = t.ActivityDate;
            OwnerId             = t.OwnerId;
            OwnerName           = (t.Owner == null) ? null : t.Owner.Name;
            CreatedById         = t.CreatedById;
            TaskSubtype         = t.Task_Subtype__c;
            TaskSubtypeIfOther  = t.Task_Subtype_If_Other__c;
            InternalExternalType = t.Internal_External_Type__c;
            Description         = t.Description;
            AttachmentDtos      = (attachments != null) ? attachments : new List<TaskUiController.TaskAttachmentDto>();
            IsChainStep         = t.Subtask_Template_Item__c != null;
            IsBypassed          = t.Bypassed__c;

            if (waitingOnTask != null) {
                WaitingOnSubject   = waitingOnTask.Subject;
                WaitingOnOwnerName = (waitingOnTask.Owner == null) ? null : waitingOnTask.Owner.Name;
            }
        }
    }
}
