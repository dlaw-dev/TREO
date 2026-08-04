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

    // Matter-launched view — one column per related Topfiling instead of a single "other" side.
    public class MatterComparisonRow {
        @AuraEnabled public String label;
        @AuraEnabled public String dLawValue;
        @AuraEnabled public List<String> otherValues; // one per filingColumns entry, same order
    }

    public class FilingColumn {
        @AuraEnabled public Id filingId;
        @AuraEnabled public String header;
        @AuraEnabled public FilingEditableValues edits;
    }

    public class FilingColumnEdits {
        @AuraEnabled public Id filingId;
        @AuraEnabled public FilingEditableValues edits;
    }

    public class MatterComparisonData {
        @AuraEnabled public Id matterId;
        @AuraEnabled public String matterCaseName;
        @AuraEnabled public MatterEditableValues matterEdits;
        @AuraEnabled public List<MatterComparisonRow> rows;
        @AuraEnabled public List<FilingColumn> filingColumns;
        @AuraEnabled public List<JpaRow> jpaRows;
    }

    @AuraEnabled(cacheable=true)
    public static ComparisonData getComparison(Id topfilingId) {
        return buildComparisonData(topfilingId);
    }

    @AuraEnabled
    public static ComparisonData saveComparison(Id topfilingId, MatterEditableValues matterEdits, FilingEditableValues filingEdits) {
        Topfiling__c filing = getFiling(topfilingId);

        Topfiling__c filingToUpdate = new Topfiling__c(Id = filing.Id);
        applyFilingEditsTo(filingToUpdate, filingEdits);

        NEOS_Matter__c matterToUpdate = new NEOS_Matter__c(Id = filing.TREO_Matter__c);
        applyMatterEditsTo(matterToUpdate, matterEdits);

        try {
            update filingToUpdate;
            update matterToUpdate;
        } catch (DmlException e) {
            throw new AuraHandledException('Could not save changes: ' + e.getDmlMessage(0));
        }

        return buildComparisonData(topfilingId);
    }

    @AuraEnabled(cacheable=true)
    public static MatterComparisonData getMatterComparison(Id matterId) {
        return buildMatterComparisonData(matterId);
    }

    @AuraEnabled
    public static MatterComparisonData saveMatterComparison(Id matterId, MatterEditableValues matterEdits, List<FilingColumnEdits> filingColumnEdits) {
        NEOS_Matter__c matterToUpdate = new NEOS_Matter__c(Id = matterId);
        applyMatterEditsTo(matterToUpdate, matterEdits);

        List<Topfiling__c> filingsToUpdate = new List<Topfiling__c>();
        for (FilingColumnEdits fce : filingColumnEdits) {
            Topfiling__c f = new Topfiling__c(Id = fce.filingId);
            applyFilingEditsTo(f, fce.edits);
            filingsToUpdate.add(f);
        }

        try {
            update matterToUpdate;
            if (!filingsToUpdate.isEmpty()) {
                update filingsToUpdate;
            }
        } catch (DmlException e) {
            throw new AuraHandledException('Could not save changes: ' + e.getDmlMessage(0));
        }

        return buildMatterComparisonData(matterId);
    }

    private static void applyMatterEditsTo(NEOS_Matter__c target, MatterEditableValues edits) {
        target.Complaint_Filed_Date__c = parseIsoDate(edits.complaintFiledDate);
        target.State_Docket__c = edits.stateDocket;
        target.FederalDocket__c = edits.federalDocket;
        target.Causes_of_Action__c = edits.claims;
        target.Class_Definition__c = edits.classDefinition;
        target.PAGA_Definition__c = edits.pagaDefinition;
        target.LWDA__c = edits.lwdaNumber;
        target.LWDA_Filing_Date__c = parseIsoDate(edits.lwdaFilingDate);
    }

    private static void applyFilingEditsTo(Topfiling__c target, FilingEditableValues edits) {
        target.Date_Filed_Court__c = parseIsoDate(edits.complaintFiledDate);
        target.Court_Case_No__c = edits.caseNumber;
        target.Claims_Alleged__c = edits.claims;
        target.Class_PAGA_Definition__c = edits.classDefinition;
        target.Defendants__c = edits.defendants;
        target.LWDA_No__c = edits.lwdaNumber;
        target.Date_Filed_LWDA__c = parseIsoDate(edits.lwdaFilingDate);
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
        NEOS_Matter__c matter = queryMatter(filing.TREO_Matter__c);

        List<String> defendantNames = queryDefendantNames(matter.Id);
        List<String> opposingCounselNames = queryOpposingCounselNames(matter.Id);
        List<JpaRow> jpaRows = queryJpaRows(matter.Id);

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

        data.matterEdits = buildMatterEditableValues(matter);
        data.filingEdits = buildFilingEditableValues(filing);

        return data;
    }

    private static MatterComparisonData buildMatterComparisonData(Id matterId) {
        NEOS_Matter__c matter = queryMatter(matterId);
        List<Topfiling__c> filings = getFilingsForMatter(matterId);

        List<String> defendantNames = queryDefendantNames(matter.Id);
        List<String> opposingCounselNames = queryOpposingCounselNames(matter.Id);
        List<JpaRow> jpaRows = queryJpaRows(matter.Id);

        List<String> plaintiffAttyOthers = new List<String>();
        List<String> defendantAttyOthers = new List<String>();
        List<String> venueOthers = new List<String>();
        List<String> caseStatusOthers = new List<String>();
        List<String> blankOthers = new List<String>();
        List<FilingColumn> filingColumns = new List<FilingColumn>();

        for (Topfiling__c filing : filings) {
            plaintiffAttyOthers.add(joinNonBlank(new List<String>{ filing.Plaintiff_Law_Firm_or_Lawyer__r?.Name, filing.Plaintiff_Law_Firm_or_Lawyer_2__r?.Name }));
            defendantAttyOthers.add(joinNonBlank(new List<String>{ filing.Defendant_Law_Firm_or_Lawyer__r?.Name, filing.Defendant_Law_Firm_or_Lawyer_2__r?.Name }));
            venueOthers.add(filing.Court__r?.Name);
            caseStatusOthers.add(filing.Case_Status__c);
            blankOthers.add(null);

            FilingColumn col = new FilingColumn();
            col.filingId = filing.Id;
            col.header = buildFilingHeader(filing);
            col.edits = buildFilingEditableValues(filing);
            filingColumns.add(col);
        }

        MatterComparisonData data = new MatterComparisonData();
        data.matterId = matter.Id;
        data.matterCaseName = String.isNotBlank(matter.Case_Name__c) ? matter.Case_Name__c : matter.Name;
        data.filingColumns = filingColumns;
        data.jpaRows = jpaRows;

        data.rows = new List<MatterComparisonRow>{
            matterRow('Plaintiff Attorneys',
                joinNonBlank(new List<String>{ matter.Senior_Attorney__r?.Name, matter.Associate_Attorney__r?.Name }),
                plaintiffAttyOthers),
            matterRow('Defendant Attorneys',
                blankToNull(String.join(opposingCounselNames, '; ')),
                defendantAttyOthers),
            matterRow('Venue',
                joinNonBlank(new List<String>{ matter.State_Court__r?.Name != null ? matter.State_Court__r.Name : matter.Federal_Court__r?.Name, matter.CourtJurisdiction__c }),
                venueOthers),
            matterRow('Defendants', blankToNull(String.join(defendantNames, '; ')), blankOthers),
            matterRow('Case Status',
                joinNonBlank(new List<String>{ matter.Stage__c, matter.Settlement_Status__c }),
                caseStatusOthers)
        };

        data.matterEdits = buildMatterEditableValues(matter);

        return data;
    }

    private static NEOS_Matter__c queryMatter(Id matterId) {
        List<NEOS_Matter__c> matters = [
            SELECT Name, Case_Name__c, Complaint_Filed_Date__c,
                   Senior_Attorney__r.Name, Associate_Attorney__r.Name,
                   CourtJurisdiction__c, State_Court__r.Name, Federal_Court__r.Name,
                   State_Docket__c, FederalDocket__c,
                   Causes_of_Action__c, LWDA__c, LWDA_Filing_Date__c, Class_Definition__c, PAGA_Definition__c,
                   Stage__c, Settlement_Status__c
            FROM NEOS_Matter__c
            WHERE Id = :matterId
            LIMIT 1
        ];
        if (matters.isEmpty()) {
            throw new AuraHandledException('The Matter could not be found (it may have been deleted, or you may not have access to it).');
        }
        return matters[0];
    }

    private static List<Topfiling__c> getFilingsForMatter(Id matterId) {
        return [
            SELECT Plaintiffs__c, Date_Filed_Court__c, Court_Case_No__c,
                   Court__r.Name, Plaintiff_Law_Firm_or_Lawyer__r.Name, Plaintiff_Law_Firm_or_Lawyer_2__r.Name,
                   Defendant_Law_Firm_or_Lawyer__r.Name, Defendant_Law_Firm_or_Lawyer_2__r.Name,
                   Defendants__c, Claims_Alleged__c, LWDA_No__c, Date_Filed_LWDA__c, Class_PAGA_Definition__c,
                   Case_Status__c
            FROM Topfiling__c
            WHERE TREO_Matter__c = :matterId
            ORDER BY CreatedDate
        ];
    }

    private static List<String> queryDefendantNames(Id matterId) {
        List<String> defendantNames = new List<String>();
        for (Involved_Parties__c ip : [
            SELECT Involved_Party_Name__c
            FROM Involved_Parties__c
            WHERE Matter__c = :matterId AND Relationship__c = 'Defendant'
        ]) {
            defendantNames.add(ip.Involved_Party_Name__c);
        }
        return defendantNames;
    }

    private static List<String> queryOpposingCounselNames(Id matterId) {
        List<String> opposingCounselNames = new List<String>();
        for (Counsel_Junction__c cj : [
            SELECT Counsel__r.Name
            FROM Counsel_Junction__c
            WHERE Matter__c = :matterId AND Type__c = 'Opposing Counsel'
        ]) {
            opposingCounselNames.add(cj.Counsel__r.Name);
        }
        return opposingCounselNames;
    }

    private static List<JpaRow> queryJpaRows(Id matterId) {
        List<JpaRow> jpaRows = new List<JpaRow>();
        for (JPA__c j : [
            SELECT Id, Firm_or_Lawyer_Name__r.Name, JPA_Portion__c, JPA_Fully_Signed__c
            FROM JPA__c
            WHERE Matter__c = :matterId
        ]) {
            JpaRow jr = new JpaRow();
            jr.id = j.Id;
            jr.firmOrLawyerName = j.Firm_or_Lawyer_Name__r?.Name;
            jr.jpaPortion = formatPercent(j.JPA_Portion__c);
            jr.fullySigned = j.JPA_Fully_Signed__c ? 'Yes' : 'No';
            jpaRows.add(jr);
        }
        return jpaRows;
    }

    private static MatterEditableValues buildMatterEditableValues(NEOS_Matter__c matter) {
        MatterEditableValues me = new MatterEditableValues();
        me.complaintFiledDate = isoDate(matter.Complaint_Filed_Date__c);
        me.lwdaFilingDate = isoDate(matter.LWDA_Filing_Date__c);
        me.lwdaNumber = matter.LWDA__c;
        me.stateDocket = matter.State_Docket__c;
        me.federalDocket = matter.FederalDocket__c;
        me.claims = matter.Causes_of_Action__c;
        me.classDefinition = matter.Class_Definition__c;
        me.pagaDefinition = matter.PAGA_Definition__c;
        return me;
    }

    private static FilingEditableValues buildFilingEditableValues(Topfiling__c filing) {
        FilingEditableValues fe = new FilingEditableValues();
        fe.complaintFiledDate = isoDate(filing.Date_Filed_Court__c);
        fe.lwdaFilingDate = isoDate(filing.Date_Filed_LWDA__c);
        fe.lwdaNumber = filing.LWDA_No__c;
        fe.caseNumber = filing.Court_Case_No__c;
        fe.claims = filing.Claims_Alleged__c;
        fe.classDefinition = filing.Class_PAGA_Definition__c;
        fe.defendants = filing.Defendants__c;
        return fe;
    }

    private static String buildFilingHeader(Topfiling__c filing) {
        String caseName = buildVCaseName(filing.Plaintiffs__c, filing.Defendants__c);
        String firm = filing.Plaintiff_Law_Firm_or_Lawyer__r?.Name;
        if (String.isBlank(caseName)) {
            caseName = '';
        }
        return String.isNotBlank(firm) ? caseName + ' (' + firm + ')' : caseName;
    }

    private static ComparisonRow row(String label, String dLawValue, String otherValue) {
        ComparisonRow r = new ComparisonRow();
        r.label = label;
        r.dLawValue = dLawValue;
        r.otherValue = otherValue;
        return r;
    }

    private static MatterComparisonRow matterRow(String label, String dLawValue, List<String> otherValues) {
        MatterComparisonRow r = new MatterComparisonRow();
        r.label = label;
        r.dLawValue = dLawValue;
        r.otherValues = otherValues;
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
