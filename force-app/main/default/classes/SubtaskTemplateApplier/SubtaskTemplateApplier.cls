/**
 * Instantiates a full subtask chain from a Subtask_Template__c onto a Matter.
 * Pre-creates every step up front: the first step is immediately actionable
 * (Status = Open, assigned), every later step - including the master, the
 * last step in sequence - starts in Status = Waiting until
 * TaskTriggerActions.AdvanceSubtaskChainAfterComplete activates it.
 *
 * A step's assignee - static User, or dynamic field read off the Matter -
 * resolves the same way whether it's the first step or a later one, via
 * SubtaskAssigneeResolver. A dynamic first step is valid as long as the
 * Matter field it reads is already populated (e.g. a chain applied after an
 * earlier chain already set that field).
 */
public with sharing class SubtaskTemplateApplier {

    public class SubtaskTemplateApplierException extends Exception {}

    public static Id apply(Id templateId, Id matterId) {
        List<Subtask_Template_Item__c> items = [
            SELECT Id, Sequence_Order__c, Subject__c, Description__c,
                   Assignee_Type__c, Static_Assignee__c, Dynamic_Assignee_Field__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];

        if (items.isEmpty()) {
            throw new SubtaskTemplateApplierException('This template has no steps.');
        }

        List<Subtask_Template_Item__c> leadingItems = items.clone();
        Subtask_Template_Item__c masterItem = leadingItems.remove(leadingItems.size() - 1);
        Subtask_Template_Item__c firstStepItem = leadingItems.isEmpty() ? masterItem : leadingItems[0];

        // Resolve every step's assignee up front, not just the first step's.
        // A later step's dynamic field is usually already set on the Matter
        // (e.g. LSS_Paralegal__c), so showing its real assignee immediately -
        // even while the step is still Waiting - beats showing whoever
        // applied the template as a misleading placeholder owner. When a
        // field genuinely isn't resolvable yet (e.g. it's set by an earlier
        // step in a different chain), we still fall back to the applier;
        // AdvanceSubtaskChainAfterComplete re-resolves for real at
        // activation time regardless, so an early guess is never load-bearing.
        Map<Id, Subtask_Template_Item__c> keyToItem = new Map<Id, Subtask_Template_Item__c>();
        Map<Id, Id> keyToMatterId = new Map<Id, Id>();
        for (Subtask_Template_Item__c item : items) {
            keyToItem.put(item.Id, item);
            keyToMatterId.put(item.Id, matterId);
        }
        Map<Id, Id> resolvedAssignees = SubtaskAssigneeResolver.resolveAssigneesBulk(keyToItem, keyToMatterId);

        Id firstAssigneeId = resolvedAssignees.get(firstStepItem.Id);

        if (firstAssigneeId == null) {
            throw new SubtaskTemplateApplierException(firstStepErrorMessage(firstStepItem));
        }

        Boolean masterIsAlsoFirstStep = leadingItems.isEmpty();
        Id masterAssigneeId = masterIsAlsoFirstStep
            ? firstAssigneeId
            : coalesceAssignee(resolvedAssignees.get(masterItem.Id));

        Task master = new Task(
            Subject                  = masterItem.Subject__c,
            Description              = masterItem.Description__c,
            NEOS_Matter__c           = matterId,
            WhatId                   = matterId,
            Subtask_Template_Item__c = masterItem.Id,
            Status                   = masterIsAlsoFirstStep ? 'Open' : 'Waiting',
            Priority                 = 'Normal',
            OwnerId                  = masterAssigneeId,
            ActivityDate             = masterIsAlsoFirstStep ? Date.today().addDays(7) : null
        );
        insert master;

        master.Parent_Task__c = master.Id;
        update master;

        if (!leadingItems.isEmpty()) {
            List<Task> tasksToInsert = new List<Task>();

            for (Integer i = 0; i < leadingItems.size(); i++) {
                Subtask_Template_Item__c item = leadingItems[i];
                Boolean isFirst = (i == 0);
                Id assigneeId = isFirst ? firstAssigneeId : coalesceAssignee(resolvedAssignees.get(item.Id));

                tasksToInsert.add(new Task(
                    Subject                  = item.Subject__c,
                    Description              = item.Description__c,
                    NEOS_Matter__c           = matterId,
                    WhatId                   = matterId,
                    Subtask_Template_Item__c = item.Id,
                    Parent_Task__c           = master.Id,
                    Status                   = isFirst ? 'Open' : 'Waiting',
                    Priority                 = 'Normal',
                    OwnerId                  = assigneeId,
                    ActivityDate             = isFirst ? Date.today().addDays(7) : null
                ));
            }

            insert tasksToInsert;
        }

        return master.Id;
    }

    private static Id coalesceAssignee(Id resolvedId) {
        return resolvedId != null ? resolvedId : UserInfo.getUserId();
    }

    private static String firstStepErrorMessage(Subtask_Template_Item__c item) {
        if (item.Assignee_Type__c == 'Dynamic Matter Field') {
            return 'Cannot apply this template: the Matter\'s "' + item.Dynamic_Assignee_Field__c
                + '" field must be set before "' + item.Subject__c + '" can be assigned.';
        }

        return 'Cannot apply this template: the first step has no assignee configured.';
    }
}
