public with sharing class CompanionMattersController {

    @AuraEnabled(cacheable=true)
    public static List<NEOS_Matter__c> getCompanionMatters(Id matterId, Integer maxRecords) {
        try {
            NEOS_Matter__c current = [
                SELECT Lawsuit_Matter__c
                FROM NEOS_Matter__c
                WHERE Id = :matterId
                WITH SECURITY_ENFORCED
            ];

            if (current.Lawsuit_Matter__c == null) {
                return new List<NEOS_Matter__c>();
            }

            return [
                SELECT Id, Name, Stage__c, Senior_Attorney__c, Senior_Attorney__r.Name,
                       Associate_Attorney__c, Associate_Attorney__r.Name
                FROM NEOS_Matter__c
                WHERE Lawsuit_Matter__c = :current.Lawsuit_Matter__c
                AND Id != :matterId
                WITH SECURITY_ENFORCED
                ORDER BY Name
                LIMIT :maxRecords
            ];
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
