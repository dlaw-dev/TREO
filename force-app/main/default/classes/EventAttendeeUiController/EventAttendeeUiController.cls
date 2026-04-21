public with sharing class EventAttendeeUiController {

    /* =========================================================
       Constants
       ========================================================= */

    private static final Set<String> ALLOWED_PROFILE_NAMES = new Set<String>{
        'System Administrator',
        'TREO Service Agent',
        'TREO Service Supervisor'
    };

    private static final Set<String> ALLOWED_GROUP_NAMES = new Set<String>{
        'Team Roman',
        'Team Natalie',
        'Team Enoch',
        'Team DK',
        'Team Arsine',
        'Team Alvin',
        'Team Adam',
        'Paralegals',
        'Litigation Assistants',
        'Law Motion',
        'Senior Counsel'
    };

    /* =========================================================
       Lookup: Users
       ========================================================= */

    @AuraEnabled(cacheable=false)
    public static List<User> searchUsers(String keyword) {

        if (String.isBlank(keyword)) {
            return [
                SELECT Id, Name
                FROM User
                WHERE IsActive = true
                AND UserType = 'Standard'
                AND Profile.Name IN :ALLOWED_PROFILE_NAMES
                ORDER BY Name
                LIMIT 10
            ];
        }

        String k = '%' + keyword.trim() + '%';

        return [
            SELECT Id, Name
            FROM User
            WHERE IsActive = true
            AND UserType = 'Standard'
            AND Profile.Name IN :ALLOWED_PROFILE_NAMES
            AND Name LIKE :k
            ORDER BY Name
            LIMIT 10
        ];
    }

    /* =========================================================
       Lookup: Groups
       ========================================================= */

    @AuraEnabled(cacheable=false)
    public static List<Group> searchGroups(String keyword) {

        if (String.isBlank(keyword)) {
            return [
                SELECT Id, Name
                FROM Group
                WHERE Type = 'Regular'
                AND RelatedId = NULL
                AND Name IN :ALLOWED_GROUP_NAMES
                ORDER BY Name
                LIMIT 20
            ];
        }

        String k = '%' + keyword.trim() + '%';

        return [
            SELECT Id, Name
            FROM Group
            WHERE Type = 'Regular'
            AND RelatedId = NULL
            AND Name IN :ALLOWED_GROUP_NAMES
            AND Name LIKE :k
            ORDER BY Name
            LIMIT 20
        ];
    }

    @AuraEnabled(cacheable=false)
    public static List<User> getGroupUsers(Id groupId) {

        if (groupId == null) {
            return new List<User>();
        }

        List<Group> groups = [
            SELECT Id
            FROM Group
            WHERE Id = :groupId
            AND Type = 'Regular'
            AND RelatedId = NULL
            AND Name IN :ALLOWED_GROUP_NAMES
            LIMIT 1
        ];

        if (groups.isEmpty()) {
            return new List<User>();
        }

        Set<Id> groupUserIds = new Set<Id>();

        for (GroupMember gm : [
            SELECT UserOrGroupId
            FROM GroupMember
            WHERE GroupId = :groupId
        ]) {

            if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                groupUserIds.add(gm.UserOrGroupId);
            }
        }

        if (groupUserIds.isEmpty()) {
            return new List<User>();
        }

        return [
            SELECT Id, Name
            FROM User
            WHERE Id IN :groupUserIds
            AND IsActive = true
            AND UserType = 'Standard'
            AND Profile.Name IN :ALLOWED_PROFILE_NAMES
            ORDER BY Name
        ];
    }

    /* =========================================================
       Save Event + Attendees
       ========================================================= */

    @AuraEnabled
    public static Id saveEventWithAttendees(
        Id caseId,
        Id ownerId,
        String subject,
        String startDateTimeIso,
        String endDateTimeIso,
        Boolean isAllDay,
        String showAs,
        Boolean isReminderSet,
        String typeValue,
        String location,
        String description,
        List<Id> selectedUserIds,
        List<Id> selectedGroupIds,
        List<String> reminderOptions
    ) {
        try {
            Datetime startDt =
                (Datetime) JSON.deserialize('"' + startDateTimeIso + '"', Datetime.class);

            Datetime endDt =
                (Datetime) JSON.deserialize('"' + endDateTimeIso + '"', Datetime.class);

            Event ev = new Event(
                Subject        = subject,
                StartDateTime  = startDt,
                EndDateTime    = endDt,
                OwnerId        = ownerId,
                WhatId         = caseId,
                NEOS_Matter__c = caseId,
                IsAllDayEvent  = isAllDay,
                ShowAs         = showAs,
                Location       = location,
                Description    = description
            );

            if (isReminderSet) {
                ev.IsReminderSet = true;
                ev.ReminderDateTime = startDt.addMinutes(-15);
            }

            if (isValidPicklistValue(Event.Type, typeValue)) {
                ev.Type = typeValue;
            }

            insert ev;

            /* -------------------------
               Build attendee list
               ------------------------- */

            Set<Id> attendeeUserIds = new Set<Id>();

            if (selectedUserIds != null && !selectedUserIds.isEmpty()) {

                for (User u : [
                    SELECT Id
                    FROM User
                    WHERE Id IN :selectedUserIds
                    AND IsActive = true
                    AND UserType = 'Standard'
                    AND Profile.Name IN :ALLOWED_PROFILE_NAMES
                ]) {
                    attendeeUserIds.add(u.Id);
                }
            }

            if (selectedGroupIds != null && !selectedGroupIds.isEmpty()) {

                Set<Id> groupUserIds = new Set<Id>();

                for (GroupMember gm : [
                    SELECT UserOrGroupId
                    FROM GroupMember
                    WHERE GroupId IN :selectedGroupIds
                ]) {

                    if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                        groupUserIds.add(gm.UserOrGroupId);
                    }
                }

                if (!groupUserIds.isEmpty()) {

                    for (User u : [
                        SELECT Id
                        FROM User
                        WHERE Id IN :groupUserIds
                        AND IsActive = true
                        AND UserType = 'Standard'
                        AND Profile.Name IN :ALLOWED_PROFILE_NAMES
                    ]) {
                        attendeeUserIds.add(u.Id);
                    }
                }
            }

            attendeeUserIds.remove(ownerId);

            if (!attendeeUserIds.isEmpty()) {

                List<EventRelation> rels = new List<EventRelation>();

                for (Id uid : attendeeUserIds) {

                    rels.add(new EventRelation(
                        EventId = ev.Id,
                        RelationId = uid,
                        IsInvitee = true
                    ));
                }

                insert rels;
            }

            /* -------------------------
               Remove Existing Reminders
               ------------------------- */

            delete [
                SELECT Id
                FROM Event_Reminder__c
                WHERE Event_ID__c = :ev.Id
            ];

            /* -------------------------
               Create Event Reminders
               ------------------------- */

            if (reminderOptions != null && !reminderOptions.isEmpty()) {

                Set<Id> recipientIds = new Set<Id>();
                recipientIds.add(ownerId);
                recipientIds.addAll(attendeeUserIds);

                Map<Id, User> users = new Map<Id, User>([
                    SELECT Id, Email
                    FROM User
                    WHERE Id IN :recipientIds
                ]);

                List<Event_Reminder__c> reminders = new List<Event_Reminder__c>();

                for (User u : users.values()) {

                    for (String option : reminderOptions) {

                        Integer daysBefore;

                        try {
                            daysBefore = Integer.valueOf(option.split(' ')[0]);
                        } catch (Exception e) {
                            daysBefore = null;
                        }

                        if (daysBefore != null) {

                            Datetime reminderTime = startDt.addDays(-daysBefore);

                            reminders.add(new Event_Reminder__c(
                                Event_ID__c = ev.Id,
                                Event_Name__c = ev.Subject,
                                Recipient_User_ID__c = u.Id,
                                Recipient_Email__c = u.Email,
                                Reminder_Type__c = option,
                                Reminder_Date_Time__c = reminderTime
                            ));
                        }
                    }
                }

                if (!reminders.isEmpty()) {
                    insert reminders;
                }
            }

            return ev.Id;
        } catch (DmlException e) {
            throw new AuraHandledException('Error saving Event: ' + e.getDmlMessage(0));
        } catch (QueryException e) {
            throw new AuraHandledException('Error querying Event attendees: ' + e.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException('Error saving Event: ' + e.getMessage());
        }
    }

    /* =========================================================
       Utility
       ========================================================= */

    private static Boolean isValidPicklistValue(
        Schema.SObjectField field,
        String value
    ) {

        if (String.isBlank(value)) return false;

        for (Schema.PicklistEntry pe : field.getDescribe().getPicklistValues()) {

            if (pe.getValue() == value) {
                return true;
            }
        }

        return false;
    }
}
