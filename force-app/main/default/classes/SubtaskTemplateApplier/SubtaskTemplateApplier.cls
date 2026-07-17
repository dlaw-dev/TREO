/**
 * Instantiates a full subtask chain from a Subtask_Template__c onto a Matter.
 * Pre-creates every step up front: the first step is immediately actionable
 * (Status = Open, assigned), every later step - including the master, the
 * last step in sequence - starts in Status = Waiting until
 * TaskTriggerActions.AdvanceSubtaskChainAfterComplete activates it.
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

        Boolean masterIsAlsoFirstStep = leadingItems.isEmpty();
        Id masterAssigneeId;

        if (masterIsAlsoFirstStep) {
            masterAssigneeId = resolveStaticAssignee(masterItem);

            if (masterAssigneeId == null) {
                throw new SubtaskTemplateApplierException(
                    'The first step of a template must have a Static User assignee.');
            }
        }

        Task master = new Task(
            Subject                  = masterItem.Subject__c,
            Description              = masterItem.Description__c,
            NEOS_Matter__c           = matterId,
            WhatId                   = matterId,
            Subtask_Template_Item__c = masterItem.Id,
            Status                   = masterIsAlsoFirstStep ? 'Open' : 'Waiting',
            Priority                 = 'Normal',
            OwnerId                  = masterIsAlsoFirstStep ? masterAssigneeId : UserInfo.getUserId(),
            ActivityDate             = masterIsAlsoFirstStep ? Date.today().addDays(7) : null
        );
        insert master;

        master.Parent_Task__c = master.Id;
        update master;

        if (!leadingItems.isEmpty()) {
            Id firstAssigneeId = resolveStaticAssignee(leadingItems[0]);

            if (firstAssigneeId == null) {
                throw new SubtaskTemplateApplierException(
                    'The first step of a template must have a Static User assignee.');
            }

            List<Task> tasksToInsert = new List<Task>();

            for (Integer i = 0; i < leadingItems.size(); i++) {
                Subtask_Template_Item__c item = leadingItems[i];
                Boolean isFirst = (i == 0);

                tasksToInsert.add(new Task(
                    Subject                  = item.Subject__c,
                    Description              = item.Description__c,
                    NEOS_Matter__c           = matterId,
                    WhatId                   = matterId,
                    Subtask_Template_Item__c = item.Id,
                    Parent_Task__c           = master.Id,
                    Status                   = isFirst ? 'Open' : 'Waiting',
                    Priority                 = 'Normal',
                    OwnerId                  = isFirst ? firstAssigneeId : UserInfo.getUserId(),
                    ActivityDate             = isFirst ? Date.today().addDays(7) : null
                ));
            }

            insert tasksToInsert;
        }

        return master.Id;
    }

    private static Id resolveStaticAssignee(Subtask_Template_Item__c item) {
        return item.Assignee_Type__c == 'Static User' ? item.Static_Assignee__c : null;
    }
}
