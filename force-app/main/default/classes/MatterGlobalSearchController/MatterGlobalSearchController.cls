public with sharing class MatterGlobalSearchController {

    public class SearchResult {
        @AuraEnabled public String id;
        @AuraEnabled public String objectType;
        @AuraEnabled public String objectLabel;
        @AuraEnabled public String title;
        @AuraEnabled public String subtitle;
        @AuraEnabled public String preview;
        @AuraEnabled public String iconName;
    }

    // ── Search (term-filtered) ────────────────────────────────

    @AuraEnabled(cacheable=false)
    public static List<SearchResult> search(Id matterId, String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 3) {
            return new List<SearchResult>();
        }

        String term = '%' + searchTerm.trim().replace('\'', '').replace('\\', '') + '%';
        List<SearchResult> results = new List<SearchResult>();

        // Notes — Note_Description__c is Long Text Area (no LIKE); search category only
        for (NEOS_Notes__c n : [
            SELECT Id, Name, Note_Description__c, Note_Category__c
            FROM NEOS_Notes__c
            WHERE NEOS_Matter__c = :matterId
            AND Note_Category__c LIKE :term
            LIMIT 10
        ]) {
            results.add(makeNote(n));
        }

        // Time entries
        for (Time_Entry__c t : [
            SELECT Id, Name, Notes__c, Entry_Date__c
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

        results.addAll(queryByName('Counsel_Party_Junction__c', 'Matter__c',      'Counsel Parties',     'standard:related_list', matterId, term));
        results.addAll(queryByName('Counsel_Junction__c',       'Matter__c',      'Counsel',             'standard:related_list', matterId, term));

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

        results.addAll(queryByName('Arbitration_Details__c', 'NEOS_Matter__c', 'Arbitration Details', 'standard:case',    matterId, term));
        results.addAll(queryByName('NEOS_Expense__c',        'NEOS_Matter__c', 'Expenses',            'standard:expense', matterId, term));

        return results;
    }

    // ── Browse all (no search filter) ─────────────────────────

    @AuraEnabled(cacheable=false)
    public static List<SearchResult> browseAll(Id matterId, String objectType) {
        List<SearchResult> results = new List<SearchResult>();
        if (matterId == null || String.isBlank(objectType)) return results;

        if (objectType == 'NEOS_Notes__c') {
            for (NEOS_Notes__c n : [
                SELECT Id, Name, Note_Description__c, Note_Category__c
                FROM NEOS_Notes__c
                WHERE NEOS_Matter__c = :matterId
                ORDER BY CreatedDate DESC LIMIT 50
            ]) {
                results.add(makeNote(n));
            }

        } else if (objectType == 'Time_Entry__c') {
            for (Time_Entry__c t : [
                SELECT Id, Name, Notes__c, Entry_Date__c
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
            Map<String, String[]> cfg = new Map<String, String[]>{
                'Counsel_Party_Junction__c' => new String[]{ 'Matter__c',      'Counsel Parties',     'standard:related_list' },
                'Counsel_Junction__c'       => new String[]{ 'Matter__c',      'Counsel',             'standard:related_list' },
                'Arbitration_Details__c'    => new String[]{ 'NEOS_Matter__c', 'Arbitration Details', 'standard:case'         },
                'NEOS_Expense__c'           => new String[]{ 'NEOS_Matter__c', 'Expenses',            'standard:expense'      }
            };
            if (cfg.containsKey(objectType)) {
                String[] c = cfg.get(objectType);
                results.addAll(browseByName(objectType, c[0], c[1], c[2], matterId));
            }
        }

        return results;
    }

    // ── Record builders ───────────────────────────────────────

    private static SearchResult makeNote(NEOS_Notes__c n) {
        SearchResult r = new SearchResult();
        r.id = n.Id; r.objectType = 'NEOS_Notes__c'; r.objectLabel = 'Notes'; r.iconName = 'standard:note';
        r.title    = n.Name;
        r.subtitle = n.Note_Category__c;
        r.preview  = n.Note_Description__c != null
            ? n.Note_Description__c.stripHtmlTags().normalizeSpace().abbreviate(250)
            : null;
        return r;
    }

    private static SearchResult makeTimeEntry(Time_Entry__c t) {
        SearchResult r = new SearchResult();
        r.id = t.Id; r.objectType = 'Time_Entry__c'; r.objectLabel = 'Time Entries'; r.iconName = 'standard:timesheet';
        r.title    = t.Name;
        r.subtitle = t.Entry_Date__c != null ? String.valueOf(t.Entry_Date__c) : null;
        r.preview  = String.isNotBlank(t.Notes__c) ? t.Notes__c.abbreviate(250) : null;
        return r;
    }

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

    private static List<SearchResult> browseByName(
        String objectName, String lookupField, String label, String iconName, Id matterId
    ) {
        try {
            String q = 'SELECT Id, Name FROM ' + objectName +
                ' WHERE ' + lookupField + ' = :matterId ORDER BY Name LIMIT 50';
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
            System.debug(objectName + ' browse skipped: ' + e.getMessage());
            return new List<SearchResult>();
        }
    }
}
