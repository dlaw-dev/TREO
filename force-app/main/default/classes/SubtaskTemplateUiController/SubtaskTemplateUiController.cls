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

    public class MatterRoleAssignees {
        @AuraEnabled public String seniorAttorneyName;
        @AuraEnabled public String associateAttorneyName;
        @AuraEnabled public String lssParalegalName;
    }

    /**
     * Resolves who currently holds the 3 roles the custom template builder
     * offers, so the builder can show a real name (e.g. "Sam Silberman
     * (Senior Attorney)") instead of just the role name while the user is
     * picking an assignee - matching how pre-built templates resolve
     * Dynamic Matter Field steps in their own preview.
     */
    @AuraEnabled(cacheable=true)
    public static MatterRoleAssignees getMatterRoleAssignees(Id matterId) {
        MatterRoleAssignees result = new MatterRoleAssignees();
        if (matterId == null) {
            return result;
        }

        List<NEOS_Matter__c> matters = [
            SELECT Senior_Attorney__r.Name, Associate_Attorney__r.Name, LSS_Paralegal__r.Name
            FROM NEOS_Matter__c
            WHERE Id = :matterId
            LIMIT 1
        ];
        if (matters.isEmpty()) {
            return result;
        }

        NEOS_Matter__c matter = matters[0];
        result.seniorAttorneyName = matter.Senior_Attorney__r != null ? matter.Senior_Attorney__r.Name : null;
        result.associateAttorneyName = matter.Associate_Attorney__r != null ? matter.Associate_Attorney__r.Name : null;
        result.lssParalegalName = matter.LSS_Paralegal__r != null ? matter.LSS_Paralegal__r.Name : null;
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<TemplateDto> getTemplates() {
        List<Subtask_Template__c> templates = [
            SELECT Id, Name, (SELECT Id FROM Subtask_Template_Items__r)
            FROM Subtask_Template__c
            WHERE Is_Custom__c = false
            ORDER BY Name ASC
        ];

        return toDtos(templates);
    }

    /**
     * Templates the running user built themselves via the New Task modal's
     * template builder, as opposed to the admin-curated pre-built templates
     * getTemplates() returns.
     */
    @AuraEnabled(cacheable=true)
    public static List<TemplateDto> getMyCustomTemplates() {
        List<Subtask_Template__c> templates = [
            SELECT Id, Name, (SELECT Id FROM Subtask_Template_Items__r)
            FROM Subtask_Template__c
            WHERE Is_Custom__c = true AND OwnerId = :UserInfo.getUserId()
            ORDER BY Name ASC
        ];

        return toDtos(templates);
    }

    private static List<TemplateDto> toDtos(List<Subtask_Template__c> templates) {
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

    // The only "Dynamic Matter Field" options the self-serve builder exposes -
    // a fixed, friendly picklist of the 3 role lookups on the Matter, rather
    // than the admin-only free-form "any field" capability pre-built
    // templates have. Whitelisted here so the builder can't be used to wire
    // up an arbitrary field name.
    private static final Set<String> ALLOWED_DYNAMIC_FIELDS = new Set<String>{
        'Senior_Attorney__c', 'Associate_Attorney__c', 'LSS_Paralegal__c'
    };

    public class TemplateStepInput {
        @AuraEnabled public String subject;
        @AuraEnabled public String assigneeType;   // 'Static User' or 'Dynamic Matter Field'
        @AuraEnabled public Id assigneeId;         // set when assigneeType = 'Static User'
        @AuraEnabled public String dynamicField;   // set when assigneeType = 'Dynamic Matter Field'
    }

    /**
     * Builds a simple custom template: a name plus an ordered list of steps.
     * Each step is assigned either to a specific person (Static User) or to
     * whoever currently holds one of 3 Matter roles (Senior Attorney/
     * Associate Attorney/LSS Paralegal) - no free-form dynamic field, no
     * description, keeping the self-serve builder as simple as possible.
     * Structurally identical to a pre-built template either way, so
     * getTemplateItems()/applyTemplate() need no changes to support it.
     */
    @AuraEnabled
    public static Id saveCustomTemplate(String name, List<TemplateStepInput> steps) {
        if (String.isBlank(name)) {
            throw new AuraHandledException('Please give the template a name.');
        }
        if (steps == null || steps.isEmpty()) {
            throw new AuraHandledException('Add at least one step.');
        }
        for (Integer i = 0; i < steps.size(); i++) {
            TemplateStepInput s = steps[i];
            if (String.isBlank(s.subject)) {
                throw new AuraHandledException('Step ' + (i + 1) + ' needs a subject. [APEX DEBUG received subject=' + s.subject
                    + ' assigneeType=' + s.assigneeType + ' assigneeId=' + s.assigneeId + ' dynamicField=' + s.dynamicField
                    + ' stepsSize=' + steps.size() + ' name=' + name + ']');
            }
            if (s.assigneeType == 'Dynamic Matter Field') {
                if (!ALLOWED_DYNAMIC_FIELDS.contains(s.dynamicField)) {
                    throw new AuraHandledException('Step ' + (i + 1) + ' has an invalid role selection.');
                }
            } else if (s.assigneeId == null) {
                throw new AuraHandledException('Step ' + (i + 1) + ' needs an assignee.');
            }
        }

        Subtask_Template__c template = new Subtask_Template__c(Name = name, Is_Custom__c = true);
        insert template;

        List<Subtask_Template_Item__c> items = new List<Subtask_Template_Item__c>();
        for (Integer i = 0; i < steps.size(); i++) {
            Boolean isDynamic = steps[i].assigneeType == 'Dynamic Matter Field';
            items.add(new Subtask_Template_Item__c(
                Subtask_Template__c       = template.Id,
                Sequence_Order__c         = i + 1,
                Subject__c                = steps[i].subject,
                Assignee_Type__c          = isDynamic ? 'Dynamic Matter Field' : 'Static User',
                Static_Assignee__c        = isDynamic ? null : steps[i].assigneeId,
                Dynamic_Assignee_Field__c = isDynamic ? steps[i].dynamicField : null
            ));
        }
        insert items;

        return template.Id;
    }

    /**
     * Deletes a custom template the running user created. The Is_Custom__c
     * and OwnerId filters are what stop this from being able to touch a
     * pre-built template or another user's custom template.
     */
    @AuraEnabled
    public static void deleteCustomTemplate(Id templateId) {
        delete [
            SELECT Id
            FROM Subtask_Template__c
            WHERE Id = :templateId AND Is_Custom__c = true AND OwnerId = :UserInfo.getUserId()
        ];
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
