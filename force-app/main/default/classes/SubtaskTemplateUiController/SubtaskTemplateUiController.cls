public with sharing class SubtaskTemplateUiController {

    public class TemplateDto {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public Integer stepCount;
    }

    public class TemplateItemDto {
        @AuraEnabled public Id id;
        @AuraEnabled public Decimal sequenceOrder;
        @AuraEnabled public String subject;
        @AuraEnabled public String description;
        @AuraEnabled public String assigneeType;
        @AuraEnabled public String assigneeLabel;
        @AuraEnabled public String resolvedName;
    }

    @AuraEnabled(cacheable=true)
    public static List<TemplateDto> getTemplates() {
        List<Subtask_Template__c> templates = [
            SELECT Id, Name, (SELECT Id FROM Subtask_Template_Items__r)
            FROM Subtask_Template__c
            ORDER BY Name ASC
        ];

        List<TemplateDto> results = new List<TemplateDto>();

        for (Subtask_Template__c t : templates) {
            TemplateDto dto = new TemplateDto();
            dto.id = t.Id;
            dto.name = t.Name;
            dto.stepCount = t.Subtask_Template_Items__r.size();
            results.add(dto);
        }

        return results;
    }

    @AuraEnabled(cacheable=true)
    public static List<TemplateItemDto> getTemplateItems(Id templateId, Id matterId) {
        List<Subtask_Template_Item__c> items = [
            SELECT Id, Sequence_Order__c, Subject__c, Description__c,
                   Assignee_Type__c, Static_Assignee__c, Static_Assignee__r.Name,
                   Dynamic_Assignee_Field__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];

        Map<String, Schema.SObjectField> matterFieldMap = Schema.SObjectType.NEOS_Matter__c.fields.getMap();

        // When previewing on a real Matter, resolve dynamic fields against it
        // so the preview shows the actual person (e.g. "Sasha Zambrano"), not
        // just the field name - lets users confirm who's really getting
        // tasked before they commit.
        Map<Id, Id> resolvedUserIdByItemId = new Map<Id, Id>();
        if (matterId != null) {
            Map<Id, Subtask_Template_Item__c> keyToItem = new Map<Id, Subtask_Template_Item__c>();
            Map<Id, Id> keyToMatterId = new Map<Id, Id>();
            for (Subtask_Template_Item__c item : items) {
                keyToItem.put(item.Id, item);
                keyToMatterId.put(item.Id, matterId);
            }
            resolvedUserIdByItemId = SubtaskAssigneeResolver.resolveAssigneesBulk(keyToItem, keyToMatterId);
        }

        Set<Id> resolvedUserIds = new Set<Id>(resolvedUserIdByItemId.values());
        Map<Id, User> resolvedUsersById = resolvedUserIds.isEmpty()
            ? new Map<Id, User>()
            : new Map<Id, User>([SELECT Id, Name FROM User WHERE Id IN :resolvedUserIds]);

        List<TemplateItemDto> results = new List<TemplateItemDto>();

        for (Subtask_Template_Item__c item : items) {
            TemplateItemDto dto = new TemplateItemDto();
            dto.id = item.Id;
            dto.sequenceOrder = item.Sequence_Order__c;
            dto.subject = item.Subject__c;
            dto.description = item.Description__c;
            dto.assigneeType = item.Assignee_Type__c;

            if (item.Assignee_Type__c == 'Static User') {
                dto.assigneeLabel = item.Static_Assignee__r != null ? item.Static_Assignee__r.Name : 'Unassigned';
            } else {
                dto.assigneeLabel = matterFieldLabel(matterFieldMap, item.Dynamic_Assignee_Field__c);
                User resolvedUser = resolvedUsersById.get(resolvedUserIdByItemId.get(item.Id));
                dto.resolvedName = resolvedUser != null ? resolvedUser.Name : null;
            }

            results.add(dto);
        }

        return results;
    }

    @AuraEnabled
    public static Id applyTemplate(Id templateId, Id matterId) {
        try {
            return SubtaskTemplateApplier.apply(templateId, matterId);
        } catch (SubtaskTemplateApplier.SubtaskTemplateApplierException e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private static String matterFieldLabel(Map<String, Schema.SObjectField> matterFieldMap, String fieldApiName) {
        if (String.isBlank(fieldApiName)) {
            return 'the Matter';
        }

        Schema.SObjectField field = matterFieldMap.get(fieldApiName.toLowerCase());
        return field != null ? field.getDescribe().getLabel() : fieldApiName;
    }
}
