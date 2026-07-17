/**
 * Catches a misconfigured dynamic assignee field at template-edit time
 * instead of letting it silently stall a chain months later at runtime: if
 * Assignee_Type__c is "Dynamic Matter Field", Dynamic_Assignee_Field__c must
 * name a real field on NEOS_Matter__c that is a Lookup to User.
 */
public with sharing class SubtaskTemplateItemValidator {

    public static void validateDynamicAssigneeFields(List<Subtask_Template_Item__c> items) {
        Map<String, Schema.SObjectField> matterFieldMap = Schema.SObjectType.NEOS_Matter__c.fields.getMap();

        for (Subtask_Template_Item__c item : items) {
            if (item.Assignee_Type__c != 'Dynamic Matter Field' || String.isBlank(item.Dynamic_Assignee_Field__c)) {
                continue;
            }

            Schema.SObjectField field = matterFieldMap.get(item.Dynamic_Assignee_Field__c.toLowerCase());

            if (field == null) {
                item.Dynamic_Assignee_Field__c.addError(
                    '"' + item.Dynamic_Assignee_Field__c + '" is not a field on the Matter object.');
                continue;
            }

            if (!isUserLookup(field.getDescribe())) {
                item.Dynamic_Assignee_Field__c.addError(
                    '"' + item.Dynamic_Assignee_Field__c + '" must be a Lookup field to User on the Matter.');
            }
        }
    }

    private static Boolean isUserLookup(Schema.DescribeFieldResult describe) {
        if (describe.getType() != Schema.DisplayType.REFERENCE) {
            return false;
        }

        List<Schema.SObjectType> referenceTo = describe.getReferenceTo();
        return !referenceTo.isEmpty() && referenceTo[0].getDescribe().getName() == 'User';
    }
}
