public with sharing class CaseComparisonController {

    public class ComparisonRow {
        @AuraEnabled public String label;
        @AuraEnabled public String dLawValue;
        @AuraEnabled public String otherValue;
    }

    // Values for the fields that are directly editable on the Matter — plain text/date/textarea
    // fields only. Lookups (Attys, Venue), status picklists, and the Defendants roll-up from
    // Involved_Parties__c stay read-only (see ComparisonData.rows).
    public class MatterEditableValues {
        @AuraEnabled public String complaintFiledDate; // ISO yyyy-MM-dd
        @AuraEnabled public String lwdaFilingDate; // ISO yyyy-MM-dd
        @AuraEnabled public String lwdaNumber;
        @AuraEnabled public String stateDocket;
        @AuraEnabled public String federalDocket;
        @AuraEnabled public String claims;
        @AuraEnabled public String classDefinition;
        @AuraEnabled public String pagaDefinition;
    }

    public class FilingEditableValues {
        @AuraEnabled public String complaintFiledDate;
        @AuraEnabled public String lwdaFilingDate;
        @AuraEnabled public String lwdaNumber;
        @AuraEnabled public String caseNumber;
        @AuraEnabled public String claims;
        @AuraEnabled public String classDefinition;
        @AuraEnabled public String defendants;
    }

    // JPA/co-counsel agreements on the matter — not a comparison against Topfiling, so this
    // doesn't have a dLaw/other split like ComparisonRow; it's just a list.
    public class JpaRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String firmOrLawyerName;
        @AuraEnabled public String jpaPortion;
        @AuraEnabled public String fullySigned;
    }

    public class ComparisonData {
        @AuraEnabled public Id matterId;
        @AuraEnabled public String matterCaseName;
        @AuraEnabled public String otherCaseName;
        @AuraEnabled public String otherFirmName;
        @AuraEnabled public List<ComparisonRow> rows;
        @AuraEnabled public List<JpaRow> jpaRows;
        @AuraEnabled public MatterEditableValues matterEdits;
        @AuraEnabled public FilingEditableValues filingEdits;
    }

    @AuraEnabled(cacheable=true)
    public static ComparisonData getComparison(Id topfilingId) {
        return buildComparisonData(topfilingId);
    }

    @AuraEnabled
    public static ComparisonData saveComparison(Id topfilingId, MatterEditableValues matterEdits, FilingEditableValues filingEdits) {
        Topfiling__c filing = getFiling(topfilingId);

        Topfiling__c filingToUpdate = new Topfiling__c(Id = filing.Id);
        filingToUpdate.Date_Filed_Court__c = parseIsoDate(filingEdits.complaintFiledDate);
        filingToUpdate.Court_Case_No__c = filingEdits.caseNumber;
        filingToUpdate.Claims_Alleged__c = filingEdits.claims;
        filingToUpdate.Class_PAGA_Definition__c = filingEdits.classDefinition;
        filingToUpdate.Defendants__c = filingEdits.defendants;
        filingToUpdate.LWDA_No__c = filingEdits.lwdaNumber;
        filingToUpdate.Date_Filed_LWDA__c = parseIsoDate(filingEdits.lwdaFilingDate);

        NEOS_Matter__c matterToUpdate = new NEOS_Matter__c(Id = filing.TREO_Matter__c);
        matterToUpdate.Complaint_Filed_Date__c = parseIsoDate(matterEdits.complaintFiledDate);
        matterToUpdate.State_Docket__c = matterEdits.stateDocket;
        matterToUpdate.FederalDocket__c = matterEdits.federalDocket;
        matterToUpdate.Causes_of_Action__c = matterEdits.claims;
        matterToUpdate.Class_Definition__c = matterEdits.classDefinition;
        matterToUpdate.PAGA_Definition__c = matterEdits.pagaDefinition;
        matterToUpdate.LWDA__c = matterEdits.lwdaNumber;
        matterToUpdate.LWDA_Filing_Date__c = parseIsoDate(matterEdits.lwdaFilingDate);

        try {
            update filingToUpdate;
            update matterToUpdate;
        } catch (DmlException e) {
            throw new AuraHandledException('Could not save changes: ' + e.getDmlMessage(0));
        }

        return buildComparisonData(topfilingId);
    }

    private static Topfiling__c getFiling(Id topfilingId) {
        List<Topfiling__c> filings = [
            SELECT Plaintiffs__c, Date_Filed_Court__c, Court_Case_No__c,
                   Court__r.Name, Plaintiff_Law_Firm_or_Lawyer__r.Name, Plaintiff_Law_Firm_or_Lawyer_2__r.Name,
                   Defendant_Law_Firm_or_Lawyer__r.Name, Defendant_Law_Firm_or_Lawyer_2__r.Name,
                   Defendants__c, Claims_Alleged__c, LWDA_No__c, Date_Filed_LWDA__c, Class_PAGA_Definition__c,
                   Case_Status__c, TREO_Matter__c
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
        return filing;
    }

    private static ComparisonData buildComparisonData(Id topfilingId) {
        Topfiling__c filing = getFiling(topfilingId);

        List<NEOS_Matter__c> matters = [
            SELECT Name, Case_Name__c, Complaint_Filed_Date__c,
                   Senior_Attorney__r.Name, Associate_Attorney__r.Name,
                   CourtJurisdiction__c, State_Court__r.Name, Federal_Court__r.Name,
                   State_Docket__c, FederalDocket__c,
                   Causes_of_Action__c, LWDA__c, LWDA_Filing_Date__c, Class_Definition__c, PAGA_Definition__c,
                   Stage__c, Settlement_Status__c
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

        List<String> opposingCounselNames = new List<String>();
        for (Counsel_Junction__c cj : [
            SELECT Counsel__r.Name
            FROM Counsel_Junction__c
            WHERE Matter__c = :matter.Id AND Type__c = 'Opposing Counsel'
        ]) {
            opposingCounselNames.add(cj.Counsel__r.Name);
        }

        List<JpaRow> jpaRows = new List<JpaRow>();
        for (JPA__c j : [
            SELECT Id, Firm_or_Lawyer_Name__r.Name, JPA_Portion__c, JPA_Fully_Signed__c
            FROM JPA__c
            WHERE Matter__c = :matter.Id
        ]) {
            JpaRow jr = new JpaRow();
            jr.id = j.Id;
            jr.firmOrLawyerName = j.Firm_or_Lawyer_Name__r?.Name;
            jr.jpaPortion = formatPercent(j.JPA_Portion__c);
            jr.fullySigned = j.JPA_Fully_Signed__c ? 'Yes' : 'No';
            jpaRows.add(jr);
        }

        ComparisonData data = new ComparisonData();
        data.matterId = matter.Id;
        data.matterCaseName = String.isNotBlank(matter.Case_Name__c) ? matter.Case_Name__c : matter.Name;
        data.otherCaseName = buildVCaseName(filing.Plaintiffs__c, filing.Defendants__c);
        data.otherFirmName = filing.Plaintiff_Law_Firm_or_Lawyer__r?.Name;

        // Read-only rows only — lookups, status picklists, and the Matter-side Defendants
        // roll-up. Everything else is editable and lives in matterEdits/filingEdits.
        data.rows = new List<ComparisonRow>{
            row('Plaintiff Attorneys',
                joinNonBlank(new List<String>{ matter.Senior_Attorney__r?.Name, matter.Associate_Attorney__r?.Name }),
                joinNonBlank(new List<String>{ filing.Plaintiff_Law_Firm_or_Lawyer__r?.Name, filing.Plaintiff_Law_Firm_or_Lawyer_2__r?.Name })),
            row('Defendant Attorneys',
                blankToNull(String.join(opposingCounselNames, '; ')),
                joinNonBlank(new List<String>{ filing.Defendant_Law_Firm_or_Lawyer__r?.Name, filing.Defendant_Law_Firm_or_Lawyer_2__r?.Name })),
            row('Venue',
                joinNonBlank(new List<String>{ matter.State_Court__r?.Name != null ? matter.State_Court__r.Name : matter.Federal_Court__r?.Name, matter.CourtJurisdiction__c }),
                filing.Court__r?.Name),
            row('Defendants', blankToNull(String.join(defendantNames, '; ')), null),
            row('Case Status',
                joinNonBlank(new List<String>{ matter.Stage__c, matter.Settlement_Status__c }),
                filing.Case_Status__c)
        };
        data.jpaRows = jpaRows;

        data.matterEdits = new MatterEditableValues();
        data.matterEdits.complaintFiledDate = isoDate(matter.Complaint_Filed_Date__c);
        data.matterEdits.lwdaFilingDate = isoDate(matter.LWDA_Filing_Date__c);
        data.matterEdits.lwdaNumber = matter.LWDA__c;
        data.matterEdits.stateDocket = matter.State_Docket__c;
        data.matterEdits.federalDocket = matter.FederalDocket__c;
        data.matterEdits.claims = matter.Causes_of_Action__c;
        data.matterEdits.classDefinition = matter.Class_Definition__c;
        data.matterEdits.pagaDefinition = matter.PAGA_Definition__c;

        data.filingEdits = new FilingEditableValues();
        data.filingEdits.complaintFiledDate = isoDate(filing.Date_Filed_Court__c);
        data.filingEdits.lwdaFilingDate = isoDate(filing.Date_Filed_LWDA__c);
        data.filingEdits.lwdaNumber = filing.LWDA_No__c;
        data.filingEdits.caseNumber = filing.Court_Case_No__c;
        data.filingEdits.claims = filing.Claims_Alleged__c;
        data.filingEdits.classDefinition = filing.Class_PAGA_Definition__c;
        data.filingEdits.defendants = filing.Defendants__c;

        return data;
    }

    private static ComparisonRow row(String label, String dLawValue, String otherValue) {
        ComparisonRow r = new ComparisonRow();
        r.label = label;
        r.dLawValue = dLawValue;
        r.otherValue = otherValue;
        return r;
    }

    private static String buildVCaseName(String plaintiffs, String defendants) {
        if (String.isBlank(plaintiffs) && String.isBlank(defendants)) {
            return null;
        }
        return (String.isNotBlank(plaintiffs) ? plaintiffs : '') + ' v. ' + (String.isNotBlank(defendants) ? defendants : '');
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

    private static String formatPercent(Decimal d) {
        if (d == null) {
            return null;
        }
        Decimal rounded = d.setScale(2);
        if (rounded == rounded.setScale(0)) {
            return String.valueOf(rounded.intValue()) + '%';
        }
        return String.valueOf(rounded) + '%';
    }

    private static String isoDate(Date d) {
        return d == null ? null : String.valueOf(d);
    }

    private static Date parseIsoDate(String iso) {
        if (String.isBlank(iso)) {
            return null;
        }
        List<String> parts = iso.split('-');
        return Date.newInstance(Integer.valueOf(parts[0]), Integer.valueOf(parts[1]), Integer.valueOf(parts[2]));
    }
}
