public without sharing class TaskReminderProcessor {

    public static void run() {

        Datetime nowTime = System.now();
        Datetime windowStart = nowTime.addMinutes(-30);

        String baseUrl = URL.getOrgDomainUrl().toExternalForm();

        OrgWideEmailAddress owea = [
            SELECT Id
            FROM OrgWideEmailAddress
            WHERE Address = 'intake@d.law'
            LIMIT 1
        ];

        /* ====================================================
           TASK REMINDERS
           ==================================================== */

        List<Task_Reminder__c> due = [
            SELECT Id,
                   Task_ID__c,
                   Task_Name__c,
                   Reminder_Type__c,
                   Reminder_Date_Time__c,
                   Recipient_Email__c,
                   Is_Sent__c
            FROM Task_Reminder__c
            WHERE Is_Sent__c = false
              AND Reminder_Date_Time__c >= :windowStart
              AND Reminder_Date_Time__c <= :nowTime
            LIMIT 2000
        ];

        if (!due.isEmpty()) {

            Set<Id> taskIds = new Set<Id>();

            for (Task_Reminder__c r : due) {
                if (r.Task_ID__c != null) taskIds.add(r.Task_ID__c);
            }

            Map<Id, Task> taskMap = new Map<Id, Task>([
                SELECT Id,
                       ActivityDate,
                       Status,
                       Owner.Name,
                       Task_Subtype__c,
                       NEOS_Matter__c,
                       NEOS_Matter__r.Name
                FROM Task
                WHERE Id IN :taskIds
            ]);

            List<Messaging.SingleEmailMessage> emails = new List<Messaging.SingleEmailMessage>();
            List<Task_Reminder__c> updates = new List<Task_Reminder__c>();

            for (Task_Reminder__c r : due) {

                Task related = taskMap.get(r.Task_ID__c);

                /* NEW: skip reminders for deleted tasks */
                if (related == null) {
                    r.Is_Sent__c = true;
                    r.Sent_Date_Time__c = nowTime;
                    updates.add(r);
                    continue;
                }

                if (related.Status == 'Completed') {
                    r.Is_Sent__c = true;
                    r.Sent_Date_Time__c = nowTime;
                    updates.add(r);
                    continue;
                }

                if (String.isBlank(r.Recipient_Email__c)) continue;

                String dueDateStr = (related.ActivityDate != null)
                    ? related.ActivityDate.format()
                    : 'N/A';

                String matterName = (related.NEOS_Matter__r != null)
                    ? related.NEOS_Matter__r.Name
                    : 'N/A';

                String assignedTo = (related.Owner != null)
                    ? related.Owner.Name
                    : 'N/A';

                String taskSubtype = (related.Task_Subtype__c != null)
                    ? related.Task_Subtype__c
                    : 'N/A';

                String displayReminderTime = r.Reminder_Type__c != null
                    ? r.Reminder_Type__c.replace(' Day Of', '')
                    : '';

                String taskLink =
                    baseUrl + '/lightning/r/Task/' + r.Task_ID__c + '/view';

                String matterLink = (related.NEOS_Matter__c != null)
                    ? baseUrl + '/lightning/r/NEOS_Matter__c/' + related.NEOS_Matter__c + '/view'
                    : null;

                Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();

                mail.setToAddresses(new String[]{ r.Recipient_Email__c });

                mail.setSubject(
                    'Task Reminder: ' + r.Task_Name__c + ' | ' + matterName
                );

                mail.setPlainTextBody(
                    'Hello,\n\n' +
                    'This is a reminder regarding the following task:\n\n' +
                    'Task: ' + r.Task_Name__c + '\n' +
                    'Matter: ' + matterName + '\n' +
                    'Task Subtype: ' + taskSubtype + '\n' +
                    'Assigned To: ' + assignedTo + '\n' +
                    'Due Date: ' + dueDateStr + '\n' +
                    'Reminder Time: ' + displayReminderTime + '\n\n' +
                    'Open Task:\n' +
                    taskLink +
                    (matterLink != null ? '\nOpen Matter:\n' + matterLink : '')
                );

                mail.setOrgWideEmailAddressId(owea.Id);

                emails.add(mail);

                r.Is_Sent__c = true;
                r.Sent_Date_Time__c = nowTime;
                updates.add(r);
            }

            if (!emails.isEmpty()) Messaging.sendEmail(emails);
            if (!updates.isEmpty()) update updates;
        }

        /* ====================================================
           EVENT REMINDERS
           ==================================================== */

        try {

            List<Event_Reminder__c> eventDue = [
                SELECT Id,
                       Event_ID__c,
                       Event_Name__c,
                       Reminder_Type__c,
                       Reminder_Date_Time__c,
                       Recipient_Email__c,
                       Is_Sent__c
                FROM Event_Reminder__c
                WHERE Is_Sent__c = false
                  AND Reminder_Date_Time__c >= :windowStart
                  AND Reminder_Date_Time__c <= :nowTime
                LIMIT 2000
            ];

            if (!eventDue.isEmpty()) {

                Set<Id> eventIds = new Set<Id>();

                for (Event_Reminder__c r : eventDue) {
                    if (r.Event_ID__c != null) eventIds.add(r.Event_ID__c);
                }

                Map<Id, Event> eventMap = new Map<Id, Event>([
                    SELECT Id,
                           Subject,
                           StartDateTime,
                           Type,
                           Location,
                           Owner.Name,
                           NEOS_Matter__c,
                           NEOS_Matter__r.Name
                    FROM Event
                    WHERE Id IN :eventIds
                ]);

                Map<Id, List<String>> attendeeMap = new Map<Id, List<String>>();

                for (EventRelation er : [
                    SELECT EventId, RelationId, Relation.Name
                    FROM EventRelation
                    WHERE EventId IN :eventIds
                ]) {

                    if (er.RelationId.getSObjectType() == User.SObjectType ||
                        er.RelationId.getSObjectType() == Contact.SObjectType ||
                        er.RelationId.getSObjectType() == Lead.SObjectType) {

                        if (!attendeeMap.containsKey(er.EventId)) {
                            attendeeMap.put(er.EventId, new List<String>());
                        }

                        attendeeMap.get(er.EventId).add(er.Relation.Name);
                    }
                }

                List<Messaging.SingleEmailMessage> eventEmails = new List<Messaging.SingleEmailMessage>();
                List<Event_Reminder__c> eventUpdates = new List<Event_Reminder__c>();

                for (Event_Reminder__c r : eventDue) {

                    Event related = eventMap.get(r.Event_ID__c);

                    /* NEW: skip reminders for deleted events */
                    if (related == null) {
                        r.Is_Sent__c = true;
                        r.Sent_Date_Time__c = nowTime;
                        eventUpdates.add(r);
                        continue;
                    }

                    if (String.isBlank(r.Recipient_Email__c)) continue;

                    String eventDateStr = related.StartDateTime != null
                        ? related.StartDateTime.format()
                        : 'N/A';

                    String matterName = related.NEOS_Matter__r != null
                        ? related.NEOS_Matter__r.Name
                        : 'N/A';

                    String assignedTo = related.Owner != null
                        ? related.Owner.Name
                        : 'N/A';

                    String attendees = attendeeMap.containsKey(r.Event_ID__c)
                        ? String.join(attendeeMap.get(r.Event_ID__c), ', ')
                        : 'None';

                    String eventLink =
                        baseUrl + '/lightning/r/Event/' + r.Event_ID__c + '/view';

                    Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();

                    mail.setToAddresses(new String[]{ r.Recipient_Email__c });

                    mail.setSubject('Event Reminder: ' + r.Event_Name__c);

                    mail.setPlainTextBody(
                        'Hello,\n\n' +
                        'This is a reminder for the following event:\n\n' +
                        'Event: ' + r.Event_Name__c + '\n' +
                        'Matter: ' + matterName + '\n' +
                        'Type: ' + (related.Type != null ? related.Type : 'N/A') + '\n' +
                        'Location: ' + (related.Location != null ? related.Location : 'N/A') + '\n' +
                        'Owner: ' + assignedTo + '\n' +
                        'Attendees: ' + attendees + '\n' +
                        'Event Date: ' + eventDateStr + '\n\n' +
                        'Open Event:\n' +
                        eventLink
                    );

                    mail.setOrgWideEmailAddressId(owea.Id);

                    eventEmails.add(mail);

                    r.Is_Sent__c = true;
                    r.Sent_Date_Time__c = nowTime;
                    eventUpdates.add(r);
                }

                if (!eventEmails.isEmpty()) Messaging.sendEmail(eventEmails);
                if (!eventUpdates.isEmpty()) update eventUpdates;
            }

        } catch (Exception e) {

            System.debug('Event reminder processing failed: ' + e.getMessage());

        }
    }
}