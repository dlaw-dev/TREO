/**
 * Resolves the assignee for a Subtask_Template_Item__c against a Matter.
 * Shared by SubtaskTemplateApplier (initial chain creation) and
 * TaskTriggerActions (advancing the chain), so a step's assignee rule -
 * static User, or dynamic field read off the Matter - behaves identically
 * whether it's the first step in the chain or a later one.
 */
public with sharing class SubtaskAssigneeResolver {

    public static Id resolveAssignee(Subtask_Template_Item__c item, Id matterId) {
        Map<Id, Id> single = resolveAssigneesBulk(
            new Map<Id, Subtask_Template_Item__c>{ matterId => item },
            new Map<Id, Id>{ matterId => matterId }
        );

        return single.get(matterId);
    }

    /**
     * Resolves many (item, matter) pairs in a bounded number of queries
     * regardless of how many pairs are passed in: one query total for every
     * distinct dynamic field name actually referenced, instead of one query
     * per pair. keysToItem and keysToMatterId must share the same key set;
     * the key is caller-defined (typically a Task Id) purely for
     * correlating results back afterward.
     */
    public static Map<Id, Id> resolveAssigneesBulk(Map<Id, Subtask_Template_Item__c> keyToItem, Map<Id, Id> keyToMatterId) {
        Map<Id, Id> results = new Map<Id, Id>();

        Map<String, Set<Id>> matterIdsByField = new Map<String, Set<Id>>();
        Map<Id, String> dynamicFieldByKey = new Map<Id, String>();

        for (Id key : keyToItem.keySet()) {
            Subtask_Template_Item__c item = keyToItem.get(key);

            if (item.Assignee_Type__c == 'Static User') {
                results.put(key, item.Static_Assignee__c);
                continue;
            }

            if (item.Assignee_Type__c != 'Dynamic Matter Field' || String.isBlank(item.Dynamic_Assignee_Field__c)) {
                continue;
            }

            Id matterId = keyToMatterId.get(key);
            if (matterId == null) {
                continue;
            }

            if (!matterIdsByField.containsKey(item.Dynamic_Assignee_Field__c)) {
                matterIdsByField.put(item.Dynamic_Assignee_Field__c, new Set<Id>());
            }
            matterIdsByField.get(item.Dynamic_Assignee_Field__c).add(matterId);
            dynamicFieldByKey.put(key, item.Dynamic_Assignee_Field__c);
        }

        if (matterIdsByField.isEmpty()) {
            return results;
        }

        Map<String, Map<Id, Id>> valueByMatterIdByField = readMatterFieldsBulk(matterIdsByField);

        for (Id key : dynamicFieldByKey.keySet()) {
            Id matterId = keyToMatterId.get(key);
            Map<Id, Id> valueByMatterId = valueByMatterIdByField.get(dynamicFieldByKey.get(key));

            if (valueByMatterId != null && valueByMatterId.containsKey(matterId)) {
                results.put(key, valueByMatterId.get(matterId));
            }
        }

        return results;
    }

    private static Map<String, Map<Id, Id>> readMatterFieldsBulk(Map<String, Set<Id>> matterIdsByField) {
        Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.NEOS_Matter__c.fields.getMap();
        Map<String, Map<Id, Id>> results = new Map<String, Map<Id, Id>>();

        for (String fieldApiName : matterIdsByField.keySet()) {
            Schema.SObjectField field = fieldMap.get(fieldApiName.toLowerCase());

            if (field == null) {
                continue;
            }

            String safeFieldName = field.getDescribe().getName();
            Set<Id> matterIds = matterIdsByField.get(fieldApiName);

            Map<Id, Id> valueByMatterId = new Map<Id, Id>();
            for (SObject matter : Database.query(
                'SELECT Id, ' + safeFieldName + ' FROM NEOS_Matter__c WHERE Id IN :matterIds'
            )) {
                Object value = matter.get(safeFieldName);
                if (value != null) {
                    valueByMatterId.put(matter.Id, (Id) value);
                }
            }

            results.put(fieldApiName, valueByMatterId);
        }

        return results;
    }
}
