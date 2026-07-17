public with sharing class SubtaskTemplateUiController {

    @AuraEnabled(cacheable=true)
    public static List<Subtask_Template__c> getTemplates() {
        return [SELECT Id, Name FROM Subtask_Template__c ORDER BY Name ASC];
    }

    @AuraEnabled(cacheable=true)
    public static List<Subtask_Template_Item__c> getTemplateItems(Id templateId) {
        return [
            SELECT Id, Sequence_Order__c, Subject__c, Description__c,
                   Assignee_Type__c, Static_Assignee__c, Static_Assignee__r.Name,
                   Dynamic_Assignee_Field__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];
    }

    @AuraEnabled
    public static Id applyTemplate(Id templateId, Id matterId) {
        try {
            return SubtaskTemplateApplier.apply(templateId, matterId);
        } catch (SubtaskTemplateApplier.SubtaskTemplateApplierException e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
