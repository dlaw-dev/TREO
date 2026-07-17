public interface TaskTriggerAction {
    void run(List<Task> newRecords, Map<Id, Task> oldMap);
}
