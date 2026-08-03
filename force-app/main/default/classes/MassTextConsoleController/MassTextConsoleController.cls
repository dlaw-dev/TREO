public with sharing class MassTextConsoleController {

    public class RecipientWrapper {
        @AuraEnabled public Id involvedPartyId;
        @AuraEnabled public Id accountId;
        @AuraEnabled public Id contactId;
        @AuraEnabled public String name;
        @AuraEnabled public String phone;
        @AuraEnabled public Boolean isOptedOut;
        @AuraEnabled public Datetime lastSentDate;
    }

    public class TouchpointWrapper {
        @AuraEnabled public Id id;
        @AuraEnabled public String direction;
        @AuraEnabled public String contactName;
        @AuraEnabled public String message;
        @AuraEnabled public String status;
        @AuraEnabled public Datetime sentTime;
        @AuraEnabled public Datetime deliveredTime;
        @AuraEnabled public Boolean isReplied;
    }

    private static Map<Id, Involved_Parties__c> getClassMemberClientsByContactId(Id matterId) {
        Map<Id, Involved_Parties__c> byContactId = new Map<Id, Involved_Parties__c>();
        for (Involved_Parties__c ip : [
            SELECT Id, Involved_Party__c, Involved_Party__r.Name,
                   Involved_Party__r.PersonContactId,
                   Involved_Party__r.PersonMobilePhone, Involved_Party__r.Phone
            FROM Involved_Parties__c
            WHERE Matter__c = :matterId
              AND Relationship__c = 'Class Member Client'
              AND Involved_Party__r.PersonContactId != null
        ]) {
            byContactId.put(ip.Involved_Party__r.PersonContactId, ip);
        }
        return byContactId;
    }

    // Matches the format seen on real outbound rows: country code + digits, no punctuation.
    private static String normalizePhone(String raw) {
        if (String.isBlank(raw)) return null;
        String digits = raw.replaceAll('[^0-9]', '');
        if (digits.length() == 10) {
            digits = '1' + digits;
        }
        return digits;
    }

    @AuraEnabled(cacheable=true)
    public static List<RecipientWrapper> getEligibleRecipients(Id matterId) {
        Map<Id, Involved_Parties__c> partiesByContactId = getClassMemberClientsByContactId(matterId);
        Map<Id, RecipientWrapper> byContactId = new Map<Id, RecipientWrapper>();

        for (Id contactId : partiesByContactId.keySet()) {
            Involved_Parties__c ip = partiesByContactId.get(contactId);
            RecipientWrapper r = new RecipientWrapper();
            r.involvedPartyId = ip.Id;
            r.accountId = ip.Involved_Party__c;
            r.contactId = contactId;
            r.name = ip.Involved_Party__r.Name;
            r.phone = normalizePhone(
                String.isNotBlank(ip.Involved_Party__r.PersonMobilePhone)
                    ? ip.Involved_Party__r.PersonMobilePhone
                    : ip.Involved_Party__r.Phone
            );
            r.isOptedOut = false;
            byContactId.put(contactId, r);
        }

        // Backfill opt-out status and last-sent date from each recipient's most recent message.
        for (rsplus__SMS_Bucket__c mb : [
            SELECT rsplus__Contact__c, rsplus__Is_Opted_Out__c, CreatedDate
            FROM rsplus__SMS_Bucket__c
            WHERE rsplus__Contact__c IN :byContactId.keySet()
            ORDER BY CreatedDate DESC
        ]) {
            RecipientWrapper r = byContactId.get(mb.rsplus__Contact__c);
            if (r.lastSentDate == null) {
                r.lastSentDate = mb.CreatedDate;
                r.isOptedOut = mb.rsplus__Is_Opted_Out__c;
            }
        }

        return byContactId.values();
    }

    @AuraEnabled(cacheable=true)
    public static List<TouchpointWrapper> getSendHistory(Id matterId) {
        Set<Id> contactIds = getClassMemberClientsByContactId(matterId).keySet();
        List<TouchpointWrapper> history = new List<TouchpointWrapper>();
        if (contactIds.isEmpty()) return history;

        for (rsplus__SMS_Bucket__c mb : [
            SELECT Id, rsplus__Direction__c, rsplus__Contact__r.Name, rsplus__Message__c, rsplus__Status__c,
                   rsplus__Sent_Time__c, rsplus__Delivered_Time__c, rsplus__Is_replied__c
            FROM rsplus__SMS_Bucket__c
            WHERE rsplus__Contact__c IN :contactIds OR TREO_Matter__c = :matterId
            ORDER BY CreatedDate DESC
            LIMIT 200
        ]) {
            TouchpointWrapper t = new TouchpointWrapper();
            t.id = mb.Id;
            t.direction = mb.rsplus__Direction__c;
            t.contactName = mb.rsplus__Contact__r?.Name;
            t.message = mb.rsplus__Message__c;
            t.status = mb.rsplus__Status__c;
            t.sentTime = mb.rsplus__Sent_Time__c;
            t.deliveredTime = mb.rsplus__Delivered_Time__c;
            t.isReplied = mb.rsplus__Is_replied__c;
            history.add(t);
        }

        return history;
    }

    // vtsmsdriver (the package's BeforeInsert trigger) NullPointerExceptions when Sender_ID__c /
    // Sender_Id_Lookup__c / Gateway_Server__c are blank — it needs to resolve which outbound
    // number/gateway to send from and can't default that itself. Rather than hardcode a specific
    // Sender ID record (which may not exist or be the right one in every org), borrow those three
    // fields from the most recent real outbound message already in this org.
    private static rsplus__SMS_Bucket__c getOutboundSenderTemplate() {
        List<rsplus__SMS_Bucket__c> template = [
            SELECT rsplus__Sender_ID__c, rsplus__Sender_Id_Lookup__c, rsplus__Gateway_Server__c
            FROM rsplus__SMS_Bucket__c
            WHERE rsplus__Type__c = 'Outbound' AND rsplus__Sender_ID__c != null
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        return template.isEmpty() ? null : template[0];
    }

    // Recipe reverse-engineered from one real outbound rsplus__SMS_Bucket__c row (a Lead-context
    // send) on 2026-08-03 — not yet confirmed against a Contact-context send or by ValueText
    // support. Business_Hours/Chat_Session/Process_Type and everything status-related are left
    // unset since that record shows them populated only after insert, by the trigger.
    // sb2026 only until verified — see project memory on deploy target.
    @AuraEnabled
    public static void sendBlast(Id matterId, List<Id> contactIds, Map<Id, String> phoneByContactId, String messageBody) {
        rsplus__SMS_Bucket__c senderTemplate = getOutboundSenderTemplate();
        if (senderTemplate == null) {
            throw new AuraHandledException('No existing outbound message found to borrow sender/gateway config from — cannot determine which number to send from.');
        }

        List<rsplus__SMS_Bucket__c> toInsert = new List<rsplus__SMS_Bucket__c>();

        for (Id contactId : contactIds) {
            rsplus__SMS_Bucket__c mb = new rsplus__SMS_Bucket__c();
            mb.rsplus__Message__c = messageBody;
            mb.rsplus__Number__c = normalizePhone(phoneByContactId.get(contactId));
            mb.rsplus__Type__c = 'Outbound';
            mb.rsplus__Channel__c = 'SMS';
            mb.rsplus__Contact__c = contactId;
            mb.rsplus__Related_To__c = contactId;
            mb.rsplus__sObject_Name__c = 'Contact';
            mb.rsplus__Sender_ID__c = senderTemplate.rsplus__Sender_ID__c;
            mb.rsplus__Sender_Id_Lookup__c = senderTemplate.rsplus__Sender_Id_Lookup__c;
            mb.rsplus__Gateway_Server__c = senderTemplate.rsplus__Gateway_Server__c;
            mb.TREO_Matter__c = matterId;
            toInsert.add(mb);
        }

        try {
            insert toInsert;
        } catch (Exception e) {
            // Salesforce sanitizes unhandled exceptions before they reach the client (they show
            // up as a generic "Unknown error") — re-throwing as AuraHandledException surfaces the
            // real DML/validation message instead.
            AuraHandledException ahe = new AuraHandledException(e.getMessage());
            ahe.setMessage(e.getMessage());
            throw ahe;
        }
    }
}
