/**
 * Container for Task trigger automation rules. Each rule is a small inner
 * class implementing TaskTriggerAction, registered with TaskTriggerHandler.
 * Add new rules here as inner classes rather than new top-level classes.
 *
 * The subtask chain rules below only ever act on tasks with
 * Subtask_Template_Item__c populated - manually-created tasks are always
 * left completely untouched.
 */
public with sharing class TaskTriggerActions {

    public class ValidateNextStepReadyBeforeComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completingSubtasks = new List<Task>();

            for (Task t : newRecords) {
                Task oldTask = oldMap.get(t.Id);

                if (t.Subtask_Template_Item__c != null
                    && t.Status == 'Completed'
                    && oldTask.Status != 'Completed') {
                    completingSubtasks.add(t);
                }
            }

            if (completingSubtasks.isEmpty()) {
                return;
            }

            Map<Id, Subtask_Template_Item__c> currentItemsById = queryItems(completingSubtasks);

            for (Task t : completingSubtasks) {
                Subtask_Template_Item__c currentItem = currentItemsById.get(t.Subtask_Template_Item__c);

                if (currentItem == null) {
                    continue;
                }

                Subtask_Template_Item__c nextItem = getNextItem(currentItem);

                if (nextItem == null || nextItem.Assignee_Type__c != 'Dynamic Matter Field') {
                    continue;
                }

                Object fieldValue = readMatterField(t.NEOS_Matter__c, nextItem.Dynamic_Assignee_Field__c);

                if (fieldValue == null) {
                    t.addError('Please set "' + nextItem.Dynamic_Assignee_Field__c
                        + '" on the Matter before completing this task, so "'
                        + nextItem.Subject__c + '" can be assigned.');
                }
            }
        }
    }

    public class AdvanceSubtaskChainAfterComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completedSubtasks = new List<Task>();

            for (Task t : newRecords) {
                Task oldTask = oldMap.get(t.Id);

                if (t.Subtask_Template_Item__c != null
                    && t.Status == 'Completed'
                    && oldTask.Status != 'Completed') {
                    completedSubtasks.add(t);
                }
            }

            if (completedSubtasks.isEmpty()) {
                return;
            }

            Map<Id, Subtask_Template_Item__c> currentItemsById = queryItems(completedSubtasks);
            List<Task> tasksToUpdate = new List<Task>();

            for (Task t : completedSubtasks) {
                Subtask_Template_Item__c currentItem = currentItemsById.get(t.Subtask_Template_Item__c);

                if (currentItem == null) {
                    continue;
                }

                Subtask_Template_Item__c nextItem = getNextItem(currentItem);

                if (nextItem == null) {
                    continue; // this was the master / last step - chain is complete
                }

                Id assigneeId = resolveAssignee(nextItem, t.NEOS_Matter__c);

                if (assigneeId == null) {
                    continue; // the before-update safety rail should have blocked this already
                }

                Task placeholder = findPlaceholderTask(nextItem.Id, t.Parent_Task__c);

                if (placeholder == null) {
                    continue;
                }

                placeholder.OwnerId = assigneeId;
                placeholder.Status = 'Open';
                placeholder.ActivityDate = Date.today().addDays(7);
                tasksToUpdate.add(placeholder);
            }

            if (!tasksToUpdate.isEmpty()) {
                Database.update(tasksToUpdate, false);
            }
        }

        private Task findPlaceholderTask(Id templateItemId, String chainId) {
            List<Task> matches = [
                SELECT Id, OwnerId, Status, ActivityDate
                FROM Task
                WHERE Subtask_Template_Item__c = :templateItemId
                  AND Parent_Task__c = :chainId
                LIMIT 1
            ];

            return matches.isEmpty() ? null : matches[0];
        }
    }

    /* -------------------------
       Shared helpers
    -------------------------- */

    private static Map<Id, Subtask_Template_Item__c> queryItems(List<Task> tasks) {
        Set<Id> itemIds = new Set<Id>();

        for (Task t : tasks) {
            itemIds.add(t.Subtask_Template_Item__c);
        }

        return new Map<Id, Subtask_Template_Item__c>([
            SELECT Id, Subtask_Template__c, Sequence_Order__c, Subject__c
            FROM Subtask_Template_Item__c
            WHERE Id IN :itemIds
        ]);
    }

    private static Subtask_Template_Item__c getNextItem(Subtask_Template_Item__c currentItem) {
        List<Subtask_Template_Item__c> matches = [
            SELECT Id, Subject__c, Description__c, Assignee_Type__c, Static_Assignee__c, Dynamic_Assignee_Field__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :currentItem.Subtask_Template__c
              AND Sequence_Order__c > :currentItem.Sequence_Order__c
            ORDER BY Sequence_Order__c ASC
            LIMIT 1
        ];

        return matches.isEmpty() ? null : matches[0];
    }

    private static Id resolveAssignee(Subtask_Template_Item__c item, Id matterId) {
        if (item.Assignee_Type__c == 'Static User') {
            return item.Static_Assignee__c;
        }

        if (item.Assignee_Type__c == 'Dynamic Matter Field') {
            Object fieldValue = readMatterField(matterId, item.Dynamic_Assignee_Field__c);
            return fieldValue == null ? null : (Id) fieldValue;
        }

        return null;
    }

    private static Object readMatterField(Id matterId, String fieldApiName) {
        if (matterId == null || String.isBlank(fieldApiName)) {
            return null;
        }

        Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.NEOS_Matter__c.fields.getMap();

        if (!fieldMap.containsKey(fieldApiName.toLowerCase())) {
            return null;
        }

        String safeFieldName = fieldMap.get(fieldApiName.toLowerCase()).getDescribe().getName();

        List<SObject> matches = Database.query(
            'SELECT ' + safeFieldName + ' FROM NEOS_Matter__c WHERE Id = :matterId LIMIT 1'
        );

        return matches.isEmpty() ? null : matches[0].get(safeFieldName);
    }
}
