public with sharing class MatterGlobalSearchController {

    public class SearchResult {
        @AuraEnabled public String id;
        @AuraEnabled public String objectType;
        @AuraEnabled public String objectLabel;
        @AuraEnabled public String title;
        @AuraEnabled public String subtitle;
        @AuraEnabled public String preview;
        @AuraEnabled public String extra;
        @AuraEnabled public String iconName;
    }

    // ── Search (term-filtered) ────────────────────────────────

    @AuraEnabled(cacheable=false)
    public static List<SearchResult> search(Id matterId, String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 3) {
            return new List<SearchResult>();
        }

        String rawTerm = searchTerm.trim();
        String term = '%' + rawTerm.replace('\'', '').replace('\\', '') + '%';
        List<SearchResult> results = new List<SearchResult>();

        // Notes — Note_Description__c is Long Text Area (SOQL can't filter/LIKE on it),
        // so pull recent notes for the matter and match category/description in Apex.
        Integer noteMatches = 0;
        for (NEOS_Notes__c n : [
            SELECT Id, Name, Note_Description__c, Note_Category__c, NEOS_Created_Date__c, Staff__r.Name
            FROM NEOS_Notes__c
            WHERE NEOS_Matter__c = :matterId
            ORDER BY NEOS_Created_Date__c DESC NULLS LAST
            LIMIT 500
        ]) {
            if (noteMatches >= 10) break;
            Boolean categoryHit    = String.isNotBlank(n.Note_Category__c) && n.Note_Category__c.containsIgnoreCase(rawTerm);
            Boolean descriptionHit = String.isNotBlank(n.Note_Description__c) && n.Note_Description__c.containsIgnoreCase(rawTerm);
            if (categoryHit || descriptionHit) {
                results.add(makeNote(n));
                noteMatches++;
            }
        }

        // Time entries
        for (Time_Entry__c t : [
            SELECT Id, Name, Notes__c, Entry_Date__c, Staff__r.Name, Duration__c
            FROM Time_Entry__c
            WHERE NEOS_Matter__c = :matterId
            AND (Name LIKE :term OR Notes__c LIKE :term)
            LIMIT 10
        ]) {
            results.add(makeTimeEntry(t));
        }

        // Calendar events
        for (Calendar_Event__c c : [
            SELECT Id, Name, Subject__c, Event_Type__c, Start_DateTime__c
            FROM Calendar_Event__c
            WHERE Matter__c = :matterId
            AND (Name LIKE :term OR Subject__c LIKE :term OR Event_Type__c LIKE :term)
            LIMIT 10
        ]) {
            results.add(makeEvent(c));
        }

        // Tasks — Description is Long Text Area (no LIKE); search subject only
        for (Task t : [
            SELECT Id, Subject, Description, Status, ActivityDate
            FROM Task
            WHERE WhatId = :matterId
            AND Subject LIKE :term
            LIMIT 10
        ]) {
            results.add(makeTask(t));
        }

        // Involved parties
        try {
            for (Involved_Parties__c p : [
                SELECT Id, Name, Relationship__c
                FROM Involved_Parties__c
                WHERE Matter__c = :matterId
                AND (Name LIKE :term OR Relationship__c LIKE :term)
                LIMIT 10
            ]) {
                results.add(makeParty(p));
            }
        } catch (Exception e) { System.debug('Involved_Parties__c skipped: ' + e.getMessage()); }

        // Involved persons
        try {
            for (SObject ip : Database.query(
                'SELECT Id, Person__r.Name, Relationship__c ' +
                'FROM Involved_Persons__c ' +
                'WHERE Matter__c = :matterId ' +
                'AND (Person__r.Name LIKE :term OR Relationship__c LIKE :term) ' +
                'LIMIT 10'
            )) {
                results.add(makePerson(ip));
            }
        } catch (Exception e) { System.debug('Involved_Persons__c skipped: ' + e.getMessage()); }

        results.addAll(queryCounsel(matterId, term));

        // Top filings
        try {
            for (Topfiling__c t : [
                SELECT Id, Court_Case_No__c, Plaintiffs__c, Defendants__c, Case_Status__c, LWDA_No__c, Court__r.Name
                FROM Topfiling__c
                WHERE TREO_Matter__c = :matterId
                AND (Court_Case_No__c LIKE :term OR Plaintiffs__c LIKE :term
                     OR Defendants__c LIKE :term OR LWDA_No__c LIKE :term
                     OR Court__r.Name LIKE :term)
                LIMIT 10
            ]) {
                results.add(makeFiling(t));
            }
        } catch (Exception e) { System.debug('Topfiling__c skipped: ' + e.getMessage()); }

        // JPAs
        try {
            for (JPA__c j : [
                SELECT Id, Firm_or_Lawyer_Name__r.Name, JPA_Portion__c
                FROM JPA__c
                WHERE Matter__c = :matterId
                AND Firm_or_Lawyer_Name__r.Name LIKE :term
                LIMIT 10
            ]) {
                results.add(makeJpa(j));
            }
        } catch (Exception e) { System.debug('JPA__c skipped: ' + e.getMessage()); }

        results.addAll(queryArbitration(matterId, term));
        results.addAll(queryExpense(matterId, term));

        return results;
    }

    // ── Browse all (no search filter) ─────────────────────────

    @AuraEnabled(cacheable=false)
    public static List<SearchResult> browseAll(Id matterId, String objectType) {
        List<SearchResult> results = new List<SearchResult>();
        if (matterId == null || String.isBlank(objectType)) return results;

        if (objectType == 'NEOS_Notes__c') {
            for (NEOS_Notes__c n : [
                SELECT Id, Name, Note_Description__c, Note_Category__c, NEOS_Created_Date__c, Staff__r.Name
                FROM NEOS_Notes__c
                WHERE NEOS_Matter__c = :matterId
                ORDER BY CreatedDate DESC LIMIT 50
            ]) {
                results.add(makeNote(n));
            }

        } else if (objectType == 'Time_Entry__c') {
            for (Time_Entry__c t : [
                SELECT Id, Name, Notes__c, Entry_Date__c, Staff__r.Name, Duration__c
                FROM Time_Entry__c
                WHERE NEOS_Matter__c = :matterId
                ORDER BY Entry_Date__c DESC NULLS LAST LIMIT 50
            ]) {
                results.add(makeTimeEntry(t));
            }

        } else if (objectType == 'Calendar_Event__c') {
            for (Calendar_Event__c c : [
                SELECT Id, Name, Subject__c, Event_Type__c, Start_DateTime__c
                FROM Calendar_Event__c
                WHERE Matter__c = :matterId
                ORDER BY Start_DateTime__c DESC NULLS LAST LIMIT 50
            ]) {
                results.add(makeEvent(c));
            }

        } else if (objectType == 'Task') {
            for (Task t : [
                SELECT Id, Subject, Description, Status, ActivityDate
                FROM Task
                WHERE WhatId = :matterId
                ORDER BY ActivityDate DESC NULLS LAST LIMIT 50
            ]) {
                results.add(makeTask(t));
            }

        } else if (objectType == 'Involved_Parties__c') {
            try {
                for (Involved_Parties__c p : [
                    SELECT Id, Name, Relationship__c
                    FROM Involved_Parties__c
                    WHERE Matter__c = :matterId
                    ORDER BY Name LIMIT 50
                ]) {
                    results.add(makeParty(p));
                }
            } catch (Exception e) { System.debug('browse Involved_Parties__c skipped: ' + e.getMessage()); }

        } else if (objectType == 'Involved_Persons__c') {
            try {
                for (SObject ip : Database.query(
                    'SELECT Id, Person__r.Name, Relationship__c ' +
                    'FROM Involved_Persons__c ' +
                    'WHERE Matter__c = :matterId ' +
                    'ORDER BY Person__r.Name LIMIT 50'
                )) {
                    results.add(makePerson(ip));
                }
            } catch (Exception e) { System.debug('browse Involved_Persons__c skipped: ' + e.getMessage()); }

        } else if (objectType == 'Topfiling__c') {
            try {
                for (Topfiling__c t : [
                    SELECT Id, Court_Case_No__c, Plaintiffs__c, Defendants__c, Case_Status__c
                    FROM Topfiling__c
                    WHERE TREO_Matter__c = :matterId
                    ORDER BY CreatedDate DESC LIMIT 50
                ]) {
                    results.add(makeFiling(t));
                }
            } catch (Exception e) { System.debug('browse Topfiling__c skipped: ' + e.getMessage()); }

        } else if (objectType == 'JPA__c') {
            try {
                for (JPA__c j : [
                    SELECT Id, Firm_or_Lawyer_Name__r.Name, JPA_Portion__c
                    FROM JPA__c
                    WHERE Matter__c = :matterId
                    ORDER BY CreatedDate DESC LIMIT 50
                ]) {
                    results.add(makeJpa(j));
                }
            } catch (Exception e) { System.debug('browse JPA__c skipped: ' + e.getMessage()); }

        } else {
            // queryByName objects
            if (objectType == 'Counsel_Junction__c') {
                results.addAll(browseCounsel(matterId));
            } else if (objectType == 'Arbitration_Details__c') {
                results.addAll(browseArbitration(matterId));
            } else if (objectType == 'NEOS_Expense__c') {
                results.addAll(browseExpense(matterId));
            }
        }

        return results;
    }

    // ── Record builders ───────────────────────────────────────

    private static SearchResult makeNote(NEOS_Notes__c n) {
        SearchResult r = new SearchResult();
        r.id = n.Id; r.objectType = 'NEOS_Notes__c'; r.objectLabel = 'Notes'; r.iconName = 'standard:note';
        r.title    = n.Staff__r != null ? n.Staff__r.Name : null;
        r.subtitle = n.Note_Category__c;
        r.preview  = n.NEOS_Created_Date__c != null
            ? n.NEOS_Created_Date__c.format('MMM d, yyyy', UserInfo.getTimeZone().getId())
            : null;
        r.extra    = String.isNotBlank(n.Note_Description__c) ? n.Note_Description__c.abbreviate(80) : null;
        return r;
    }

    private static SearchResult makeTimeEntry(Time_Entry__c t) {
        SearchResult r = new SearchResult();
        r.id = t.Id; r.objectType = 'Time_Entry__c'; r.objectLabel = 'Time Entries'; r.iconName = 'standard:timesheet';
        r.title    = t.Staff__r != null ? t.Staff__r.Name : null;
        r.subtitle = String.isNotBlank(t.Duration__c) ? t.Duration__c : null;
        r.preview  = t.Entry_Date__c != null ? t.Entry_Date__c.format() : null;
        r.extra    = String.isNotBlank(t.Notes__c) ? t.Notes__c.abbreviate(80) : null;
        return r;
    }

    @TestVisible
    private static SearchResult makeEvent(Calendar_Event__c c) {
        SearchResult r = new SearchResult();
        r.id = c.Id; r.objectType = 'Calendar_Event__c'; r.objectLabel = 'Calendar Events'; r.iconName = 'standard:event';
        r.title    = String.isNotBlank(c.Subject__c) ? c.Subject__c : c.Name;
        r.subtitle = c.Event_Type__c;
        r.preview  = c.Start_DateTime__c != null
            ? c.Start_DateTime__c.format('MMM d, yyyy h:mm a', UserInfo.getTimeZone().getId())
            : null;
        return r;
    }

    private static SearchResult makeTask(Task t) {
        SearchResult r = new SearchResult();
        r.id = t.Id; r.objectType = 'Task'; r.objectLabel = 'Tasks'; r.iconName = 'standard:task';
        r.title    = t.Subject;
        r.subtitle = t.Status + (t.ActivityDate != null ? ' · ' + String.valueOf(t.ActivityDate) : '');
        r.preview  = String.isNotBlank(t.Description) ? t.Description.abbreviate(250) : null;
        return r;
    }

    @TestVisible
    private static SearchResult makeParty(Involved_Parties__c p) {
        SearchResult r = new SearchResult();
        r.id = p.Id; r.objectType = 'Involved_Parties__c'; r.objectLabel = 'Involved Parties'; r.iconName = 'standard:contact';
        r.title    = p.Name;
        r.subtitle = p.Relationship__c;
        return r;
    }

    private static SearchResult makePerson(SObject ip) {
        SearchResult r = new SearchResult();
        r.id = String.valueOf(ip.get('Id'));
        r.objectType = 'Involved_Persons__c'; r.objectLabel = 'Involved Persons'; r.iconName = 'standard:person_account';
        SObject personRef = ip.getSObject('Person__r');
        r.title    = personRef != null ? (String) personRef.get('Name') : null;
        r.subtitle = (String) ip.get('Relationship__c');
        return r;
    }

    private static SearchResult makeFiling(Topfiling__c t) {
        SearchResult r = new SearchResult();
        r.id = t.Id; r.objectType = 'Topfiling__c'; r.objectLabel = 'Top Filings'; r.iconName = 'standard:document';
        r.title    = t.Plaintiffs__c;
        r.subtitle = t.Court_Case_No__c;
        r.preview  = t.Case_Status__c;
        return r;
    }

    private static SearchResult makeJpa(JPA__c j) {
        SearchResult r = new SearchResult();
        r.id = j.Id; r.objectType = 'JPA__c'; r.objectLabel = 'JPA'; r.iconName = 'standard:document';
        r.title    = j.Firm_or_Lawyer_Name__r != null ? j.Firm_or_Lawyer_Name__r.Name : null;
        r.subtitle = j.JPA_Portion__c != null ? j.JPA_Portion__c.setScale(2).toPlainString() + '%' : null;
        return r;
    }

    // ── Query helpers ─────────────────────────────────────────

    @TestVisible
    private static List<SearchResult> queryByName(
        String objectName, String lookupField, String label, String iconName,
        Id matterId, String term
    ) {
        try {
            String q = 'SELECT Id, Name FROM ' + objectName +
                ' WHERE ' + lookupField + ' = :matterId AND Name LIKE :term LIMIT 10';
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(q)) {
                SearchResult r = new SearchResult();
                r.id = String.valueOf(s.get('Id')); r.objectType = objectName;
                r.objectLabel = label; r.iconName = iconName;
                r.title = (String) s.get('Name');
                out.add(r);
            }
            return out;
        } catch (Exception e) {
            System.debug(objectName + ' search skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    private static List<SearchResult> queryCounsel(Id matterId, String term) {
        try {
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(
                'SELECT Id, Name, Type__c FROM Counsel_Junction__c ' +
                'WHERE Matter__c = :matterId AND Name LIKE :term LIMIT 10'
            )) {
                SearchResult r = new SearchResult();
                r.id = String.valueOf(s.get('Id'));
                r.objectType = 'Counsel_Junction__c'; r.objectLabel = 'Counsel'; r.iconName = 'standard:related_list';
                r.title    = (String) s.get('Name');
                r.subtitle = (String) s.get('Type__c');
                out.add(r);
            }
            return out;
        } catch (Exception e) {
            System.debug('Counsel_Junction__c search skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    private static List<SearchResult> browseCounsel(Id matterId) {
        try {
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(
                'SELECT Id, Name, Type__c FROM Counsel_Junction__c ' +
                'WHERE Matter__c = :matterId ORDER BY Name LIMIT 50'
            )) {
                SearchResult r = new SearchResult();
                r.id = String.valueOf(s.get('Id'));
                r.objectType = 'Counsel_Junction__c'; r.objectLabel = 'Counsel'; r.iconName = 'standard:related_list';
                r.title    = (String) s.get('Name');
                r.subtitle = (String) s.get('Type__c');
                out.add(r);
            }
            return out;
        } catch (Exception e) {
            System.debug('Counsel_Junction__c browse skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    private static List<SearchResult> queryArbitration(Id matterId, String term) {
        try {
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(
                'SELECT Id, Arbitration_Case_Number__c, Arbitrator__r.Name, Case_Manager__r.Name, Arbitration_Venue__c ' +
                'FROM Arbitration_Details__c ' +
                'WHERE NEOS_Matter__c = :matterId ' +
                'AND (Arbitration_Case_Number__c LIKE :term OR Arbitration_Venue__c LIKE :term) LIMIT 10'
            )) {
                out.add(makeArbitration(s));
            }
            return out;
        } catch (Exception e) {
            System.debug('Arbitration_Details__c search skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    private static List<SearchResult> browseArbitration(Id matterId) {
        try {
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(
                'SELECT Id, Arbitration_Case_Number__c, Arbitrator__r.Name, Case_Manager__r.Name, Arbitration_Venue__c ' +
                'FROM Arbitration_Details__c ' +
                'WHERE NEOS_Matter__c = :matterId ORDER BY CreatedDate DESC LIMIT 50'
            )) {
                out.add(makeArbitration(s));
            }
            return out;
        } catch (Exception e) {
            System.debug('Arbitration_Details__c browse skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    @TestVisible
    private static SearchResult makeArbitration(SObject s) {
        SearchResult r = new SearchResult();
        r.id = String.valueOf(s.get('Id'));
        r.objectType = 'Arbitration_Details__c'; r.objectLabel = 'Arbitration Details'; r.iconName = 'standard:case';
        r.title    = (String) s.get('Arbitration_Case_Number__c');
        String arb = s.getSObject('Arbitrator__r') != null ? (String) s.getSObject('Arbitrator__r').get('Name') : null;
        String mgr = s.getSObject('Case_Manager__r') != null ? (String) s.getSObject('Case_Manager__r').get('Name') : null;
        r.subtitle = arb != null && mgr != null ? arb + ' · ' + mgr : (arb != null ? arb : mgr);
        r.preview  = (String) s.get('Arbitration_Venue__c');
        return r;
    }

    private static List<SearchResult> queryExpense(Id matterId, String term) {
        try {
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(
                'SELECT Id, Name, Provider__r.Name, ExpenseDate__c, AmountPaid__c ' +
                'FROM NEOS_Expense__c ' +
                'WHERE NEOS_Matter__c = :matterId AND Name LIKE :term LIMIT 10'
            )) {
                out.add(makeExpense(s));
            }
            return out;
        } catch (Exception e) {
            System.debug('NEOS_Expense__c search skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    private static List<SearchResult> browseExpense(Id matterId) {
        try {
            List<SearchResult> out = new List<SearchResult>();
            for (SObject s : Database.query(
                'SELECT Id, Name, Provider__r.Name, ExpenseDate__c, AmountPaid__c ' +
                'FROM NEOS_Expense__c ' +
                'WHERE NEOS_Matter__c = :matterId ORDER BY ExpenseDate__c DESC NULLS LAST LIMIT 50'
            )) {
                out.add(makeExpense(s));
            }
            return out;
        } catch (Exception e) {
            System.debug('NEOS_Expense__c browse skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }

    private static SearchResult makeExpense(SObject s) {
        SearchResult r = new SearchResult();
        r.id = String.valueOf(s.get('Id'));
        r.objectType = 'NEOS_Expense__c'; r.objectLabel = 'Costs'; r.iconName = 'standard:expense';
        SObject prov = s.getSObject('Provider__r');
        r.title    = prov != null ? (String) prov.get('Name') : (String) s.get('Name');
        Object dt   = s.get('ExpenseDate__c');
        r.subtitle  = dt != null ? String.valueOf(dt) : null;
        Object amt  = s.get('AmountPaid__c');
        r.preview   = amt != null ? '$' + String.valueOf(amt) : null;
        return r;
    }

}
