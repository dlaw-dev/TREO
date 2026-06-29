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

    @AuraEnabled(cacheable=false)
    public static List<SearchResult> search(Id matterId, String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 3) {
            return new List<SearchResult>();
        }

        String term = '%' + searchTerm.trim().replace('\'', '').replace('\\', '') + '%';
        List<SearchResult> results = new List<SearchResult>();

        // NEOS_Notes__c
        for (NEOS_Notes__c n : [
            SELECT Id, Name, Note_Description__c, Note_Category__c
            FROM NEOS_Notes__c
            WHERE NEOS_Matter__c = :matterId
            AND (Name LIKE :term OR Note_Category__c LIKE :term)
            LIMIT 10
        ]) {
            SearchResult r = new SearchResult();
            r.id          = n.Id;
            r.objectType  = 'NEOS_Notes__c';
            r.objectLabel = 'Notes';
            r.title       = n.Name;
            r.subtitle    = n.Note_Category__c;
            r.preview     = n.Note_Description__c != null ? n.Note_Description__c.stripHtmlTags().normalizeSpace().abbreviate(250) : null;
            r.iconName    = 'standard:note';
            results.add(r);
        }

        // Time_Entry__c
        for (Time_Entry__c t : [
            SELECT Id, Name, Notes__c, Entry_Date__c
            FROM Time_Entry__c
            WHERE NEOS_Matter__c = :matterId
            AND (Name LIKE :term OR Notes__c LIKE :term)
            LIMIT 10
        ]) {
            SearchResult r = new SearchResult();
            r.id          = t.Id;
            r.objectType  = 'Time_Entry__c';
            r.objectLabel = 'Time Entries';
            r.title       = t.Name;
            r.subtitle    = t.Entry_Date__c != null ? String.valueOf(t.Entry_Date__c) : null;
            r.preview     = String.isNotBlank(t.Notes__c) ? t.Notes__c.abbreviate(250) : null;
            r.iconName    = 'standard:timesheet';
            results.add(r);
        }

        // Calendar_Event__c
        for (Calendar_Event__c c : [
            SELECT Id, Name, Subject__c, Event_Type__c, Start_DateTime__c
            FROM Calendar_Event__c
            WHERE Matter__c = :matterId
            AND (Name LIKE :term OR Subject__c LIKE :term OR Event_Type__c LIKE :term)
            LIMIT 10
        ]) {
            SearchResult r = new SearchResult();
            r.id          = c.Id;
            r.objectType  = 'Calendar_Event__c';
            r.objectLabel = 'Calendar Events';
            r.title       = String.isNotBlank(c.Subject__c) ? c.Subject__c : c.Name;
            r.subtitle    = c.Event_Type__c;
            r.preview     = c.Start_DateTime__c != null ? c.Start_DateTime__c.format() : null;
            r.iconName    = 'standard:event';
            results.add(r);
        }

        // Task
        for (Task t : [
            SELECT Id, Subject, Description, Status, ActivityDate
            FROM Task
            WHERE WhatId = :matterId
            AND Subject LIKE :term
            LIMIT 10
        ]) {
            SearchResult r = new SearchResult();
            r.id          = t.Id;
            r.objectType  = 'Task';
            r.objectLabel = 'Tasks';
            r.title       = t.Subject;
            r.subtitle    = t.Status + (t.ActivityDate != null ? ' · ' + String.valueOf(t.ActivityDate) : '');
            r.preview     = String.isNotBlank(t.Description) ? t.Description.abbreviate(250) : null;
            r.iconName    = 'standard:task';
            results.add(r);
        }

        // Dynamic SOQL for remaining objects — gracefully skips if object/field doesn't exist
        // Involved_Parties__c
        try {
            for (Involved_Parties__c p : [
                SELECT Id, Name, Relationship__c
                FROM Involved_Parties__c
                WHERE Matter__c = :matterId
                AND (Name LIKE :term OR Relationship__c LIKE :term)
                LIMIT 10
            ]) {
                SearchResult r = new SearchResult();
                r.id          = p.Id;
                r.objectType  = 'Involved_Parties__c';
                r.objectLabel = 'Involved Parties';
                r.iconName    = 'standard:contact';
                r.title       = p.Name;
                r.subtitle    = p.Relationship__c;
                results.add(r);
            }
        } catch (Exception e) { /* object or fields absent — skip */ }

        // Involved_Persons__c — search Person__r.Name and Relationship__c
        try {
            for (SObject ip : Database.query(
                'SELECT Id, Person__r.Name, Relationship__c ' +
                'FROM Involved_Persons__c ' +
                'WHERE Matter__c = :matterId ' +
                'AND (Person__r.Name LIKE :term OR Relationship__c LIKE :term) ' +
                'LIMIT 10'
            )) {
                SearchResult r = new SearchResult();
                r.id          = String.valueOf(ip.get('Id'));
                r.objectType  = 'Involved_Persons__c';
                r.objectLabel = 'Involved Persons';
                r.iconName    = 'standard:person_account';
                SObject personRef = ip.getSObject('Person__r');
                r.title    = personRef != null ? (String) personRef.get('Name') : null;
                r.subtitle = (String) ip.get('Relationship__c');
                results.add(r);
            }
        } catch (Exception e) { /* object or fields absent — skip */ }
        results.addAll(queryByName('Counsel_Party_Junction__c', 'Matter__c',      'Counsel Parties',     'standard:related_list',    matterId, term));
        results.addAll(queryByName('Counsel_Junction__c',       'Matter__c',      'Counsel',             'standard:related_list',    matterId, term));
        // Topfiling__c — Name is autonumber; search court case #, parties
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
                SearchResult r = new SearchResult();
                r.id          = t.Id;
                r.objectType  = 'Topfiling__c';
                r.objectLabel = 'Top Filings';
                r.iconName    = 'standard:document';
                r.title       = t.Plaintiffs__c;
                r.subtitle    = t.Court_Case_No__c;
                r.preview     = t.Case_Status__c;
                results.add(r);
            }
        } catch (Exception e) { /* object or fields absent — skip */ }

        // JPA__c — Name is a system ID; Firm_or_Lawyer_Name__c is a lookup, traverse to .Name
        try {
            for (JPA__c j : [
                SELECT Id, Firm_or_Lawyer_Name__r.Name, JPA_Portion__c
                FROM JPA__c
                WHERE Matter__c = :matterId
                AND Firm_or_Lawyer_Name__r.Name LIKE :term
                LIMIT 10
            ]) {
                SearchResult r = new SearchResult();
                r.id          = j.Id;
                r.objectType  = 'JPA__c';
                r.objectLabel = 'JPA';
                r.iconName    = 'standard:document';
                r.title       = j.Firm_or_Lawyer_Name__r != null ? j.Firm_or_Lawyer_Name__r.Name : null;
                r.subtitle    = j.JPA_Portion__c != null ? j.JPA_Portion__c.setScale(2).toPlainString() + '%' : null;
                results.add(r);
            }
        } catch (Exception e) { /* object or fields absent — skip */ }
        results.addAll(queryByName('Arbitration_Details__c',    'NEOS_Matter__c', 'Arbitration Details', 'standard:case',            matterId, term));
        results.addAll(queryByName('NEOS_Expense__c',           'NEOS_Matter__c', 'Expenses',            'standard:expense',         matterId, term));

        return results;
    }

    // Searches Name LIKE term for any custom object. Silently returns empty if object/lookup doesn't exist.
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
                r.id          = String.valueOf(s.get('Id'));
                r.objectType  = objectName;
                r.objectLabel = label;
                r.title       = (String) s.get('Name');
                r.iconName    = iconName;
                out.add(r);
            }
            return out;
        } catch (Exception e) {
            return new List<SearchResult>();
        }
    }
}
