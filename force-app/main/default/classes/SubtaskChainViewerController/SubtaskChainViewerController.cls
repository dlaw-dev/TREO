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
        // Null means this step opens immediately (no dependency) - resolved
        // against sibling steps already fetched for this same chain, no
        // extra query needed.
        @AuraEnabled public String dependsOnSubject;
    }

    @AuraEnabled(cacheable=true)
    public static List<ChainDto> getChainsForMatter(Id matterId) {
        try {
            List<Task> tasks = [
                SELECT Id, Subject, Status, Owner.Name, Parent_Task__c,
                       Subtask_Template_Item__c,
                       Subtask_Template_Item__r.Sequence_Order__c,
                       Subtask_Template_Item__r.Depends_On_Step__c,
                       Subtask_Template_Item__r.Subtask_Template__r.Name
                FROM Task
                WHERE NEOS_Matter__c = :matterId
                  AND Subtask_Template_Item__c != null
                ORDER BY Subtask_Template_Item__r.Sequence_Order__c ASC
            ];

            Map<String, ChainDto> chainsByParent = new Map<String, ChainDto>();

            // Lets a step's dependency resolve to its sibling's Subject within
            // the same chain, regardless of iteration/insertion order.
            Map<String, String> subjectByCompositeKey = new Map<String, String>();
            Map<Id, String> dependsOnKeyByStepId = new Map<Id, String>();

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

                subjectByCompositeKey.put(chainKey + ':' + t.Subtask_Template_Item__c, t.Subject);

                Id dependsOnItemId = t.Subtask_Template_Item__r.Depends_On_Step__c;
                if (dependsOnItemId != null) {
                    dependsOnKeyByStepId.put(t.Id, chainKey + ':' + dependsOnItemId);
                }
            }

            for (ChainDto chain : chainsByParent.values()) {
                for (StepDto step : chain.steps) {
                    String key = dependsOnKeyByStepId.get(step.id);
                    step.dependsOnSubject = (key != null) ? subjectByCompositeKey.get(key) : null;
                }
            }

            return chainsByParent.values();
        } catch (Exception e) {
            throw new AuraHandledException('Error loading task chains: ' + e.getMessage());
        }
    }
}
