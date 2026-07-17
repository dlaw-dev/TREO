public with sharing class SubtaskChainViewerController {

    public class ChainDto {
        @AuraEnabled public String templateName;
        @AuraEnabled public List<StepDto> steps;
    }

    public class StepDto {
        @AuraEnabled public Id id;
        @AuraEnabled public String subject;
        @AuraEnabled public String status;
        @AuraEnabled public String ownerName;
        @AuraEnabled public Decimal sequenceOrder;
    }

    @AuraEnabled(cacheable=true)
    public static List<ChainDto> getChainsForMatter(Id matterId) {
        List<Task> tasks = [
            SELECT Id, Subject, Status, Owner.Name, Parent_Task__c,
                   Subtask_Template_Item__r.Sequence_Order__c,
                   Subtask_Template_Item__r.Subtask_Template__r.Name
            FROM Task
            WHERE NEOS_Matter__c = :matterId
              AND Subtask_Template_Item__c != null
            ORDER BY Subtask_Template_Item__r.Sequence_Order__c ASC
        ];

        Map<String, ChainDto> chainsByParent = new Map<String, ChainDto>();

        for (Task t : tasks) {
            String chainKey = t.Parent_Task__c;
            ChainDto chain = chainsByParent.get(chainKey);

            if (chain == null) {
                chain = new ChainDto();
                chain.templateName = t.Subtask_Template_Item__r.Subtask_Template__r.Name;
                chain.steps = new List<StepDto>();
                chainsByParent.put(chainKey, chain);
            }

            StepDto step = new StepDto();
            step.id = t.Id;
            step.subject = t.Subject;
            step.status = t.Status;
            step.ownerName = t.Owner.Name;
            step.sequenceOrder = t.Subtask_Template_Item__r.Sequence_Order__c;
            chain.steps.add(step);
        }

        return chainsByParent.values();
    }
}
