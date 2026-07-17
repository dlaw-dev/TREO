trigger TaskTrigger on Task (before update, after update) {

    if (Trigger.isBefore && Trigger.isUpdate) {
        TaskTriggerHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
    }

    if (Trigger.isAfter && Trigger.isUpdate) {
        TaskTriggerHandler.afterUpdate(Trigger.new, Trigger.oldMap);
    }
}
