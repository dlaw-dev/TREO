public with sharing class ReceivedDocsChecklistController {

    @AuraEnabled(cacheable=true)
    public static List<String> getPicklistOptions(String objectApiName, String fieldApiName) {
        List<String> options = new List<String>();
        try {
            Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
            if (objType == null) return options;
            Schema.SObjectField field = objType.getDescribe().fields.getMap().get(fieldApiName);
            if (field == null) return options;
            for (Schema.PicklistEntry entry : field.getDescribe().getPicklistValues()) {
                if (entry.isActive()) {
                    options.add(entry.getValue());
                }
            }
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
        return options;
    }
}
