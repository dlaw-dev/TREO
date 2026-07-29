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

    /**
     * Any path that marks a task Completed while it has a Reviewer set -
     * the custom Mark Done button, a native checkbox/inline edit, Data
     * Loader, Flow, or anything else - is redirected to Pending Review
     * instead, so review enforcement can't be bypassed by skipping the
     * custom UI. Must run before ValidateNextStepReadyBeforeComplete so a
     * chain step redirected here is never mistaken for a real chain-
     * advancing completion. A task actually being approved (moving from
     * Pending Review to Completed) is left alone.
     */
    public class RedirectReviewedCompletionsBeforeUpdate implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            for (Task t : newRecords) {
                Task oldTask = oldMap.get(t.Id);

                if (t.Status == 'Completed'
                    && oldTask.Status != 'Completed'
                    && oldTask.Status != 'Pending Review'
                    && t.Reviewer__c != null) {
                    t.Status = 'Pending Review';
                    t.Review_Feedback__c = null;
                }
            }
        }
    }

    public class ValidateNextStepReadyBeforeComplete implements TaskTriggerAction {

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            List<Task> completingSubtasks = filterCompletingSubtasks(newRecords, oldMap);

            if (completingSubtasks.isEmpty()) {
                return;
            }

            Set<Id> completedItemIds = new Set<Id>();
            Set<Id> chainIds = new Set<Id>();
            for (Task t : completingSubtasks) {
                completedItemIds.add(t.Subtask_Template_Item__c);
                chainIds.add(t.Parent_Task__c);
            }
            Map<Id, List<Subtask_Template_Item__c>> dependentsByCompletedItemId = queryDependentItemsBulk(completedItemIds);

            Set<Id> dependentItemIds = new Set<Id>();
            for (List<Subtask_Template_Item__c> deps : dependentsByCompletedItemId.values()) {
                for (Subtask_Template_Item__c dep : deps) dependentItemIds.add(dep.Id);
            }

            // The same template (and so the same dependent item Id) can be
            // shared by many chains completing in the same batch - keying
            // by the dependent item's own Id alone would collide across
            // chains. The already-instantiated placeholder Task for this
            // (item, chain) pair is genuinely unique, so key on that instead.
            Map<String, Task> placeholderByCompositeKey = queryPlaceholdersBulk(dependentItemIds, chainIds);

            Map<Id, Subtask_Template_Item__c> itemToResolveByPlaceholderId = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> matterIdByPlaceholderId = new Map<Id, Id>();
            Map<Id, Task> completingTaskByPlaceholderId = new Map<Id, Task>();

            for (Task t : completingSubtasks) {
                List<Subtask_Template_Item__c> dependents = dependentsByCompletedItemId.get(t.Subtask_Template_Item__c);
                if (dependents == null) continue;

                for (Subtask_Template_Item__c dependent : dependents) {
                    if (dependent.Assignee_Type__c != 'Dynamic Matter Field') continue;

                    Task placeholder = placeholderByCompositeKey.get(compositeKey(dependent.Id, t.Parent_Task__c));
                    if (placeholder == null) continue;

                    // A manually reassigned placeholder already has a real,
                    // intentional owner (set via Edit/Reassign) and will
                    // never be re-resolved from the dynamic field anyway -
                    // see AdvanceSubtaskChainAfterComplete below - so it has
                    // nothing to validate here regardless of whether the
                    // Matter field is set.
                    if (placeholder.Manually_Reassigned__c == true) continue;

                    itemToResolveByPlaceholderId.put(placeholder.Id, dependent);
                    matterIdByPlaceholderId.put(placeholder.Id, t.NEOS_Matter__c);
                    completingTaskByPlaceholderId.put(placeholder.Id, t);
                }
            }

            Map<Id, Id> resolvedAssigneeByPlaceholderId = SubtaskAssigneeResolver.resolveAssigneesBulk(
                itemToResolveByPlaceholderId, matterIdByPlaceholderId);

            for (Id placeholderId : itemToResolveByPlaceholderId.keySet()) {
                if (resolvedAssigneeByPlaceholderId.get(placeholderId) != null) continue;

                Subtask_Template_Item__c dependent = itemToResolveByPlaceholderId.get(placeholderId);
                completingTaskByPlaceholderId.get(placeholderId).addError(
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
            Set<Id> chainIds = new Set<Id>();
            for (Task t : completedSubtasks) {
                completedItemIds.add(t.Subtask_Template_Item__c);
                chainIds.add(t.Parent_Task__c);
            }
            Map<Id, List<Subtask_Template_Item__c>> dependentsByCompletedItemId = queryDependentItemsBulk(completedItemIds);

            Set<Id> dependentItemIds = new Set<Id>();
            for (List<Subtask_Template_Item__c> deps : dependentsByCompletedItemId.values()) {
                for (Subtask_Template_Item__c dep : deps) dependentItemIds.add(dep.Id);
            }

            // The same template (and so the same dependent item Id) can be
            // shared by many chains completing in the same batch - keying
            // by the dependent item's own Id alone would collide across
            // chains. The already-instantiated placeholder Task for this
            // (item, chain) pair is genuinely unique, so key on that instead.
            Map<String, Task> placeholderByCompositeKey = queryPlaceholdersBulk(dependentItemIds, chainIds);

            Map<Id, Subtask_Template_Item__c> itemByPlaceholderId = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> matterIdByPlaceholderId = new Map<Id, Id>();
            Map<Id, Task> placeholderById = new Map<Id, Task>();

            for (Task t : completedSubtasks) {
                List<Subtask_Template_Item__c> dependents = dependentsByCompletedItemId.get(t.Subtask_Template_Item__c);
                if (dependents == null) continue;

                for (Subtask_Template_Item__c dependent : dependents) {
                    Task placeholder = placeholderByCompositeKey.get(compositeKey(dependent.Id, t.Parent_Task__c));
                    if (placeholder == null || placeholder.Status != 'Waiting') {
                        continue; // no placeholder, or it was already activated/advanced - never regress it
                    }

                    itemByPlaceholderId.put(placeholder.Id, dependent);
                    matterIdByPlaceholderId.put(placeholder.Id, t.NEOS_Matter__c);
                    placeholderById.put(placeholder.Id, placeholder);
                }
            }

            if (placeholderById.isEmpty()) {
                return;
            }

            Map<Id, Id> resolvedAssigneeByPlaceholderId = SubtaskAssigneeResolver.resolveAssigneesBulk(
                itemByPlaceholderId, matterIdByPlaceholderId);

            List<Task> tasksToUpdate = new List<Task>();

            for (Id placeholderId : placeholderById.keySet()) {
                Id assigneeId = resolvedAssigneeByPlaceholderId.get(placeholderId);
                Task placeholder = placeholderById.get(placeholderId);

                // A manually reassigned placeholder already has a real,
                // intentional owner and never needs the dynamic field
                // resolved at all (the before-update validator skips it for
                // the same reason) - only an un-reassigned step actually
                // needs a successful resolution to proceed.
                if (assigneeId == null && placeholder.Manually_Reassigned__c != true) {
                    continue; // the before-update safety rail should have blocked this already
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

            List<Database.SaveResult> saveResults = Database.update(dependents, false);

            for (Integer i = 0; i < saveResults.size(); i++) {
                if (!saveResults[i].isSuccess()) {
                    String errorDetail = '';
                    for (Database.Error err : saveResults[i].getErrors()) {
                        errorDetail += err.getStatusCode() + ': ' + err.getMessage() + ' ';
                    }
                    System.debug(LoggingLevel.ERROR, 'Failed to activate ad hoc waiting task (Task Id='
                        + dependents[i].Id + '): ' + errorDetail);
                }
            }
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

    private static String compositeKey(Id templateItemId, Id chainId) {
        return templateItemId + ':' + chainId;
    }

    /**
     * Looks up the already-instantiated placeholder Task for each
     * (dependent template item, chain) pair - shared by both the
     * before-update validator and the after-update activator, since each
     * needs to correlate a dependent item back to a real, unique Task Id
     * (the template item Id alone isn't unique once the same template is
     * applied to more than one chain in the same batch).
     */
    private static Map<String, Task> queryPlaceholdersBulk(Set<Id> dependentItemIds, Set<Id> chainIds) {
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
