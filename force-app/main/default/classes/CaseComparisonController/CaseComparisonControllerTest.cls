@IsTest
private class CaseComparisonControllerTest {

    private static NEOS_Matter__c makeMatter() {
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Case_Title__c = 'Test Case Title',
            Case_Name__c = 'Smith v. Acme Corp',
            Complaint_Filed_Date__c = Date.newInstance(2026, 1, 15),
            CourtJurisdiction__c = 'State',
            State_Docket__c = 'CV-26-001',
            FederalDocket__c = 'FED-26-001',
            Causes_of_Action__c = 'Class/PAGA:\n1. Meal Period Violations',
            LWDA__c = 'LWDA-001',
            LWDA_Filing_Date__c = Date.newInstance(2026, 1, 1),
            Class_Definition__c = 'All non-exempt employees',
            PAGA_Definition__c = 'All non-exempt employees for PAGA purposes',
            Stage__c = 'Filed/Pending',
            Settlement_Status__c = 'Drafting MOU'
        );
        insert matter;
        return matter;
    }

    private static Topfiling__c makeFiling(Id matterId) {
        Topfiling__c filing = new Topfiling__c(
            TREO_Matter__c = matterId,
            Plaintiffs__c = 'John Doe',
            Date_Filed_Court__c = Date.newInstance(2026, 2, 1),
            Court_Case_No__c = 'CV-2026-999',
            Defendants__c = 'Acme Corp',
            Claims_Alleged__c = 'Class/PAGA:\n1. Wage Statement Violations',
            LWDA_No__c = 'LWDA-999',
            Date_Filed_LWDA__c = Date.newInstance(2026, 1, 20),
            Class_PAGA_Definition__c = 'All hourly employees',
            Case_Status__c = 'Active'
        );
        insert filing;
        return filing;
    }

    @IsTest
    static void testGetComparisonWithPopulatedFields() {
        NEOS_Matter__c matter = makeMatter();

        Account defendantAccount = new Account(Name = 'Acme Corp');
        insert defendantAccount;
        insert new Involved_Parties__c(
            Matter__c = matter.Id,
            Involved_Party__c = defendantAccount.Id,
            Relationship__c = 'Defendant'
        );

        Provider__c opposingCounsel = new Provider__c(Name = 'Jones & Associates', Role__c = 'Attorney');
        insert opposingCounsel;
        insert new Counsel_Junction__c(
            Matter__c = matter.Id,
            Counsel__c = opposingCounsel.Id,
            Type__c = 'Opposing Counsel'
        );

        Provider__c coCounselFirm = new Provider__c(Name = 'Smith Co-Counsel LLP', Role__c = 'Law Firm');
        insert coCounselFirm;
        insert new JPA__c(
            Matter__c = matter.Id,
            Firm_or_Lawyer_Name__c = coCounselFirm.Id,
            JPA_Portion__c = 25,
            JPA_Fully_Signed__c = true
        );

        Topfiling__c filing = makeFiling(matter.Id);

        Test.startTest();
        CaseComparisonController.ComparisonData data = CaseComparisonController.getComparison(filing.Id);
        Test.stopTest();

        System.assertEquals(matter.Id, data.matterId);
        System.assertEquals(1, data.jpaRows.size());
        System.assertEquals('Smith Co-Counsel LLP', data.jpaRows[0].firmOrLawyerName);
        System.assertEquals('25%', data.jpaRows[0].jpaPortion);
        System.assertEquals('Yes', data.jpaRows[0].fullySigned);
        System.assertEquals('Smith v. Acme Corp', data.matterCaseName);
        System.assertEquals('John Doe v. Acme Corp', data.otherCaseName);

        Map<String, CaseComparisonController.ComparisonRow> rowsByLabel = new Map<String, CaseComparisonController.ComparisonRow>();
        for (CaseComparisonController.ComparisonRow r : data.rows) {
            rowsByLabel.put(r.label, r);
        }
        System.assertEquals('Acme Corp', rowsByLabel.get('Defendants').dLawValue);
        System.assertEquals('Filed/Pending / Drafting MOU', rowsByLabel.get('Case Status').dLawValue);
        System.assertEquals('Active', rowsByLabel.get('Case Status').otherValue);
        System.assertEquals('Jones & Associates', rowsByLabel.get('Defendant Attorneys').dLawValue);

        System.assertEquals('2026-01-15', data.matterEdits.complaintFiledDate);
        System.assertEquals('CV-26-001', data.matterEdits.stateDocket);
        System.assertEquals('FED-26-001', data.matterEdits.federalDocket);
        System.assertEquals('LWDA-001', data.matterEdits.lwdaNumber);
        System.assertEquals('2026-01-01', data.matterEdits.lwdaFilingDate);
        System.assertEquals('All non-exempt employees for PAGA purposes', data.matterEdits.pagaDefinition);

        System.assertEquals('CV-2026-999', data.filingEdits.caseNumber);
        System.assertEquals('Acme Corp', data.filingEdits.defendants);
        System.assertEquals('LWDA-999', data.filingEdits.lwdaNumber);
        System.assertEquals('2026-01-20', data.filingEdits.lwdaFilingDate);
    }

    @IsTest
    static void testGetComparisonWithNullFields() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Case_Title__c = 'Bare Matter');
        insert matter;

        Topfiling__c filing = new Topfiling__c(TREO_Matter__c = matter.Id);
        insert filing;

        Test.startTest();
        CaseComparisonController.ComparisonData data = CaseComparisonController.getComparison(filing.Id);
        Test.stopTest();

        System.assertEquals('Bare Matter', data.matterCaseName);
        System.assertEquals(null, data.otherCaseName);
        System.assertEquals(null, data.matterEdits.complaintFiledDate);
        System.assertEquals(null, data.filingEdits.lwdaFilingDate);

        Map<String, CaseComparisonController.ComparisonRow> rowsByLabel = new Map<String, CaseComparisonController.ComparisonRow>();
        for (CaseComparisonController.ComparisonRow r : data.rows) {
            rowsByLabel.put(r.label, r);
        }
        System.assertEquals(null, rowsByLabel.get('Defendants').dLawValue);
        // Stage__c defaults to 'Signed/Unfiled' even on a bare insert, so this isn't blank.
        System.assertEquals('Signed/Unfiled', rowsByLabel.get('Case Status').dLawValue);
        System.assertEquals(null, rowsByLabel.get('Case Status').otherValue);
        System.assertEquals(0, data.jpaRows.size());
    }

    @IsTest
    static void testSaveComparisonUpdatesBothRecords() {
        NEOS_Matter__c matter = makeMatter();
        Topfiling__c filing = makeFiling(matter.Id);

        CaseComparisonController.MatterEditableValues matterEdits = new CaseComparisonController.MatterEditableValues();
        matterEdits.complaintFiledDate = '2026-03-01';
        matterEdits.stateDocket = 'CV-26-002';
        matterEdits.federalDocket = 'FED-26-002';
        matterEdits.claims = 'Updated claims text';
        matterEdits.classDefinition = 'Updated class definition';
        matterEdits.lwdaNumber = 'LWDA-002';
        matterEdits.lwdaFilingDate = '2026-03-02';
        matterEdits.pagaDefinition = 'Updated PAGA definition';

        CaseComparisonController.FilingEditableValues filingEdits = new CaseComparisonController.FilingEditableValues();
        filingEdits.complaintFiledDate = '2026-03-05';
        filingEdits.caseNumber = 'CV-2026-1000';
        filingEdits.claims = 'Updated filing claims text';
        filingEdits.classDefinition = 'Updated filing class definition';
        filingEdits.defendants = 'Acme Corp; Acme Subsidiary Inc.';
        filingEdits.lwdaNumber = 'LWDA-1000';
        filingEdits.lwdaFilingDate = '2026-03-06';

        Test.startTest();
        CaseComparisonController.ComparisonData data = CaseComparisonController.saveComparison(filing.Id, matterEdits, filingEdits);
        Test.stopTest();

        System.assertEquals('Smith v. Acme Corp', data.matterCaseName);
        System.assertEquals('John Doe v. Acme Corp; Acme Subsidiary Inc.', data.otherCaseName);
        System.assertEquals('Acme Corp; Acme Subsidiary Inc.', data.filingEdits.defendants);

        NEOS_Matter__c refreshedMatter = [SELECT Complaint_Filed_Date__c, State_Docket__c, FederalDocket__c, Causes_of_Action__c, PAGA_Definition__c FROM NEOS_Matter__c WHERE Id = :matter.Id];
        System.assertEquals(Date.newInstance(2026, 3, 1), refreshedMatter.Complaint_Filed_Date__c);
        System.assertEquals('CV-26-002', refreshedMatter.State_Docket__c);
        System.assertEquals('FED-26-002', refreshedMatter.FederalDocket__c);
        System.assertEquals('Updated claims text', refreshedMatter.Causes_of_Action__c);
        System.assertEquals('Updated PAGA definition', refreshedMatter.PAGA_Definition__c);

        Topfiling__c refreshedFiling = [SELECT Date_Filed_Court__c, Defendants__c FROM Topfiling__c WHERE Id = :filing.Id];
        System.assertEquals(Date.newInstance(2026, 3, 5), refreshedFiling.Date_Filed_Court__c);
        System.assertEquals('Acme Corp; Acme Subsidiary Inc.', refreshedFiling.Defendants__c);
    }

    @IsTest
    static void testGetMatterComparisonWithNoFilings() {
        NEOS_Matter__c matter = makeMatter();

        Test.startTest();
        CaseComparisonController.MatterComparisonData data = CaseComparisonController.getMatterComparison(matter.Id);
        Test.stopTest();

        System.assertEquals(matter.Id, data.matterId);
        System.assertEquals('Smith v. Acme Corp', data.matterCaseName);
        System.assertEquals(0, data.filingColumns.size());

        Map<String, CaseComparisonController.MatterComparisonRow> rowsByLabel = new Map<String, CaseComparisonController.MatterComparisonRow>();
        for (CaseComparisonController.MatterComparisonRow r : data.rows) {
            rowsByLabel.put(r.label, r);
        }
        System.assertEquals('Filed/Pending / Drafting MOU', rowsByLabel.get('Case Status').dLawValue);
        System.assertEquals(0, rowsByLabel.get('Case Status').otherValues.size());
    }

    @IsTest
    static void testGetMatterComparisonWithMultipleFilings() {
        NEOS_Matter__c matter = makeMatter();
        Topfiling__c filingOne = makeFiling(matter.Id);
        Topfiling__c filingTwo = new Topfiling__c(
            TREO_Matter__c = matter.Id,
            Plaintiffs__c = 'Jane Roe',
            Defendants__c = 'Acme Corp Subsidiary',
            Court_Case_No__c = 'CV-2026-2000',
            Case_Status__c = 'Settled'
        );
        insert filingTwo;

        Test.startTest();
        CaseComparisonController.MatterComparisonData data = CaseComparisonController.getMatterComparison(matter.Id);
        Test.stopTest();

        System.assertEquals(2, data.filingColumns.size());
        System.assertEquals(filingOne.Id, data.filingColumns[0].filingId);
        System.assertEquals(filingTwo.Id, data.filingColumns[1].filingId);
        System.assertEquals('John Doe v. Acme Corp', data.filingColumns[0].header);
        System.assertEquals('Jane Roe v. Acme Corp Subsidiary', data.filingColumns[1].header);
        System.assertEquals('CV-2026-999', data.filingColumns[0].edits.caseNumber);
        System.assertEquals('CV-2026-2000', data.filingColumns[1].edits.caseNumber);

        Map<String, CaseComparisonController.MatterComparisonRow> rowsByLabel = new Map<String, CaseComparisonController.MatterComparisonRow>();
        for (CaseComparisonController.MatterComparisonRow r : data.rows) {
            rowsByLabel.put(r.label, r);
        }
        System.assertEquals('Active', rowsByLabel.get('Case Status').otherValues[0]);
        System.assertEquals('Settled', rowsByLabel.get('Case Status').otherValues[1]);
    }

    @IsTest
    static void testSaveMatterComparisonUpdatesMatterAndAllFilings() {
        NEOS_Matter__c matter = makeMatter();
        Topfiling__c filingOne = makeFiling(matter.Id);
        Topfiling__c filingTwo = new Topfiling__c(TREO_Matter__c = matter.Id, Court_Case_No__c = 'CV-2026-2000');
        insert filingTwo;

        CaseComparisonController.MatterEditableValues matterEdits = new CaseComparisonController.MatterEditableValues();
        matterEdits.stateDocket = 'CV-26-003';

        CaseComparisonController.FilingEditableValues editsOne = new CaseComparisonController.FilingEditableValues();
        editsOne.caseNumber = 'CV-2026-999-UPDATED';
        CaseComparisonController.FilingColumnEdits columnEditsOne = new CaseComparisonController.FilingColumnEdits();
        columnEditsOne.filingId = filingOne.Id;
        columnEditsOne.edits = editsOne;

        CaseComparisonController.FilingEditableValues editsTwo = new CaseComparisonController.FilingEditableValues();
        editsTwo.caseNumber = 'CV-2026-2000-UPDATED';
        CaseComparisonController.FilingColumnEdits columnEditsTwo = new CaseComparisonController.FilingColumnEdits();
        columnEditsTwo.filingId = filingTwo.Id;
        columnEditsTwo.edits = editsTwo;

        Test.startTest();
        CaseComparisonController.MatterComparisonData data = CaseComparisonController.saveMatterComparison(
            matter.Id, matterEdits, new List<CaseComparisonController.FilingColumnEdits>{ columnEditsOne, columnEditsTwo }
        );
        Test.stopTest();

        System.assertEquals(2, data.filingColumns.size());

        NEOS_Matter__c refreshedMatter = [SELECT State_Docket__c FROM NEOS_Matter__c WHERE Id = :matter.Id];
        System.assertEquals('CV-26-003', refreshedMatter.State_Docket__c);

        Map<Id, Topfiling__c> refreshedFilings = new Map<Id, Topfiling__c>(
            [SELECT Court_Case_No__c FROM Topfiling__c WHERE Id IN (:filingOne.Id, :filingTwo.Id)]
        );
        System.assertEquals('CV-2026-999-UPDATED', refreshedFilings.get(filingOne.Id).Court_Case_No__c);
        System.assertEquals('CV-2026-2000-UPDATED', refreshedFilings.get(filingTwo.Id).Court_Case_No__c);
    }
}
