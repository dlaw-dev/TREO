public with sharing class NeosMatterCustomNotesController {

    private static Set<Id> expandToPersonAccountIds(Id parentId) {
        Set<Id> ids = new Set<Id>();
        if (parentId == null) return ids;
        ids.add(parentId);

        String acctPrefix = Account.SObjectType.getDescribe().getKeyPrefix();
        String conPrefix  = Contact.SObjectType.getDescribe().getKeyPrefix();
        String prefix = String.valueOf(parentId).substring(0, 3);

        if (prefix == acctPrefix) {
            // For Person Accounts, the Person Contact has AccountId = Account.Id
            List<Contact> cs = [SELECT Id FROM Contact WHERE AccountId = :parentId LIMIT 1];
            if (!cs.isEmpty()) ids.add(cs[0].Id);
        } else if (prefix == conPrefix) {
            Contact c = [SELECT Id, AccountId FROM Contact WHERE Id = :parentId LIMIT 1];
            if (c.AccountId != null) ids.add(c.AccountId);
        }
        return ids;
    }

    @AuraEnabled(cacheable=true)
    public static List<NEOS_Notes__c> getCustomNotes(Id parentId) {
        Set<Id> targetIds = expandToPersonAccountIds(parentId);
        return [
            SELECT Id,
                   Name,
                   Note_Category__c,
                   Note_Description__c,
                   NEOS_Created_Date__c,
                   Staff__c,
                   Staff__r.Name,
                   Pinned_Note__c
            FROM NEOS_Notes__c
            WHERE (NEOS_Matter__c IN :targetIds OR Provider__c IN :targetIds)
            ORDER BY NEOS_Created_Date__c DESC
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<NEOS_Notes__c> getPinnedNotes(Id parentId) {
        Set<Id> targetIds = expandToPersonAccountIds(parentId);
        return [
            SELECT Id,
                   Name,
                   Note_Category__c,
                   NEOS_Created_Date__c,
                   Staff__c,
                   Staff__r.Name
            FROM NEOS_Notes__c
            WHERE Pinned_Note__c = TRUE
              AND (NEOS_Matter__c IN :targetIds OR Provider__c IN :targetIds)
            ORDER BY NEOS_Created_Date__c DESC
        ];
    }
}