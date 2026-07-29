public with sharing class TaskUiController {

    private static final Set<String> ALLOWED_PROFILE_NAMES = new Set<String>{
        'System Administrator',
        'TREO Service Agent',
        'TREO Service Supervisor'
    };

    @AuraEnabled
    public static Id saveTask(
        Id relatedId,
        List<Id> ownerIds,
        String subject,
        Date dueDate,
        String status,
        String priority,
        String description,
        String taskSubtype,
        String taskSubtypeIfOther,
        String internalExternalType,
        List<String> reminderTypes,
        Id waitingOnTaskId,
        List<Map<String, String>> attachments,
        Id reviewerId
    ) {
        try {

            if (ownerIds == null || ownerIds.isEmpty()) {
                throw new AuraHandledException('Please select an Assignee.');
            }

            // Validate all selected owners in one query
            Map<Id, User> validOwners = new Map<Id, User>([
                SELECT Id, Email
                FROM User
                WHERE Id IN :ownerIds
                  AND IsActive = true
                  AND UserType = 'Standard'
                  AND Profile.Name IN :ALLOWED_PROFILE_NAMES
            ]);

            if (validOwners.isEmpty()) {
                throw new AuraHandledException('Selected assignee is not allowed.');
            }

            // ===============================
            // Native Reminder Logic
            // ===============================
            Boolean setNativeReminder = (dueDate != null);
            Datetime nativeReminderDT;

            if (setNativeReminder) {

                Datetime earliestDayOf;

                if (reminderTypes != null) {
                    for (String typeLabel : reminderTypes) {
                        if (typeLabel != null && typeLabel.contains('Day Of')) {
                            Datetime dt = calculateReminderDatetime(dueDate, typeLabel);

                            if (dt != null &&
                                (earliestDayOf == null || dt.getTime() < earliestDayOf.getTime())) {
                                earliestDayOf = dt;
                            }
                        }
                    }
                }

                if (earliestDayOf != null) {
                    nativeReminderDT = earliestDayOf;
                } else {
                    nativeReminderDT = Datetime.newInstance(
                        dueDate,
                        Time.newInstance(9, 0, 0, 0)
                    );
                }
            }

            // First valid owner owns the task
            Id primaryOwnerId;
            for (Id oid : ownerIds) {
                if (validOwners.containsKey(oid)) { primaryOwnerId = oid; break; }
            }

            validateReviewer(reviewerId, primaryOwnerId);

            Task t = new Task(
                WhatId                    = relatedId,
                NEOS_Matter__c            = relatedId,
                OwnerId                   = primaryOwnerId,
                Subject                   = subject,
                ActivityDate              = dueDate,
                Status                    = status,
                Priority                  = priority,
                Description               = description,
                Task_Subtype__c           = taskSubtype,
                Task_Subtype_If_Other__c  = taskSubtypeIfOther,
                Internal_External_Type__c = internalExternalType,
                IsReminderSet             = setNativeReminder,
                ReminderDateTime          = nativeReminderDT,
                Waiting_On_Task__c        = waitingOnTaskId,
                Reviewer__c               = reviewerId
            );

            insert t;

            insertAttachments(t.Id, attachments);

            // ===============================
            // Custom Reminder Records — one set per assignee
            // ===============================
            if (reminderTypes != null && dueDate != null && !reminderTypes.isEmpty()) {

                List<Task_Reminder__c> reminders = new List<Task_Reminder__c>();

                for (Id oid : ownerIds) {
                    User owner = validOwners.get(oid);
                    if (owner == null) continue;

                    for (String typeLabel : reminderTypes) {
                        Datetime reminderDT = calculateReminderDatetime(dueDate, typeLabel);

                        if (reminderDT != null) {
                            reminders.add(new Task_Reminder__c(
                                Task_ID__c            = t.Id,
                                Task_Name__c          = t.Subject,
                                Reminder_Type__c      = typeLabel,
                                Reminder_Date_Time__c = reminderDT,
                                Is_Sent__c            = false,
                                Recipient_User_Id__c  = oid,
                                Recipient_Email__c    = owner.Email
                            ));
                        }
                    }
                }

                if (!reminders.isEmpty()) insert reminders;
            }

            return t.Id;

        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error saving Task: ' + e.getMessage());
        }
    }

    public class TaskAttachmentDto {
        @AuraEnabled public Id contentDocumentId;
        @AuraEnabled public String title;
        @AuraEnabled public Id latestVersionId;
    }

    public class TaskForEditDto {
        @AuraEnabled public Id id;
        @AuraEnabled public String subject;
        @AuraEnabled public Date dueDate;
        @AuraEnabled public String status;
        @AuraEnabled public String priority;
        @AuraEnabled public String description;
        @AuraEnabled public Id ownerId;
        @AuraEnabled public String ownerName;
        @AuraEnabled public Id matterId;
        @AuraEnabled public Id waitingOnTaskId;
        @AuraEnabled public String waitingOnTaskSubject;
        @AuraEnabled public Boolean isChainStep;
        @AuraEnabled public String chainPredecessorSubject;
        @AuraEnabled public List<TaskAttachmentDto> attachments;
        @AuraEnabled public Id reviewerId;
        @AuraEnabled public String reviewerName;
        @AuraEnabled public String reviewFeedback;
    }

    /**
     * Loads an existing Task for the Edit/Reassign flow in the New Task
     * modal - the modal pre-fills every field from this DTO rather than
     * relying on whatever summary fields the calling list view already had,
     * so it works the same whether opened from the Matter page or the
     * (non-matter-scoped) Task Hub.
     */
    @AuraEnabled(cacheable=false)
    public static TaskForEditDto getTaskForEdit(Id taskId) {
        Task t = [
            SELECT Id, Subject, ActivityDate, Status, Priority, Description,
                   OwnerId, Owner.Name, NEOS_Matter__c, Waiting_On_Task__c,
                   Subtask_Template_Item__c, Subtask_Template_Item__r.Depends_On_Step__c,
                   Parent_Task__c, CreatedById, Reviewer__c, Reviewer__r.Name, Review_Feedback__c
            FROM Task
            WHERE Id = :taskId
            LIMIT 1
        ];

        assertCanEditTask(t.OwnerId, t.CreatedById);

        TaskForEditDto dto = new TaskForEditDto();
        dto.id = t.Id;
        dto.subject = t.Subject;
        dto.dueDate = t.ActivityDate;
        dto.status = t.Status;
        dto.priority = t.Priority;
        dto.description = t.Description;
        dto.ownerId = t.OwnerId;
        dto.ownerName = t.Owner?.Name;
        dto.matterId = t.NEOS_Matter__c;
        dto.reviewerId = t.Reviewer__c;
        dto.reviewerName = t.Reviewer__r?.Name;
        dto.reviewFeedback = t.Review_Feedback__c;

        // Waiting_On_Task__c is a Text field (not a real Lookup) - Task can't
        // self-reference via a proper relationship on the Activity object -
        // so the referenced task's Subject needs its own lookup.
        if (String.isNotBlank(t.Waiting_On_Task__c)) {
            dto.waitingOnTaskId = t.Waiting_On_Task__c;
            List<Task> waitingOn = [SELECT Subject FROM Task WHERE Id = :t.Waiting_On_Task__c LIMIT 1];
            if (!waitingOn.isEmpty()) dto.waitingOnTaskSubject = waitingOn[0].Subject;
        }

        // A subtask-template chain step being Waiting has nothing to do with
        // Waiting_On_Task__c (that field is only for ad hoc manually-created
        // tasks) - it's blocked on the previous step in its own chain
        // completing. Surface that step's Subject read-only, purely so the
        // Waiting-On area isn't confusingly blank; this is never editable or
        // written back on save.
        if (t.Subtask_Template_Item__c != null) {
            dto.isChainStep = true;
            dto.chainPredecessorSubject = getChainPredecessorSubject(
                t.Subtask_Template_Item__r.Depends_On_Step__c, t.Parent_Task__c);
        }

        dto.attachments = new List<TaskAttachmentDto>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId, ContentDocument.Title, ContentDocument.LatestPublishedVersionId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :taskId
        ]) {
            TaskAttachmentDto a = new TaskAttachmentDto();
            a.contentDocumentId = link.ContentDocumentId;
            a.title = link.ContentDocument.Title;
            a.latestVersionId = link.ContentDocument.LatestPublishedVersionId;
            dto.attachments.add(a);
        }

        return dto;
    }

    // Follows the explicit Depends_On_Step__c edge to the sibling Task
    // instantiated from that step in this same chain run (same
    // Parent_Task__c) - null dependsOnItemId means this is an entry step
    // with no predecessor at all.
    private static String getChainPredecessorSubject(Id dependsOnItemId, Id chainId) {
        if (dependsOnItemId == null || chainId == null) return null;

        List<Task> predecessorTasks = [
            SELECT Subject
            FROM Task
            WHERE Subtask_Template_Item__c = :dependsOnItemId
              AND Parent_Task__c = :chainId
            LIMIT 1
        ];
        return predecessorTasks.isEmpty() ? null : predecessorTasks[0].Subject;
    }

    // Only the task's current assignee or its original assigner (creator)
    // may edit/reassign it - per management's requirement, this is stricter
    // than plain record-sharing visibility.
    private static void assertCanEditTask(Id currentOwnerId, Id createdById) {
        Id runningUserId = UserInfo.getUserId();
        if (runningUserId != currentOwnerId && runningUserId != createdById) {
            throw new AuraHandledException('Only the person this task is assigned to, or the person who assigned it, can edit or reassign it.');
        }
    }

    /**
     * Updates an existing Task in place (Edit/Reassign) - deliberately
     * leaves Task_Subtype__c, Internal_External_Type__c, and every native/
     * custom reminder field untouched, since this form has no UI for them
     * and Apex `update` only writes fields explicitly set on the sObject.
     */
    @AuraEnabled
    public static Id updateTask(
        Id taskId,
        Id ownerId,
        String subject,
        Date dueDate,
        String status,
        String priority,
        String description,
        Id waitingOnTaskId,
        List<Map<String, String>> newAttachments,
        Id reviewerId
    ) {
        try {
            if (ownerId == null) {
                throw new AuraHandledException('Please select an Assignee.');
            }

            Task existing = [SELECT OwnerId, CreatedById, Status FROM Task WHERE Id = :taskId LIMIT 1];
            assertCanEditTask(existing.OwnerId, existing.CreatedById);

            List<User> validOwners = [
                SELECT Id
                FROM User
                WHERE Id = :ownerId
                  AND IsActive = true
                  AND UserType = 'Standard'
                  AND Profile.Name IN :ALLOWED_PROFILE_NAMES
            ];

            if (validOwners.isEmpty()) {
                throw new AuraHandledException('Selected assignee is not allowed.');
            }

            validateReviewer(reviewerId, ownerId);

            Task toUpdate = new Task(
                Id                 = taskId,
                OwnerId             = ownerId,
                Subject             = subject,
                ActivityDate        = dueDate,
                Status              = status,
                Priority            = priority,
                Description         = description,
                Waiting_On_Task__c  = waitingOnTaskId,
                Reviewer__c         = reviewerId
            );

            // A not-yet-active chain step (Status = Waiting) with a dynamic
            // assignee gets its OwnerId re-resolved and overwritten by
            // AdvanceSubtaskChainAfterComplete when it activates - flagging
            // a manual reassignment here tells that trigger to leave this
            // one alone instead of silently clobbering it later.
            if (ownerId != existing.OwnerId && existing.Status == 'Waiting') {
                toUpdate.Manually_Reassigned__c = true;
            }

            update toUpdate;

            insertAttachments(taskId, newAttachments);

            return taskId;

        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error updating Task: ' + e.getMessage());
        }
    }

    /**
     * Skips a subtask-chain step without actually completing the work -
     * marks it Completed (so the existing chain-advance trigger activates
     * the next step exactly as it would for a real completion) plus
     * Bypassed__c, purely so the UI/reporting can tell "skipped" apart from
     * "actually done". Restricted to real chain steps - an ad hoc task has
     * no "next step" for skipping to meaningfully unblock.
     */
    @AuraEnabled
    public static void bypassTask(Id taskId) {
        try {
            Task t = [
                SELECT OwnerId, CreatedById, Subtask_Template_Item__c, Status
                FROM Task
                WHERE Id = :taskId
                LIMIT 1
            ];

            assertCanEditTask(t.OwnerId, t.CreatedById);

            if (t.Subtask_Template_Item__c == null) {
                throw new AuraHandledException('Only steps in a task chain can be skipped.');
            }

            if (t.Status == 'Completed') {
                throw new AuraHandledException('This step is already complete.');
            }

            update new Task(
                Id          = taskId,
                Status      = 'Completed',
                Bypassed__c = true
            );
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error skipping step: ' + e.getMessage());
        }
    }

    private static void insertAttachments(Id taskId, List<Map<String, String>> attachments) {
        if (attachments == null || attachments.isEmpty()) return;

        List<ContentVersion> cvs = new List<ContentVersion>();
        for (Map<String, String> file : attachments) {
            String base64Data = file.get('base64Data');
            if (String.isBlank(base64Data)) continue;

            cvs.add(new ContentVersion(
                Title = file.get('name'),
                PathOnClient = file.get('name'),
                VersionData = EncodingUtil.base64Decode(base64Data),
                FirstPublishLocationId = taskId
            ));
        }

        if (!cvs.isEmpty()) insert cvs;
    }

    /**
     * Searches open (non-Completed) tasks on a Matter, for the "Waiting On"
     * task picker in the New Task modal - lets a manually-created task
     * reference another task on the same matter it's blocked on.
     */
    @AuraEnabled(cacheable=false)
    public static List<Task> searchTasksForMatter(Id matterId, String keyword) {
        if (matterId == null) return new List<Task>();

        if (String.isBlank(keyword)) {
            return [
                SELECT Id, Subject, Owner.Name, ActivityDate, Priority, Status
                FROM Task
                WHERE NEOS_Matter__c = :matterId
                  AND Status != 'Completed'
                ORDER BY CreatedDate DESC
                LIMIT 20
            ];
        }

        String k = '%' + keyword.trim() + '%';

        return [
            SELECT Id, Subject, Owner.Name, ActivityDate, Priority, Status
            FROM Task
            WHERE NEOS_Matter__c = :matterId
              AND Status != 'Completed'
              AND Subject LIKE :k
            ORDER BY CreatedDate DESC
            LIMIT 20
        ];
    }

    /**
     * Completes a Task, returning true when this was the last step of a
     * subtask chain - so the UI can celebrate finishing the whole chain
     * rather than just checking off one more item. When a Reviewer is set,
     * this doesn't finish the task at all - it hands off to Status =
     * Pending Review instead, and only that Reviewer's approveTask() call
     * actually marks it Completed (and so only then can the chain advance -
     * Pending Review still counts as "not done" for isEntireChainComplete
     * and never satisfies the Completed transition the chain trigger looks
     * for).
     */
    @AuraEnabled
    public static Boolean completeTask(Id taskId) {
        try {
            Task t = [SELECT Id, Subtask_Template_Item__c, Parent_Task__c, Status FROM Task WHERE Id = :taskId LIMIT 1];

            if (t.Status == 'Completed' || t.Status == 'Pending Review') {
                throw new AuraHandledException('This task is already ' + (t.Status == 'Completed' ? 'complete' : 'pending review') + '.');
            }

            // If a Reviewer is set, TaskTriggerActions.RedirectReviewedCompletionsBeforeUpdate
            // redirects this to Pending Review instead - handled once, in the
            // trigger, so every completion path (not just this method) gets it.
            t.Status = 'Completed';
            update t;

            return t.Subtask_Template_Item__c != null && isEntireChainComplete(t.Parent_Task__c);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error completing task: ' + e.getMessage());
        }
    }

    /**
     * Approves a task pending this user's review - the only way a
     * Pending Review task actually reaches Completed (and so the only way
     * its chain, if any, can advance). Restricted to the Task's own
     * Reviewer__c, the same single-person-authority pattern used for
     * Edit/Reassign and Skip.
     */
    @AuraEnabled
    public static Boolean approveTask(Id taskId) {
        try {
            Task t = [SELECT Id, Subtask_Template_Item__c, Parent_Task__c, Reviewer__c, Status, CreatedById FROM Task WHERE Id = :taskId LIMIT 1];

            assertCanReview(t.Reviewer__c, t.CreatedById);

            if (t.Status != 'Pending Review') {
                throw new AuraHandledException('This task is not pending review.');
            }

            t.Status = 'Completed';
            update t;

            return t.Subtask_Template_Item__c != null && isEntireChainComplete(t.Parent_Task__c);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error approving task: ' + e.getMessage());
        }
    }

    /**
     * Sends a task pending this user's review back to the assignee -
     * Status returns to Open (so it reappears as actionable) and the
     * reason is stored so the assignee can see why. Restricted to the
     * Task's own Reviewer__c.
     */
    @AuraEnabled
    public static void sendBackTask(Id taskId, String reason) {
        try {
            Task t = [SELECT Id, Reviewer__c, Status, CreatedById FROM Task WHERE Id = :taskId LIMIT 1];

            assertCanReview(t.Reviewer__c, t.CreatedById);

            if (t.Status != 'Pending Review') {
                throw new AuraHandledException('This task is not pending review.');
            }

            update new Task(
                Id                  = taskId,
                Status              = 'Open',
                Review_Feedback__c  = String.isBlank(reason) ? reason : reason.left(255)
            );
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error sending task back: ' + e.getMessage());
        }
    }

    // The assigned Reviewer is normally the only one who may act - but if
    // that person is no longer active (or Reviewer__c was cleared) the task
    // would otherwise be permanently stuck in Pending Review with no one
    // able to move it, so the task's creator (who set up the review in the
    // first place) can step in as a fallback.
    private static void assertCanReview(Id reviewerId, Id createdById) {
        Id runningUserId = UserInfo.getUserId();

        if (reviewerId != null && runningUserId == reviewerId) {
            return;
        }

        Boolean reviewerStillActive = false;
        if (reviewerId != null) {
            Integer activeCount = [SELECT COUNT() FROM User WHERE Id = :reviewerId AND IsActive = true];
            reviewerStillActive = activeCount > 0;
        }

        if (!reviewerStillActive && runningUserId == createdById) {
            return;
        }

        throw new AuraHandledException('Only the assigned reviewer can approve or send back this task.');
    }

    // Static User assignee-style eligibility check (active, standard,
    // allowed profile) applied to the optional Reviewer, plus a guard
    // against the assignee reviewing their own work - the whole point of a
    // reviewer is a second set of eyes.
    private static void validateReviewer(Id reviewerId, Id ownerId) {
        if (reviewerId == null) return;

        if (reviewerId == ownerId) {
            throw new AuraHandledException('The Reviewer can\'t be the same person as the Assignee.');
        }

        List<User> validReviewers = [
            SELECT Id
            FROM User
            WHERE Id = :reviewerId
              AND IsActive = true
              AND UserType = 'Standard'
              AND Profile.Name IN :ALLOWED_PROFILE_NAMES
        ];

        if (validReviewers.isEmpty()) {
            throw new AuraHandledException('Selected reviewer is not allowed.');
        }
    }

    // Whether every step in this chain (every Task sharing this
    // Parent_Task__c) is Completed - topology-independent, so it's correct
    // whether the chain is a simple line or has several branches/leaves
    // (unlike checking "is there a template item with a later sequence
    // number", which only ever recognized a single linear leaf).
    private static Boolean isEntireChainComplete(Id chainId) {
        if (chainId == null) return false;

        Integer remaining = [
            SELECT COUNT()
            FROM Task
            WHERE Parent_Task__c = :chainId
              AND Status != 'Completed'
        ];

        return remaining == 0;
    }

    // ======================================
    // Reminder Date Calculation Logic
    // ======================================
    private static Datetime calculateReminderDatetime(Date dueDate, String typeLabel) {

        if (dueDate == null || String.isBlank(typeLabel)) {
            return null;
        }

        Time defaultTime = Time.newInstance(9, 0, 0, 0);

        // 1 Month Before
        if (typeLabel == '1 Month Before') {
            return Datetime.newInstance(
                dueDate.addMonths(-1),
                defaultTime
            );
        }

        // 1 Week Before
        if (typeLabel == '1 Week Before') {
            return Datetime.newInstance(
                dueDate.addDays(-7),
                defaultTime
            );
        }

        // X Days Before (6–1)
        if (typeLabel.contains('Days Before') ||
            typeLabel.contains('Day Before')) {

            try {
                Integer daysBefore =
                    Integer.valueOf(typeLabel.split(' ')[0]);

                return Datetime.newInstance(
                    dueDate.addDays(-daysBefore),
                    defaultTime
                );

            } catch (Exception e) {
                return null;
            }
        }

        // Day Of (6:00 AM – 6:00 PM etc.)
        if (typeLabel.contains('Day Of')) {

            String timeString = typeLabel.replace(' Day Of', '');
            Boolean isPM = timeString.contains('PM');

            timeString = timeString.replace(' AM', '')
                                   .replace(' PM', '');

            List<String> parts = timeString.split(':');
            if (parts.size() != 2) return null;

            Integer hour = Integer.valueOf(parts[0]);
            Integer minute = Integer.valueOf(parts[1]);

            // Convert to 24-hour format
            if (isPM && hour != 12) hour += 12;
            if (!isPM && hour == 12) hour = 0;

            return Datetime.newInstance(
                dueDate,
                Time.newInstance(hour, minute, 0, 0)
            );
        }

        return null;
    }
}
