@IsTest
private class CaseComparisonControllerTest {

    private static NEOS_Matter__c makeMatter() {
        NEOS_Matter__c matter = new NEOS_Matter__c(
            Case_Title__c = 'Test Case Title',
            Case_Name__c = 'Smith v. Acme Corp',
            Complaint_Filed_Date__c = Date.newInstance(2026, 1, 15),
            CourtJurisdiction__c = 'State',
            Case__c = 'CV-26-001',
            PAGA_Definition__c = 'Class/PAGA:\n1. Meal Period Violations',
            LWDA__c = 'LWDA-001',
            LWDA_Filing_Date__c = Date.newInstance(2026, 1, 1),
            Class_Definition__c = 'All non-exempt employees',
            PreliminaryApprovalHearing__c = Date.newInstance(2026, 6, 1)
        );
        insert matter;
        return matter;
    }

    @IsTest
    static void testGetComparisonWithPopulatedFields() {
        NEOS_Matter__c matter = makeMatter();

        Account defendantAccount = new Account(Name = 'Acme Corp');
        insert defendantAccount;
        Involved_Parties__c defendant = new Involved_Parties__c(
            Matter__c = matter.Id,
            Involved_Party__c = defendantAccount.Id,
            Relationship__c = 'Defendant'
        );
        insert defendant;

        Topfiling__c filing = new Topfiling__c(
            TREO_Matter__c = matter.Id,
            Topfiled_Case_Title_Legacy__c = 'Doe v. Acme Corp',
            Date_Filed_Court__c = Date.newInstance(2026, 2, 1),
            Court_Case_No__c = 'CV-2026-999',
            Defendants__c = 'Acme Corp',
            Claims_Alleged__c = 'Class/PAGA:\n1. Wage Statement Violations',
            LWDA_No__c = 'LWDA-999',
            Date_Filed_LWDA__c = Date.newInstance(2026, 1, 20),
            Class_PAGA_Definition__c = 'All hourly employees'
        );
        insert filing;

        Test.startTest();
        CaseComparisonController.ComparisonData data = CaseComparisonController.getComparison(filing.Id);
        Test.stopTest();

        System.assertEquals('Smith v. Acme Corp', data.matterCaseName);
        System.assertEquals('Doe v. Acme Corp', data.otherCaseName);

        Map<String, CaseComparisonController.ComparisonRow> rowsByLabel = new Map<String, CaseComparisonController.ComparisonRow>();
        for (CaseComparisonController.ComparisonRow r : data.rows) {
            rowsByLabel.put(r.label, r);
        }

        System.assertEquals('Smith v. Acme Corp', rowsByLabel.get('Case Name').dLawValue);
        System.assertEquals('Doe v. Acme Corp', rowsByLabel.get('Case Name').otherValue);
        System.assertEquals('CV-26-001', rowsByLabel.get('Case Number').dLawValue);
        System.assertEquals('CV-2026-999', rowsByLabel.get('Case Number').otherValue);
        System.assertEquals('Acme Corp', rowsByLabel.get('Defendants').dLawValue);
        System.assertEquals('Acme Corp', rowsByLabel.get('Defendants').otherValue);
        System.assertEquals('All non-exempt employees', rowsByLabel.get('Class Definition').dLawValue);
        System.assertEquals('All hourly employees', rowsByLabel.get('Class Definition').otherValue);
        System.assertEquals('YES', rowsByLabel.get('Approval Hrg Scheduled?').dLawValue);
        System.assert(rowsByLabel.get('PAGA Claim').dLawValue.contains('LWDA-001'));
        System.assert(rowsByLabel.get('PAGA Claim').otherValue.contains('LWDA-999'));
        System.assertEquals(true, rowsByLabel.get('PAGA Claim').showFacRipeLine);
        System.assertEquals(false, rowsByLabel.get('Class Definition').showFacRipeLine);
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

        Map<String, CaseComparisonController.ComparisonRow> rowsByLabel = new Map<String, CaseComparisonController.ComparisonRow>();
        for (CaseComparisonController.ComparisonRow r : data.rows) {
            rowsByLabel.put(r.label, r);
        }

        System.assertEquals(null, rowsByLabel.get('Defendants').dLawValue);
        System.assertEquals(null, rowsByLabel.get('PAGA Claim').dLawValue);
        System.assertEquals('NO', rowsByLabel.get('Approval Hrg Scheduled?').dLawValue);
    }
}
