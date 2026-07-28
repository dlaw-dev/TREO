/**
 * Container for Task trigger automation rules. Each rule is a small inner
 * class implementing TaskTriggerAction, registered with TaskTriggerHandler.
 * Add new rules here as inner classes rather than new top-level classes.
 *
 * The subtask chain rules below only ever act on tasks with
 * Subtask_Template_Item__c populated - manually-created tasks are always
 * left completely untouched. Every query here is bulkified to a small,
 * bounded count regardless of how many tasks complete in one transaction
 * (mass actions, Data Loader, etc.) - and regardless of how many OTHER
 * steps a single completing step unlocks at once (branching).
 */
public with sharing class TaskTriggerActions {

    public class ValidateNextStepReadyBeforeComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completingSubtasks = filterCompletingSubtasks(newRecords, oldMap);

            if (completingSubtasks.isEmpty()) {
                return;
            }

            Set<Id> completedItemIds = new Set<Id>();
            for (Task t : completingSubtasks) {
                completedItemIds.add(t.Subtask_Template_Item__c);
            }
            Map<Id, List<Subtask_Template_Item__c>> dependentsByCompletedItemId = queryDependentItemsBulk(completedItemIds);

            // Keyed by the dependent item's own Id, not the completing
            // task's - a single completing step can unlock several
            // dependents at once (branching), and each dependent item's Id
            // is unique across the whole batch regardless.
            Map<Id, Subtask_Template_Item__c> itemToResolveByDependentItemId = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> matterIdByDependentItemId = new Map<Id, Id>();
            Map<Id, Task> completingTaskByDependentItemId = new Map<Id, Task>();

            for (Task t : completingSubtasks) {
                List<Subtask_Template_Item__c> dependents = dependentsByCompletedItemId.get(t.Subtask_Template_Item__c);
                if (dependents == null) continue;

                for (Subtask_Template_Item__c dependent : dependents) {
                    if (dependent.Assignee_Type__c != 'Dynamic Matter Field') continue;

                    itemToResolveByDependentItemId.put(dependent.Id, dependent);
                    matterIdByDependentItemId.put(dependent.Id, t.NEOS_Matter__c);
                    completingTaskByDependentItemId.put(dependent.Id, t);
                }
            }

            Map<Id, Id> resolvedAssigneeByDependentItemId = SubtaskAssigneeResolver.resolveAssigneesBulk(
                itemToResolveByDependentItemId, matterIdByDependentItemId);

            for (Id dependentItemId : itemToResolveByDependentItemId.keySet()) {
                if (resolvedAssigneeByDependentItemId.get(dependentItemId) != null) continue;

                Subtask_Template_Item__c dependent = itemToResolveByDependentItemId.get(dependentItemId);
                completingTaskByDependentItemId.get(dependentItemId).addError(
                    'Please set "' + dependent.Dynamic_Assignee_Field__c
                    + '" on the Matter before completing this task, so "'
                    + dependent.Subject__c + '" can be assigned.');
            }
        }
    }

    public class AdvanceSubtaskChainAfterComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completedSubtasks = filterCompletingSubtasks(newRecords, oldMap);

            if (completedSubtasks.isEmpty()) {
                return;
            }

            Set<Id> completedItemIds = new Set<Id>();
            for (Task t : completedSubtasks) {
                completedItemIds.add(t.Subtask_Template_Item__c);
            }
            Map<Id, List<Subtask_Template_Item__c>> dependentsByCompletedItemId = queryDependentItemsBulk(completedItemIds);

            // One entry per (completing task, dependent item) pair, keyed
            // by the dependent item's own Id - see note above on why that's
            // safely unique across the whole batch.
            Map<Id, Subtask_Template_Item__c> dependentItemById = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> matterIdByDependentItemId = new Map<Id, Id>();
            Map<Id, Id> chainIdByDependentItemId = new Map<Id, Id>();

            for (Task t : completedSubtasks) {
                List<Subtask_Template_Item__c> dependents = dependentsByCompletedItemId.get(t.Subtask_Template_Item__c);
                if (dependents == null) continue;

                for (Subtask_Template_Item__c dependent : dependents) {
                    dependentItemById.put(dependent.Id, dependent);
                    matterIdByDependentItemId.put(dependent.Id, t.NEOS_Matter__c);
                    chainIdByDependentItemId.put(dependent.Id, t.Parent_Task__c);
                }
            }

            if (dependentItemById.isEmpty()) {
                return;
            }

            Map<Id, Id> resolvedAssigneeByDependentItemId = SubtaskAssigneeResolver.resolveAssigneesBulk(
                dependentItemById, matterIdByDependentItemId);

            Map<String, Task> placeholderByCompositeKey = queryPlaceholdersBulk(
                dependentItemById.keySet(), new Set<Id>(chainIdByDependentItemId.values()));

            List<Task> tasksToUpdate = new List<Task>();

            for (Id dependentItemId : dependentItemById.keySet()) {
                Id assigneeId = resolvedAssigneeByDependentItemId.get(dependentItemId);

                if (assigneeId == null) {
                    continue; // the before-update safety rail should have blocked this already
                }

                Task placeholder = placeholderByCompositeKey.get(
                    compositeKey(dependentItemId, chainIdByDependentItemId.get(dependentItemId)));

                if (placeholder == null || placeholder.Status != 'Waiting') {
                    continue; // no placeholder, or it was already activated/advanced - never regress it
                }

                // Someone may have already manually reassigned this
                // not-yet-active step via Edit/Reassign - respect that
                // instead of silently overwriting it with a freshly
                // resolved dynamic assignee.
                if (placeholder.Manually_Reassigned__c != true) {
                    placeholder.OwnerId = assigneeId;
                }
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

        private String compositeKey(Id templateItemId, Id chainId) {
            return templateItemId + ':' + chainId;
        }

        private Map<String, Task> queryPlaceholdersBulk(Set<Id> dependentItemIds, Set<Id> chainIds) {
            Map<String, Task> results = new Map<String, Task>();

            if (dependentItemIds.isEmpty() || chainIds.isEmpty()) {
                return results;
            }

            for (Task placeholder : [
                SELECT Id, OwnerId, Status, ActivityDate, Subtask_Template_Item__c, Parent_Task__c, Manually_Reassigned__c
                FROM Task
                WHERE Subtask_Template_Item__c IN :dependentItemIds
                  AND Parent_Task__c IN :chainIds
            ]) {
                results.put(compositeKey(placeholder.Subtask_Template_Item__c, placeholder.Parent_Task__c), placeholder);
            }

            return results;
        }
    }

    /**
     * Ad hoc (non-chain) counterpart to AdvanceSubtaskChainAfterComplete:
     * when ANY task completes, reopens every other task manually marked
     * Waiting on it via Waiting_On_Task__c (set from the New Task modal).
     * Unlike chain steps, these already have a concrete owner and due date
     * from creation, so there's no re-assignment to do - just flip Status
     * back to Open.
     */
    public class ActivateAdHocWaitingTasksAfterComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            Set<String> completedTaskIds = new Set<String>();

            for (Task t : newRecords) {
                Task oldTask = oldMap.get(t.Id);

                if (t.Status == 'Completed' && oldTask.Status != 'Completed') {
                    completedTaskIds.add(t.Id);
                }
            }

            if (completedTaskIds.isEmpty()) {
                return;
            }

            List<Task> dependents = [
                SELECT Id, Status
                FROM Task
                WHERE Status = 'Waiting'
                  AND Waiting_On_Task__c IN :completedTaskIds
            ];

            if (dependents.isEmpty()) {
                return;
            }

            for (Task dependent : dependents) {
                dependent.Status = 'Open';
            }

            Database.update(dependents, false);
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

    /**
     * Returns, for each given completed item, every item that depends on it
     * directly (Depends_On_Step__c) - zero, one, or several (branching) -
     * computed with exactly one query total regardless of how many
     * completed items are passed in.
     */
    private static Map<Id, List<Subtask_Template_Item__c>> queryDependentItemsBulk(Set<Id> completedItemIds) {
        Map<Id, List<Subtask_Template_Item__c>> results = new Map<Id, List<Subtask_Template_Item__c>>();

        for (Subtask_Template_Item__c dependent : [
            SELECT Id, Subtask_Template__c, Sequence_Order__c, Subject__c,
                   Description__c, Assignee_Type__c, Static_Assignee__c, Dynamic_Assignee_Field__c, Depends_On_Step__c
            FROM Subtask_Template_Item__c
            WHERE Depends_On_Step__c IN :completedItemIds
        ]) {
            if (!results.containsKey(dependent.Depends_On_Step__c)) {
                results.put(dependent.Depends_On_Step__c, new List<Subtask_Template_Item__c>());
            }
            results.get(dependent.Depends_On_Step__c).add(dependent);
        }

        return results;
    }
}
