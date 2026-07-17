trigger SubtaskTemplateItemTrigger on Subtask_Template_Item__c (before insert, before update) {
    SubtaskTemplateItemValidator.validateDynamicAssigneeFields(Trigger.new);
}
