@IsTest
private class TaskTriggerHandlerTest {

    private class SpyAction implements TaskTriggerAction {
        public Integer callCount = 0;

        public void run(List<Task> newRecords, Map<Id, Task> oldMap) {
            callCount++;
        }
    }

    @IsTest
    static void testBeforeUpdate_invokesRegisteredActions() {
        SpyAction spy = new SpyAction();
        List<TaskTriggerAction> original = TaskTriggerHandler.beforeUpdateActions;
        TaskTriggerHandler.beforeUpdateActions = new List<TaskTriggerAction>{ spy };

        try {
            Task t = new Task(Subject = 'Test', Status = 'Open');
            Test.startTest();
            TaskTriggerHandler.beforeUpdate(new List<Task>{ t }, new Map<Id, Task>{ t.Id => t });
            Test.stopTest();

            System.assertEquals(1, spy.callCount);
        } finally {
            TaskTriggerHandler.beforeUpdateActions = original;
        }
    }

    @IsTest
    static void testAfterUpdate_invokesRegisteredActions() {
        SpyAction spy = new SpyAction();
        List<TaskTriggerAction> original = TaskTriggerHandler.afterUpdateActions;
        TaskTriggerHandler.afterUpdateActions = new List<TaskTriggerAction>{ spy };

        try {
            Task t = new Task(Subject = 'Test', Status = 'Open');
            Test.startTest();
            TaskTriggerHandler.afterUpdate(new List<Task>{ t }, new Map<Id, Task>{ t.Id => t });
            Test.stopTest();

            System.assertEquals(1, spy.callCount);
        } finally {
            TaskTriggerHandler.afterUpdateActions = original;
        }
    }
}
