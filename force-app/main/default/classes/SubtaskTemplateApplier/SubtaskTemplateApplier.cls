/**
 * Instantiates a full subtask chain from a Subtask_Template__c onto a Matter.
 * Pre-creates every step up front: any step with no Depends_On_Step__c is
 * immediately actionable (Status = Open, assigned) - a template can have
 * more than one such "entry" step, which all open together. Every other
 * step starts in Status = Waiting until
 * TaskTriggerActions.AdvanceSubtaskChainAfterComplete activates it once its
 * specific dependency completes.
 *
 * A step's assignee - static User, or dynamic field read off the Matter -
 * resolves the same way whether it's an entry step or a later one, via
 * SubtaskAssigneeResolver. A dynamic entry step is valid as long as the
 * Matter field it reads is already populated (e.g. a chain applied after an
 * earlier chain already set that field).
 */
public with sharing class SubtaskTemplateApplier {

    public class SubtaskTemplateApplierException extends Exception {}

    public static Id apply(Id templateId, Id matterId) {
        List<Subtask_Template_Item__c> items = [
            SELECT Id, Sequence_Order__c, Subject__c, Description__c,
                   Assignee_Type__c, Static_Assignee__c, Dynamic_Assignee_Field__c,
                   Depends_On_Step__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];

        if (items.isEmpty()) {
            throw new SubtaskTemplateApplierException('This template has no steps.');
        }

        List<Subtask_Template_Item__c> entryItems = new List<Subtask_Template_Item__c>();
        for (Subtask_Template_Item__c item : items) {
            if (item.Depends_On_Step__c == null) entryItems.add(item);
        }

        if (entryItems.isEmpty()) {
            throw new SubtaskTemplateApplierException('This template has no starting step - every step depends on another.');
        }

        // Resolve every step's assignee up front, not just the entry steps'.
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

        // Every entry step must be immediately assignable - unlike a
        // dependent step, there's no predecessor completion to re-resolve
        // it against later, so an unresolvable entry step blocks the whole
        // template from being applied at all.
        for (Subtask_Template_Item__c entryItem : entryItems) {
            if (resolvedAssignees.get(entryItem.Id) == null) {
                throw new SubtaskTemplateApplierException(firstStepErrorMessage(entryItem));
            }
        }

        // The last item by sequence anchors the chain (self-referencing
        // Parent_Task__c) - purely a grouping Id shared by every sibling
        // task now, not necessarily "the final step" in the flow.
        List<Subtask_Template_Item__c> nonMasterItems = items.clone();
        Subtask_Template_Item__c masterItem = nonMasterItems.remove(nonMasterItems.size() - 1);

        Boolean masterIsEntry = masterItem.Depends_On_Step__c == null;
        Id masterAssigneeId = masterIsEntry
            ? resolvedAssignees.get(masterItem.Id)
            : coalesceAssignee(resolvedAssignees.get(masterItem.Id));

        Task master = new Task(
            Subject                  = masterItem.Subject__c,
            Description              = masterItem.Description__c,
            NEOS_Matter__c           = matterId,
            WhatId                   = matterId,
            Subtask_Template_Item__c = masterItem.Id,
            Status                   = masterIsEntry ? 'Open' : 'Waiting',
            Priority                 = 'Normal',
            OwnerId                  = masterAssigneeId,
            ActivityDate             = masterIsEntry ? Date.today().addDays(7) : null
        );
        insert master;

        master.Parent_Task__c = master.Id;
        update master;

        if (!nonMasterItems.isEmpty()) {
            List<Task> tasksToInsert = new List<Task>();

            for (Subtask_Template_Item__c item : nonMasterItems) {
                Boolean isEntry = item.Depends_On_Step__c == null;
                Id assigneeId = isEntry ? resolvedAssignees.get(item.Id) : coalesceAssignee(resolvedAssignees.get(item.Id));

                tasksToInsert.add(new Task(
                    Subject                  = item.Subject__c,
                    Description              = item.Description__c,
                    NEOS_Matter__c           = matterId,
                    WhatId                   = matterId,
                    Subtask_Template_Item__c = item.Id,
                    Parent_Task__c           = master.Id,
                    Status                   = isEntry ? 'Open' : 'Waiting',
                    Priority                 = 'Normal',
                    OwnerId                  = assigneeId,
                    ActivityDate             = isEntry ? Date.today().addDays(7) : null
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

        return 'Cannot apply this template: "' + item.Subject__c + '" (a starting step) has no assignee configured.';
    }
}
