/**
 * Resolves the assignee for a Subtask_Template_Item__c against a Matter.
 * Shared by SubtaskTemplateApplier (initial chain creation) and
 * TaskTriggerActions (advancing the chain), so a step's assignee rule -
 * static User, or dynamic field read off the Matter - behaves identically
 * whether it's the first step in the chain or a later one.
 */
public with sharing class SubtaskAssigneeResolver {

    public static Id resolveAssignee(Subtask_Template_Item__c item, Id matterId) {
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
