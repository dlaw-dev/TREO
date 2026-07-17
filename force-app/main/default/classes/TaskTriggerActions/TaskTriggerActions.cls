/**
 * Container for Task trigger automation rules. Each rule is a small inner
 * class implementing TaskTriggerAction, registered with TaskTriggerHandler.
 * Add new rules here as inner classes rather than new top-level classes.
 *
 * The subtask chain rules below only ever act on tasks with
 * Subtask_Template_Item__c populated - manually-created tasks are always
 * left completely untouched. Every query here is bulkified to a small,
 * bounded count regardless of how many tasks complete in one transaction
 * (mass actions, Data Loader, etc.).
 */
public with sharing class TaskTriggerActions {

    public class ValidateNextStepReadyBeforeComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completingSubtasks = filterCompletingSubtasks(newRecords, oldMap);

            if (completingSubtasks.isEmpty()) {
                return;
            }

            Map<Id, Subtask_Template_Item__c> currentItemsById = queryItems(completingSubtasks);
            Map<Id, Subtask_Template_Item__c> nextItemByCurrentItemId = queryNextItemsBulk(currentItemsById.values());

            Map<Id, Subtask_Template_Item__c> itemToResolveByTaskId = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> matterIdByTaskId = new Map<Id, Id>();

            for (Task t : completingSubtasks) {
                Subtask_Template_Item__c nextItem = nextItemFor(t, currentItemsById, nextItemByCurrentItemId);

                if (nextItem == null || nextItem.Assignee_Type__c != 'Dynamic Matter Field') {
                    continue;
                }

                itemToResolveByTaskId.put(t.Id, nextItem);
                matterIdByTaskId.put(t.Id, t.NEOS_Matter__c);
            }

            Map<Id, Id> resolvedAssigneeByTaskId = SubtaskAssigneeResolver.resolveAssigneesBulk(
                itemToResolveByTaskId, matterIdByTaskId);

            for (Task t : completingSubtasks) {
                Subtask_Template_Item__c nextItem = itemToResolveByTaskId.get(t.Id);

                if (nextItem == null) {
                    continue;
                }

                if (resolvedAssigneeByTaskId.get(t.Id) == null) {
                    t.addError('Please set "' + nextItem.Dynamic_Assignee_Field__c
                        + '" on the Matter before completing this task, so "'
                        + nextItem.Subject__c + '" can be assigned.');
                }
            }
        }
    }

    public class AdvanceSubtaskChainAfterComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completedSubtasks = filterCompletingSubtasks(newRecords, oldMap);

            if (completedSubtasks.isEmpty()) {
                return;
            }

            Map<Id, Subtask_Template_Item__c> currentItemsById = queryItems(completedSubtasks);
            Map<Id, Subtask_Template_Item__c> nextItemByCurrentItemId = queryNextItemsBulk(currentItemsById.values());

            Map<Id, Subtask_Template_Item__c> nextItemByTaskId = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> matterIdByTaskId = new Map<Id, Id>();

            for (Task t : completedSubtasks) {
                Subtask_Template_Item__c nextItem = nextItemFor(t, currentItemsById, nextItemByCurrentItemId);

                if (nextItem == null) {
                    continue; // this was the master / last step - chain is complete
                }

                nextItemByTaskId.put(t.Id, nextItem);
                matterIdByTaskId.put(t.Id, t.NEOS_Matter__c);
            }

            Map<Id, Id> resolvedAssigneeByTaskId = SubtaskAssigneeResolver.resolveAssigneesBulk(
                nextItemByTaskId, matterIdByTaskId);

            Map<String, Task> placeholderByCompositeKey = queryPlaceholdersBulk(completedSubtasks, nextItemByTaskId);

            List<Task> tasksToUpdate = new List<Task>();

            for (Task t : completedSubtasks) {
                Subtask_Template_Item__c nextItem = nextItemByTaskId.get(t.Id);

                if (nextItem == null) {
                    continue;
                }

                Id assigneeId = resolvedAssigneeByTaskId.get(t.Id);

                if (assigneeId == null) {
                    continue; // the before-update safety rail should have blocked this already
                }

                Task placeholder = placeholderByCompositeKey.get(compositeKey(nextItem.Id, t.Parent_Task__c));

                if (placeholder == null || placeholder.Status != 'Waiting') {
                    continue; // no placeholder, or it was already activated/advanced - never regress it
                }

                placeholder.OwnerId = assigneeId;
                placeholder.Status = 'Open';
                placeholder.ActivityDate = Date.today().addDays(7);
                tasksToUpdate.add(placeholder);
            }

            if (!tasksToUpdate.isEmpty()) {
                List<Database.SaveResult> saveResults = Database.update(tasksToUpdate, false);

                for (Integer i = 0; i < saveResults.size(); i++) {
                    if (!saveResults[i].isSuccess()) {
                        String errorDetail = '';
                        for (Database.Error err : saveResults[i].getErrors()) {
                            errorDetail += err.getStatusCode() + ': ' + err.getMessage() + ' ';
                        }
                        System.debug(LoggingLevel.ERROR, 'Failed to activate next subtask (Task Id='
                            + tasksToUpdate[i].Id + '): ' + errorDetail);
                    }
                }
            }
        }

        private String compositeKey(Id templateItemId, String chainId) {
            return templateItemId + ':' + chainId;
        }

        private Map<String, Task> queryPlaceholdersBulk(List<Task> completedSubtasks, Map<Id, Subtask_Template_Item__c> nextItemByTaskId) {
            Set<Id> nextItemIds = new Set<Id>();
            Set<String> chainIds = new Set<String>();

            for (Task t : completedSubtasks) {
                Subtask_Template_Item__c nextItem = nextItemByTaskId.get(t.Id);

                if (nextItem == null) {
                    continue;
                }

                nextItemIds.add(nextItem.Id);

                if (t.Parent_Task__c != null) {
                    chainIds.add(t.Parent_Task__c);
                }
            }

            Map<String, Task> results = new Map<String, Task>();

            if (nextItemIds.isEmpty() || chainIds.isEmpty()) {
                return results;
            }

            for (Task placeholder : [
                SELECT Id, OwnerId, Status, ActivityDate, Subtask_Template_Item__c, Parent_Task__c
                FROM Task
                WHERE Subtask_Template_Item__c IN :nextItemIds
                  AND Parent_Task__c IN :chainIds
            ]) {
                results.put(compositeKey(placeholder.Subtask_Template_Item__c, placeholder.Parent_Task__c), placeholder);
            }

            return results;
        }
    }

    /* -------------------------
       Shared helpers
    -------------------------- */

    private static List<Task> filterCompletingSubtasks(List<Task> newRecords, Map<Id, Task> oldMap) {
        List<Task> result = new List<Task>();

        for (Task t : newRecords) {
            Task oldTask = oldMap.get(t.Id);

            if (t.Subtask_Template_Item__c != null
                && t.Status == 'Completed'
                && oldTask.Status != 'Completed') {
                result.add(t);
            }
        }

        return result;
    }

    private static Subtask_Template_Item__c nextItemFor(
        Task t,
        Map<Id, Subtask_Template_Item__c> currentItemsById,
        Map<Id, Subtask_Template_Item__c> nextItemByCurrentItemId
    ) {
        Subtask_Template_Item__c currentItem = currentItemsById.get(t.Subtask_Template_Item__c);

        if (currentItem == null) {
            return null;
        }

        return nextItemByCurrentItemId.get(currentItem.Id);
    }

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

    /**
     * Returns, for each given current item, its next item by sequence within
     * the same template - computed with exactly one query total (fetching
     * every item in every referenced template), regardless of how many
     * current items are passed in.
     */
    private static Map<Id, Subtask_Template_Item__c> queryNextItemsBulk(List<Subtask_Template_Item__c> currentItems) {
        Set<Id> templateIds = new Set<Id>();

        for (Subtask_Template_Item__c item : currentItems) {
            templateIds.add(item.Subtask_Template__c);
        }

        Map<Id, List<Subtask_Template_Item__c>> itemsByTemplate = new Map<Id, List<Subtask_Template_Item__c>>();

        for (Subtask_Template_Item__c item : [
            SELECT Id, Subtask_Template__c, Sequence_Order__c, Subject__c,
                   Description__c, Assignee_Type__c, Static_Assignee__c, Dynamic_Assignee_Field__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c IN :templateIds
            ORDER BY Sequence_Order__c ASC
        ]) {
            if (!itemsByTemplate.containsKey(item.Subtask_Template__c)) {
                itemsByTemplate.put(item.Subtask_Template__c, new List<Subtask_Template_Item__c>());
            }
            itemsByTemplate.get(item.Subtask_Template__c).add(item);
        }

        Map<Id, Subtask_Template_Item__c> nextItemByCurrentId = new Map<Id, Subtask_Template_Item__c>();

        for (Subtask_Template_Item__c currentItem : currentItems) {
            List<Subtask_Template_Item__c> siblings = itemsByTemplate.get(currentItem.Subtask_Template__c);

            if (siblings == null) {
                continue;
            }

            Subtask_Template_Item__c next = null;

            for (Subtask_Template_Item__c sibling : siblings) {
                if (sibling.Sequence_Order__c > currentItem.Sequence_Order__c
                    && (next == null || sibling.Sequence_Order__c < next.Sequence_Order__c)) {
                    next = sibling;
                }
            }

            if (next != null) {
                nextItemByCurrentId.put(currentItem.Id, next);
            }
        }

        return nextItemByCurrentId;
    }
}
