public with sharing class TaskTriggerHandler {

    @TestVisible
    private static List<TaskTriggerAction> beforeUpdateActions = new List<TaskTriggerAction>{
        new TaskTriggerActions.ValidateNextStepReadyBeforeComplete()
    };

    @TestVisible
    private static List<TaskTriggerAction> afterUpdateActions = new List<TaskTriggerAction>{
        new TaskTriggerActions.AdvanceSubtaskChainAfterComplete()
    };

    public static void beforeUpdate(List<Task> newRecords, Map<Id, Task> oldMap) {
        for (TaskTriggerAction action : beforeUpdateActions) {
            action.run(newRecords, oldMap);
        }
    }

    public static void afterUpdate(List<Task> newRecords, Map<Id, Task> oldMap) {
        for (TaskTriggerAction action : afterUpdateActions) {
            action.run(newRecords, oldMap);
        }
    }
}
