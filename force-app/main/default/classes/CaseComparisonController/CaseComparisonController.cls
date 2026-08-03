public with sharing class CaseComparisonController {

    public class ComparisonRow {
        @AuraEnabled public String label;
        @AuraEnabled public String dLawValue;
        @AuraEnabled public String otherValue;
        @AuraEnabled public Boolean showFacRipeLine;
    }

    public class ComparisonData {
        @AuraEnabled public String matterCaseName;
        @AuraEnabled public String otherCaseName;
        @AuraEnabled public String otherFirmName;
        @AuraEnabled public List<ComparisonRow> rows;
    }

    @AuraEnabled(cacheable=true)
    public static ComparisonData getComparison(Id topfilingId) {
        List<Topfiling__c> filings = [
            SELECT Topfiled_Case_Title_Legacy__c, Date_Filed_Court__c, Court_Case_No__c,
                   Court__r.Name, Plaintiff_Law_Firm_or_Lawyer__r.Name, Plaintiff_Law_Firm_or_Lawyer_2__r.Name,
                   Defendants__c, Claims_Alleged__c, LWDA_No__c, Date_Filed_LWDA__c, Class_PAGA_Definition__c,
                   TREO_Matter__c
            FROM Topfiling__c
            WHERE Id = :topfilingId
            LIMIT 1
        ];
        if (filings.isEmpty()) {
            throw new AuraHandledException('This Topfiling record could not be found (id received: ' + topfilingId + '). It may have been deleted, you may not have access to it, or the action may be passing the wrong record\'s Id.');
        }
        Topfiling__c filing = filings[0];

        if (filing.TREO_Matter__c == null) {
            throw new AuraHandledException('This Topfiling record is not linked to a Matter (the Matter lookup is blank), so there is nothing to compare it against.');
        }

        List<NEOS_Matter__c> matters = [
            SELECT Name, Case_Name__c, Complaint_Filed_Date__c,
                   Senior_Attorney__r.Name, Associate_Attorney__r.Name,
                   CourtJurisdiction__c, State_Court__r.Name, Federal_Court__r.Name,
                   Case__c,
                   PAGA_Definition__c, LWDA__c, LWDA_Filing_Date__c, Class_Definition__c,
                   PreliminaryApprovalHearing__c, Final_PAGA_Approval_Hearing_Date__c
            FROM NEOS_Matter__c
            WHERE Id = :filing.TREO_Matter__c
            LIMIT 1
        ];
        if (matters.isEmpty()) {
            throw new AuraHandledException('The Matter linked to this Topfiling record could not be found (it may have been deleted, or you may not have access to it).');
        }
        NEOS_Matter__c matter = matters[0];

        List<String> defendantNames = new List<String>();
        for (Involved_Parties__c ip : [
            SELECT Involved_Party_Name__c
            FROM Involved_Parties__c
            WHERE Matter__c = :matter.Id AND Relationship__c = 'Defendant'
        ]) {
            defendantNames.add(ip.Involved_Party_Name__c);
        }

        ComparisonData data = new ComparisonData();
        data.matterCaseName = String.isNotBlank(matter.Case_Name__c) ? matter.Case_Name__c : matter.Name;
        data.otherCaseName = filing.Topfiled_Case_Title_Legacy__c;
        data.otherFirmName = filing.Plaintiff_Law_Firm_or_Lawyer__r?.Name;

        data.rows = new List<ComparisonRow>{
            row('Case Name', data.matterCaseName, data.otherCaseName),
            row('Comp Filing Date', formatDate(matter.Complaint_Filed_Date__c), formatDate(filing.Date_Filed_Court__c)),
            row('Attys',
                joinNonBlank(new List<String>{ matter.Senior_Attorney__r?.Name, matter.Associate_Attorney__r?.Name }),
                joinNonBlank(new List<String>{ filing.Plaintiff_Law_Firm_or_Lawyer__r?.Name, filing.Plaintiff_Law_Firm_or_Lawyer_2__r?.Name })),
            row('Venue',
                joinNonBlank(new List<String>{ matter.State_Court__r?.Name != null ? matter.State_Court__r.Name : matter.Federal_Court__r?.Name, matter.CourtJurisdiction__c }),
                filing.Court__r?.Name),
            row('Case Number', matter.Case__c, filing.Court_Case_No__c),
            row('Defendants', blankToNull(String.join(defendantNames, '; ')), filing.Defendants__c),
            row('Claims', matter.PAGA_Definition__c, filing.Claims_Alleged__c),
            pagaClaimRow(
                joinNonBlank(new List<String>{ blankToNull(matter.LWDA__c) != null ? 'PAGA Letter: ' + matter.LWDA__c : null, matter.LWDA_Filing_Date__c != null ? 'Filed: ' + formatDate(matter.LWDA_Filing_Date__c) : null }),
                joinNonBlank(new List<String>{ blankToNull(filing.LWDA_No__c) != null ? 'PAGA Letter: ' + filing.LWDA_No__c : null, filing.Date_Filed_LWDA__c != null ? 'Filed: ' + formatDate(filing.Date_Filed_LWDA__c) : null })),
            row('Class Definition', matter.Class_Definition__c, filing.Class_PAGA_Definition__c),
            row('Approval Hrg Scheduled?',
                (matter.PreliminaryApprovalHearing__c != null || matter.Final_PAGA_Approval_Hearing_Date__c != null) ? 'YES' : 'NO',
                null)
        };

        return data;
    }

    private static ComparisonRow row(String label, String dLawValue, String otherValue) {
        ComparisonRow r = new ComparisonRow();
        r.label = label;
        r.dLawValue = dLawValue;
        r.otherValue = otherValue;
        r.showFacRipeLine = false;
        return r;
    }

    // The "FAC Adding PAGA Claim Ripe" line has no backing field on either object — it rides
    // along inside the PAGA Claim row as a blank label (matching the template's layout) rather
    // than a row of its own, since there's nothing on the record to pull for it.
    private static ComparisonRow pagaClaimRow(String dLawValue, String otherValue) {
        ComparisonRow r = row('PAGA Claim', dLawValue, otherValue);
        r.showFacRipeLine = true;
        return r;
    }

    private static String blankToNull(String value) {
        return String.isBlank(value) ? null : value;
    }

    private static String joinNonBlank(List<String> values) {
        List<String> present = new List<String>();
        for (String v : values) {
            if (String.isNotBlank(v)) {
                present.add(v);
            }
        }
        return present.isEmpty() ? null : String.join(present, ' / ');
    }

    private static String formatDate(Date d) {
        return d == null ? null : d.format();
    }
}
