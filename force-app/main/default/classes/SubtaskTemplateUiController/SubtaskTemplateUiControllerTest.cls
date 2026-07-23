@IsTest
private class SubtaskTemplateUiControllerTest {

    private static Subtask_Template__c buildTemplate() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'UI Test Template');
        insert template;

        insert new List<Subtask_Template_Item__c>{
            new Subtask_Template_Item__c(
                Subtask_Template__c = template.Id,
                Sequence_Order__c   = 1,
                Subject__c          = 'Step One',
                Assignee_Type__c    = 'Static User',
                Static_Assignee__c  = staticAssignee.Id
            ),
            new Subtask_Template_Item__c(
                Subtask_Template__c        = template.Id,
                Sequence_Order__c          = 2,
                Subject__c                 = 'Step Two',
                Assignee_Type__c           = 'Dynamic Matter Field',
                Dynamic_Assignee_Field__c  = 'Senior_Attorney__c'
            )
        };

        return template;
    }

    @IsTest
    static void testGetTemplates_returnsTemplateWithStepCount() {
        Subtask_Template__c template = buildTemplate();

        Test.startTest();
        List<SubtaskTemplateUiController.TemplateDto> results = SubtaskTemplateUiController.getTemplates();
        Test.stopTest();

        SubtaskTemplateUiController.TemplateDto match;
        for (SubtaskTemplateUiController.TemplateDto dto : results) {
            if (dto.id == template.Id) {
                match = dto;
            }
        }

        System.assertNotEquals(null, match);
        System.assertEquals('UI Test Template', match.name);
        System.assertEquals(2, match.stepCount);
    }

    @IsTest
    static void testGetTemplateItems_returnsOrderedStepsWithFriendlyLabels() {
        Subtask_Template__c template = buildTemplate();

        Test.startTest();
        List<SubtaskTemplateUiController.TemplateItemDto> items = SubtaskTemplateUiController.getTemplateItems(template.Id, null);
        Test.stopTest();

        System.assertEquals(2, items.size());
        System.assertEquals('Step One', items[0].subject);
        System.assertEquals('David Yeremian', items[0].assigneeLabel);
        System.assertEquals('Step Two', items[1].subject);
        System.assertEquals('Senior Attorney', items[1].assigneeLabel);
        System.assertEquals(null, items[1].resolvedName, 'No matterId was passed, so a dynamic field should not resolve to a real name.');
    }

    @IsTest
    static void testGetTemplateItems_withMatterId_resolvesRealNameForDynamicStep() {
        Subtask_Template__c template = buildTemplate();

        User seniorAttorney = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Case',
            Senior_Attorney__c = seniorAttorney.Id
        );
        insert matter;

        Test.startTest();
        List<SubtaskTemplateUiController.TemplateItemDto> items = SubtaskTemplateUiController.getTemplateItems(template.Id, matter.Id);
        Test.stopTest();

        System.assertEquals('Senior Attorney', items[1].assigneeLabel);
        System.assertEquals(
            'David Yeremian',
            items[1].resolvedName,
            'With a matterId whose Senior_Attorney__c is set, the dynamic step should resolve to the real person.'
        );
    }

    @IsTest
    static void testApplyTemplate_createsChain() {
        Subtask_Template__c template = buildTemplate();
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Test.startTest();
        Id masterId = SubtaskTemplateUiController.applyTemplate(template.Id, matter.Id);
        Test.stopTest();

        List<Task> tasks = [SELECT Id FROM Task WHERE NEOS_Matter__c = :matter.Id];
        System.assertEquals(2, tasks.size());
        System.assertNotEquals(null, masterId);
    }

    @IsTest
    static void testApplyTemplate_wrapsApplierExceptionAsAuraHandled() {
        Subtask_Template__c emptyTemplate = new Subtask_Template__c(Name = 'Empty Template');
        insert emptyTemplate;

        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Boolean threw = false;
        Test.startTest();
        try {
            SubtaskTemplateUiController.applyTemplate(emptyTemplate.Id, matter.Id);
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw);
    }

    /* =========================================================
       Custom Templates
    ========================================================== */

    private static Subtask_Template__c buildCustomTemplate() {
        User staticAssignee = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Subtask_Template__c template = new Subtask_Template__c(Name = 'My Custom Template', Is_Custom__c = true);
        insert template;

        insert new List<Subtask_Template_Item__c>{
            new Subtask_Template_Item__c(
                Subtask_Template__c = template.Id,
                Sequence_Order__c   = 1,
                Subject__c          = 'Custom Step One',
                Assignee_Type__c    = 'Static User',
                Static_Assignee__c  = staticAssignee.Id
            )
        };

        return template;
    }

    private static SubtaskTemplateUiController.TemplateStepInput buildStepInput(String subject, Id assigneeId) {
        SubtaskTemplateUiController.TemplateStepInput step = new SubtaskTemplateUiController.TemplateStepInput();
        step.subject = subject;
        step.assigneeType = 'Static User';
        step.assigneeId = assigneeId;
        return step;
    }

    private static SubtaskTemplateUiController.TemplateStepInput buildRoleStepInput(String subject, String dynamicField) {
        SubtaskTemplateUiController.TemplateStepInput step = new SubtaskTemplateUiController.TemplateStepInput();
        step.subject = subject;
        step.assigneeType = 'Dynamic Matter Field';
        step.dynamicField = dynamicField;
        return step;
    }

    @IsTest
    static void testGetMatterRoleAssignees_resolvesRealNamesForAllThreeRoles() {
        User seniorAttorney = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Name = 'Test Matter',
            Case_Title__c = 'Test Case',
            Senior_Attorney__c = seniorAttorney.Id
        );
        insert matter;

        Test.startTest();
        SubtaskTemplateUiController.MatterRoleAssignees result = SubtaskTemplateUiController.getMatterRoleAssignees(matter.Id);
        Test.stopTest();

        System.assertEquals('David Yeremian', result.seniorAttorneyName);
        System.assertEquals(null, result.associateAttorneyName, 'Associate_Attorney__c was left blank on this matter.');
        System.assertEquals(null, result.lssParalegalName, 'LSS_Paralegal__c was left blank on this matter.');
    }

    @IsTest
    static void testGetMatterRoleAssignees_returnsBlankResultForNullMatterId() {
        Test.startTest();
        SubtaskTemplateUiController.MatterRoleAssignees result = SubtaskTemplateUiController.getMatterRoleAssignees(null);
        Test.stopTest();

        System.assertEquals(null, result.seniorAttorneyName);
    }

    @IsTest
    static void testGetTemplates_excludesCustomTemplates() {
        Subtask_Template__c prebuilt = buildTemplate();
        Subtask_Template__c custom = buildCustomTemplate();

        Test.startTest();
        List<SubtaskTemplateUiController.TemplateDto> results = SubtaskTemplateUiController.getTemplates();
        Test.stopTest();

        Set<Id> resultIds = new Set<Id>();
        for (SubtaskTemplateUiController.TemplateDto dto : results) {
            resultIds.add(dto.id);
        }

        System.assert(resultIds.contains(prebuilt.Id), 'Pre-built templates should still show up in getTemplates().');
        System.assert(!resultIds.contains(custom.Id), 'Custom templates should be excluded from getTemplates().');
    }

    @IsTest
    static void testGetMyCustomTemplates_returnsOnlyCallingUsersCustomTemplates() {
        Subtask_Template__c prebuilt = buildTemplate();
        Subtask_Template__c custom = buildCustomTemplate();

        Test.startTest();
        List<SubtaskTemplateUiController.TemplateDto> results = SubtaskTemplateUiController.getMyCustomTemplates();
        Test.stopTest();

        Set<Id> resultIds = new Set<Id>();
        for (SubtaskTemplateUiController.TemplateDto dto : results) {
            resultIds.add(dto.id);
        }

        System.assert(resultIds.contains(custom.Id), 'The running user\'s own custom template should be returned.');
        System.assert(!resultIds.contains(prebuilt.Id), 'Pre-built templates should not show up in getMyCustomTemplates().');
    }

    @IsTest
    static void testSaveCustomTemplate_createsTemplateWithOrderedStepsAndStaticAssignees() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Test.startTest();
        Id templateId = SubtaskTemplateUiController.saveCustomTemplate('New Template', new List<SubtaskTemplateUiController.TemplateStepInput>{
            buildStepInput('First Step', owner.Id),
            buildStepInput('Second Step', owner.Id)
        });
        Test.stopTest();

        Subtask_Template__c template = [SELECT Id, Name, Is_Custom__c FROM Subtask_Template__c WHERE Id = :templateId];
        System.assertEquals('New Template', template.Name);
        System.assertEquals(true, template.Is_Custom__c);

        List<Subtask_Template_Item__c> items = [
            SELECT Sequence_Order__c, Subject__c, Assignee_Type__c, Static_Assignee__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];
        System.assertEquals(2, items.size());
        System.assertEquals(1, items[0].Sequence_Order__c);
        System.assertEquals('First Step', items[0].Subject__c);
        System.assertEquals('Static User', items[0].Assignee_Type__c);
        System.assertEquals(owner.Id, items[0].Static_Assignee__c);
        System.assertEquals(2, items[1].Sequence_Order__c);
        System.assertEquals('Second Step', items[1].Subject__c);
    }

    @IsTest
    static void testSaveCustomTemplateFromUi_decodesJsonStepsCorrectly() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        String stepsJson = JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{ 'subject' => 'First Step', 'assigneeType' => 'Static User', 'assigneeId' => owner.Id, 'dynamicField' => null },
            new Map<String, Object>{ 'subject' => 'Second Step', 'assigneeType' => 'Static User', 'assigneeId' => owner.Id, 'dynamicField' => null }
        });

        Test.startTest();
        Id templateId = SubtaskTemplateUiController.saveCustomTemplateFromUi('UI Template', stepsJson);
        Test.stopTest();

        List<Subtask_Template_Item__c> items = [
            SELECT Sequence_Order__c, Subject__c, Assignee_Type__c, Static_Assignee__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];
        System.assertEquals(2, items.size());
        System.assertEquals('First Step', items[0].Subject__c);
        System.assertEquals(owner.Id, items[0].Static_Assignee__c);
        System.assertEquals('Second Step', items[1].Subject__c);
    }

    @IsTest
    static void testSaveCustomTemplateFromUi_rejectsUnparseableJson() {
        Boolean threw = false;

        Test.startTest();
        try {
            SubtaskTemplateUiController.saveCustomTemplateFromUi('Bad JSON Template', 'not valid json');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'Unparseable steps JSON should be rejected.');
    }

    @IsTest
    static void testSaveCustomTemplate_resultIsApplyCompatible() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Case');
        insert matter;

        Id templateId = SubtaskTemplateUiController.saveCustomTemplate('Applyable Template', new List<SubtaskTemplateUiController.TemplateStepInput>{
            buildStepInput('Only Step', owner.Id)
        });

        Test.startTest();
        Id masterId = SubtaskTemplateUiController.applyTemplate(templateId, matter.Id);
        Test.stopTest();

        List<Task> tasks = [SELECT Id FROM Task WHERE NEOS_Matter__c = :matter.Id];
        System.assertEquals(1, tasks.size());
        System.assertNotEquals(null, masterId);
    }

    @IsTest
    static void testSaveCustomTemplate_rejectsMissingNameOrIncompleteSteps() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Boolean blankNameThrew = false;
        Test.startTest();
        try {
            SubtaskTemplateUiController.saveCustomTemplate('', new List<SubtaskTemplateUiController.TemplateStepInput>{
                buildStepInput('A Step', owner.Id)
            });
        } catch (AuraHandledException e) {
            blankNameThrew = true;
        }

        Boolean noStepsThrew = false;
        try {
            SubtaskTemplateUiController.saveCustomTemplate('A Template', new List<SubtaskTemplateUiController.TemplateStepInput>());
        } catch (AuraHandledException e) {
            noStepsThrew = true;
        }

        Boolean incompleteStepThrew = false;
        try {
            SubtaskTemplateUiController.saveCustomTemplate('A Template', new List<SubtaskTemplateUiController.TemplateStepInput>{
                buildStepInput('A Step', null)
            });
        } catch (AuraHandledException e) {
            incompleteStepThrew = true;
        }
        Test.stopTest();

        System.assert(blankNameThrew, 'A blank template name should be rejected.');
        System.assert(noStepsThrew, 'A template with no steps should be rejected.');
        System.assert(incompleteStepThrew, 'A step missing an assignee should be rejected.');
    }

    @IsTest
    static void testSaveCustomTemplate_createsStepWithRoleBasedAssignee() {
        User owner = [SELECT Id FROM User WHERE Name = 'David Yeremian' AND IsActive = true LIMIT 1];

        Test.startTest();
        Id templateId = SubtaskTemplateUiController.saveCustomTemplate('Role Template', new List<SubtaskTemplateUiController.TemplateStepInput>{
            buildStepInput('Person Step', owner.Id),
            buildRoleStepInput('Senior Attorney Step', 'Senior_Attorney__c')
        });
        Test.stopTest();

        List<Subtask_Template_Item__c> items = [
            SELECT Sequence_Order__c, Assignee_Type__c, Static_Assignee__c, Dynamic_Assignee_Field__c
            FROM Subtask_Template_Item__c
            WHERE Subtask_Template__c = :templateId
            ORDER BY Sequence_Order__c ASC
        ];
        System.assertEquals(2, items.size());
        System.assertEquals('Static User', items[0].Assignee_Type__c);
        System.assertEquals(owner.Id, items[0].Static_Assignee__c);
        System.assertEquals('Dynamic Matter Field', items[1].Assignee_Type__c);
        System.assertEquals('Senior_Attorney__c', items[1].Dynamic_Assignee_Field__c);
        System.assertEquals(null, items[1].Static_Assignee__c);
    }

    @IsTest
    static void testSaveCustomTemplate_rejectsDynamicFieldNotOnWhitelist() {
        Boolean threw = false;

        Test.startTest();
        try {
            SubtaskTemplateUiController.saveCustomTemplate('Bad Role Template', new List<SubtaskTemplateUiController.TemplateStepInput>{
                buildRoleStepInput('A Step', 'Some_Arbitrary_Field__c')
            });
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A dynamic field not on the allowed-roles whitelist should be rejected.');
    }

    @IsTest
    static void testDeleteCustomTemplate_deletesOwnTemplateAndCascadesItems() {
        Subtask_Template__c custom = buildCustomTemplate();

        Test.startTest();
        SubtaskTemplateUiController.deleteCustomTemplate(custom.Id);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Subtask_Template__c WHERE Id = :custom.Id]);
        System.assertEquals(0, [SELECT COUNT() FROM Subtask_Template_Item__c WHERE Subtask_Template__c = :custom.Id]);
    }

    @IsTest
    static void testDeleteCustomTemplate_doesNotDeleteAPrebuiltTemplate() {
        Subtask_Template__c prebuilt = buildTemplate();

        Test.startTest();
        SubtaskTemplateUiController.deleteCustomTemplate(prebuilt.Id);
        Test.stopTest();

        System.assertEquals(1, [SELECT COUNT() FROM Subtask_Template__c WHERE Id = :prebuilt.Id],
            'deleteCustomTemplate should never be able to delete a non-custom (pre-built) template.');
    }
}
