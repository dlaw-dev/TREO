public with sharing class EventAttendeeUiControllerRefactor {

    /* =========================================================
       Constants
       ========================================================= */

    private static final Set<String> ALLOWED_PROFILE_NAMES = new Set<String>{
        'TREO Service Agent',
        'TREO Service Supervisor'
    };

    private static final Set<String> ALLOWED_USERNAMES = new Set<String>{
        'emil@d.law'
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

    private static final Integer DUPLICATE_WINDOW_SECONDS = 10;
    private static final Integer MAX_OCCURRENCES = 500;
    private static final String DEFAULT_SHOW_AS = 'Free';

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
                AND (Profile.Name IN :ALLOWED_PROFILE_NAMES OR Username IN :ALLOWED_USERNAMES)
                ORDER BY Name
                LIMIT 200
            ];
        }

        String k = '%' + keyword.trim() + '%';

        return [
            SELECT Id, Name
            FROM User
            WHERE IsActive = true
            AND UserType = 'Standard'
            AND (Profile.Name IN :ALLOWED_PROFILE_NAMES OR Username IN :ALLOWED_USERNAMES)
            AND Name LIKE :k
            ORDER BY Name
            LIMIT 50
        ];
    }

    /* =========================================================
       Attendee management on existing events
       ========================================================= */

    @AuraEnabled(cacheable=true)
    public static List<Calendar_Attendee__c> getEventAttendees(Id eventId) {
        return [
            SELECT Id, User__c, User__r.Name, Email__c, Is_Optional__c,
                   Response__c, Response_Time__c
            FROM Calendar_Attendee__c
            WHERE Calendar_Event__c = :eventId
            ORDER BY User__r.Name
        ];
    }

    @AuraEnabled
    public static Id addAttendeeToEvent(Id eventId, Id userId) {
        List<User> users = [SELECT Id, Email FROM User WHERE Id = :userId AND IsActive = true LIMIT 1];
        if (users.isEmpty()) throw new AuraHandledException('User not found.');

        List<Calendar_Attendee__c> existing = [
            SELECT Id FROM Calendar_Attendee__c
            WHERE Calendar_Event__c = :eventId AND User__c = :userId
            LIMIT 1
        ];
        if (!existing.isEmpty()) return existing[0].Id;

        Calendar_Attendee__c att = new Calendar_Attendee__c(
            Calendar_Event__c = eventId,
            User__c           = userId,
            Email__c          = users[0].Email
        );
        insert att;
        return att.Id;
    }

    @AuraEnabled
    public static void removeAttendeeFromEvent(Id attendeeId) {
        new DeleteHelper().deleteAttendeeById(attendeeId);
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
            LIMIT 500
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
            AND (Profile.Name IN :ALLOWED_PROFILE_NAMES OR Username IN :ALLOWED_USERNAMES)
            ORDER BY Name
        ];
    }

    /* =========================================================
       Save Calendar Event + Attendees
       ========================================================= */

    @AuraEnabled(cacheable=true)
    public static List<String> getEventReminderTypes(String eventId) {
        Set<String> types = new Set<String>();
        for (Event_Reminder__c r : [
            SELECT Reminder_Type__c
            FROM Event_Reminder__c
            WHERE Calendar_Event__c = :eventId
              AND Reminder_Type__c != null
        ]) {
            types.add(r.Reminder_Type__c);
        }
        return new List<String>(types);
    }

    @AuraEnabled
    public static void updateCalendarEvent(
        String eventId,
        String subject,
        String startDateTimeIso,
        String endDateTimeIso,
        Boolean isAllDay,
        String typeValue,
        String location,
        String description,
        List<String> selectedUserIds,
        List<String> selectedGroupIds,
        List<Map<String, String>> attachments,
        List<String> reminderOptions,
        String showAs
    ) {
        Savepoint sp = null;
        try {
            Datetime startDt;
            Datetime endDt;

            if (isAllDay) {
                Date startDate = parseDateInput(startDateTimeIso);
                Date endDate   = parseDateInput(endDateTimeIso);
                if (startDate == null) throw new AuraHandledException('Enter a valid start date.');
                if (endDate == null || endDate < startDate) endDate = startDate;
                startDt = Datetime.newInstance(startDate, Time.newInstance(0, 0, 0, 0));
                endDt   = Datetime.newInstance(endDate,   Time.newInstance(0, 0, 0, 0));
            } else {
                startDt = (Datetime) JSON.deserialize('"' + startDateTimeIso + '"', Datetime.class);
                endDt   = (Datetime) JSON.deserialize('"' + endDateTimeIso   + '"', Datetime.class);
                if (endDt.getTime() <= startDt.getTime()) {
                    throw new AuraHandledException('End must be after Start.');
                }
            }

            // Savepoint covers the full DML block so any failure rolls back the
            // event update AND all child record changes atomically.
            sp = Database.setSavepoint();

            Calendar_Event__c ev = new Calendar_Event__c(
                Id                = eventId,
                Subject__c        = String.isBlank(subject) ? null : subject.trim(),
                Start_DateTime__c = startDt,
                End_DateTime__c   = endDt,
                Is_All_Day__c     = isAllDay,
                Location__c       = location,
                Description__c    = description,
                Show_Time_As__c   = normalizeShowAs(showAs)
            );
            if (String.isNotBlank(typeValue)) ev.Event_Type__c = typeValue;
            update ev;

            // Determine which reminder types to apply: use provided list if given,
            // otherwise preserve whatever was already set on the event.
            Set<String> reminderTypes = new Set<String>();
            if (reminderOptions != null) {
                reminderTypes.addAll(reminderOptions);
            } else {
                for (Event_Reminder__c r : [
                    SELECT Reminder_Type__c
                    FROM Event_Reminder__c
                    WHERE Calendar_Event__c = :eventId
                      AND Reminder_Type__c != null
                ]) {
                    reminderTypes.add(r.Reminder_Type__c);
                }
            }

            new DeleteHelper().deleteAttendeesForEvent(eventId);

            Map<Id, User> newAttendeeUsers = new Map<Id, User>();
            if (selectedUserIds != null && !selectedUserIds.isEmpty()) {
                Set<Id> validUids = new Set<Id>();
                for (String uid : selectedUserIds) {
                    if (String.isNotBlank(uid)) validUids.add((Id) uid);
                }
                if (!validUids.isEmpty()) {
                    for (User u : [SELECT Id, Name, Email FROM User WHERE Id IN :validUids AND IsActive = true]) {
                        newAttendeeUsers.put(u.Id, u);
                    }
                }
            }
            if (selectedGroupIds != null && !selectedGroupIds.isEmpty()) {
                Set<Id> gids = new Set<Id>();
                for (String gid : selectedGroupIds) {
                    if (String.isNotBlank(gid)) gids.add((Id) gid);
                }
                if (!gids.isEmpty()) {
                    Set<Id> groupUids = new Set<Id>();
                    for (GroupMember gm : [SELECT UserOrGroupId FROM GroupMember WHERE GroupId IN :gids LIMIT 500]) {
                        if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                            groupUids.add(gm.UserOrGroupId);
                        }
                    }
                    if (!groupUids.isEmpty()) {
                        for (User u : [SELECT Id, Name, Email FROM User WHERE Id IN :groupUids AND IsActive = true]) {
                            newAttendeeUsers.put(u.Id, u);
                        }
                    }
                }
            }
            if (!newAttendeeUsers.isEmpty()) {
                List<Calendar_Attendee__c> newAttendees = new List<Calendar_Attendee__c>();
                for (User u : newAttendeeUsers.values()) {
                    newAttendees.add(new Calendar_Attendee__c(
                        Calendar_Event__c = eventId,
                        User__c           = u.Id,
                        Email__c          = u.Email
                    ));
                }
                insert newAttendees;
            }

            // Wipe old reminders and rebuild for current attendees + updated reminder options.
            new DeleteHelper().deleteRemindersForEvent(eventId);
            if (!reminderTypes.isEmpty() && !newAttendeeUsers.isEmpty()) {
                createReminders(
                    new List<Id>{ (Id) eventId },
                    new Map<Id, Datetime>{ (Id) eventId => startDt },
                    new List<String>(reminderTypes),
                    newAttendeeUsers,
                    String.isBlank(subject) ? null : subject.trim()
                );
            }

            if (attachments != null && !attachments.isEmpty()) {
                List<ContentVersion> cvs = new List<ContentVersion>();
                for (Map<String, String> file : attachments) {
                    String base64Data = file.get('base64Data');
                    if (String.isBlank(base64Data)) continue;
                    cvs.add(new ContentVersion(
                        Title                  = file.get('name'),
                        PathOnClient           = file.get('name'),
                        VersionData            = EncodingUtil.base64Decode(base64Data),
                        FirstPublishLocationId = eventId
                    ));
                }
                if (!cvs.isEmpty()) insert cvs;
            }
        } catch (AuraHandledException ahe) {
            if (sp != null) Database.rollback(sp);
            throw ahe;
        } catch (Exception ex) {
            if (sp != null) Database.rollback(sp);
            throw new AuraHandledException(ex.getMessage());
        }
    }

    @AuraEnabled
    public static Id saveEventWithAttendees(
        Id caseId,
        Id ownerId,
        String subject,
        String startDateTimeIso,
        String endDateTimeIso,
        Boolean isAllDay,
        String typeValue,
        String location,
        String description,
        List<Id> selectedUserIds,
        List<Id> selectedGroupIds,
        List<String> reminderOptions,
        List<Map<String, String>> attachments,
        String recurrencePattern,
        Integer recurrenceInterval,
        String recurrenceEndDateStr,
        List<String> recurrenceDaysOfWeek,
        Integer recurrenceCount,
        String showAs,
        Id mediatorId
    ) {
        try {
            Datetime startDt;
            Datetime endDt;
            String normalizedSubject = subject == null ? null : subject.trim();
            String normalizedShowAs = normalizeShowAs(showAs);

            if (isAllDay) {
                Date startDate = parseDateInput(startDateTimeIso);
                Date endDate   = parseDateInput(endDateTimeIso);

                if (startDate == null || endDate == null) {
                    throw new AuraHandledException('Enter a valid start and end date.');
                }

                if (endDate < startDate) {
                    endDate = startDate;
                }

                startDt = Datetime.newInstance(startDate, Time.newInstance(0, 0, 0, 0));
                endDt   = Datetime.newInstance(endDate,   Time.newInstance(0, 0, 0, 0));
            } else {
                startDt = (Datetime) JSON.deserialize('"' + startDateTimeIso + '"', Datetime.class);
                endDt   = (Datetime) JSON.deserialize('"' + endDateTimeIso   + '"', Datetime.class);

                if (endDt.getTime() <= startDt.getTime()) {
                    throw new AuraHandledException('End must be after Start.');
                }
            }

            /* -------------------------
               Matter URL footer
               ------------------------- */

            String finalDescription = description;

            if (caseId != null) {
                // URL is deterministic from the Id — no lock needed, avoids row-lock contention
                List<NEOS_Matter__c> matters = [
                    SELECT Id
                    FROM NEOS_Matter__c
                    WHERE Id = :caseId
                    LIMIT 1
                ];

                if (!matters.isEmpty()) {
                    String matterUrl = URL.getOrgDomainUrl().toExternalForm()
                        + '/lightning/r/NEOS_Matter__c/' + caseId + '/view';
                    finalDescription = String.isBlank(description)
                        ? matterUrl
                        : description.trim() + '\n\n' + matterUrl;
                }
            }

            /* -------------------------
               Recurrence fields
               ------------------------- */

            Date recEndDate = String.isNotBlank(recurrenceEndDateStr)
                ? parseDateInput(recurrenceEndDateStr)
                : null;

            Boolean countBased = (recEndDate == null && recurrenceCount != null && recurrenceCount > 0);

            Boolean isRecurring = String.isNotBlank(recurrencePattern)
                && recurrencePattern != 'None'
                && (recEndDate != null || countBased);

            Integer safeInterval = (recurrenceInterval != null && recurrenceInterval > 0)
                ? recurrenceInterval
                : 1;

            /* -------------------------
               Build first event
               ------------------------- */

            Calendar_Event__c ev = new Calendar_Event__c(
                Subject__c               = normalizedSubject,
                Start_DateTime__c        = startDt,
                End_DateTime__c          = endDt,
                OwnerId                  = ownerId,
                Matter__c                = caseId,
                Is_All_Day__c            = isAllDay,
                Location__c              = location,
                Description__c           = finalDescription,
                Show_Time_As__c          = normalizedShowAs,
                Sync_To_Firm_Calendar__c = true
            );

            if (isValidPicklistValue(Calendar_Event__c.Event_Type__c, typeValue)) {
                ev.Event_Type__c = typeValue;
            }

            if (isRecurring) {
                ev.Recurrence_Pattern__c  = recurrencePattern;
                ev.Recurrence_Interval__c = safeInterval;
                ev.Recurrence_End_Date__c = recEndDate;
                if (recurrenceDaysOfWeek != null && !recurrenceDaysOfWeek.isEmpty()) {
                    ev.Recurrence_Days_Of_Week__c = String.join(recurrenceDaysOfWeek, ';');
                }
            }

            /* -------------------------
               Duplicate check
               ------------------------- */

            Datetime duplicateThreshold = System.now().addSeconds(-DUPLICATE_WINDOW_SECONDS);
            List<Calendar_Event__c> recentCandidates = new DedupeSupport().findRecentCandidates(
                ownerId, caseId, normalizedSubject, duplicateThreshold
            );

            for (Calendar_Event__c candidate : recentCandidates) {
                if (
                    candidate.Start_DateTime__c != null &&
                    candidate.End_DateTime__c   != null &&
                    candidate.Start_DateTime__c.getTime() == startDt.getTime() &&
                    candidate.End_DateTime__c.getTime()   == endDt.getTime() &&
                    candidate.Is_All_Day__c == isAllDay &&
                    normalizeShowAs(candidate.Show_Time_As__c) == normalizedShowAs
                ) {
                    return candidate.Id;
                }
            }

            if (mediatorId != null) {
                ev.put('Mediator__c', mediatorId);
            }

            insert ev;

            /* -------------------------
               Attachments (first event)
               ------------------------- */

            if (attachments != null && !attachments.isEmpty()) {
                List<ContentVersion> cvs = new List<ContentVersion>();
                for (Map<String, String> file : attachments) {
                    String base64Data = file.get('base64Data');
                    if (String.isBlank(base64Data)) continue;
                    cvs.add(new ContentVersion(
                        Title                  = file.get('name'),
                        PathOnClient           = file.get('name'),
                        VersionData            = EncodingUtil.base64Decode(base64Data),
                        FirstPublishLocationId = ev.Id
                    ));
                }
                if (!cvs.isEmpty()) insert cvs;
            }

            /* -------------------------
               Generate recurrences
               ------------------------- */

            List<Id> allEventIds = new List<Id>{ ev.Id };
            Map<Id, Datetime> eventStartMap = new Map<Id, Datetime>{ ev.Id => startDt };

            if (isRecurring) {
                insertRecurrenceOccurrences(
                    ev, startDt, endDt,
                    recurrencePattern, safeInterval, recEndDate,
                    recurrenceDaysOfWeek, countBased, recurrenceCount,
                    allEventIds, eventStartMap
                );
            }

            /* -------------------------
               Build attendee list
               ------------------------- */

            Map<Id, User> attendeeUsers = resolveAttendeeUsers(selectedUserIds, selectedGroupIds, ownerId);

            /* -------------------------
               Guard: attendee DML rows
               10,000 row limit per transaction. Other DMLs (events, reminders) use ~1,000.
               ------------------------- */

            Integer attendeeRows = allEventIds.size() * attendeeUsers.size();
            if (attendeeRows > 9000) {
                throw new AuraHandledException(
                    'Too many attendee records to create (' + attendeeRows + '). Reduce the number of occurrences or attendees and try again.'
                );
            }

            /* -------------------------
               Insert attendees
               ------------------------- */

            createAttendees(allEventIds, attendeeUsers);

            /* -------------------------
               Remove Existing Reminders (first event only)
               ------------------------- */

            new DeleteHelper().deleteRemindersForEvent(ev.Id);

            /* -------------------------
               Create Event Reminders (all events)
               ------------------------- */

            createReminders(allEventIds, eventStartMap, reminderOptions, attendeeUsers, normalizedSubject);

            return ev.Id;

        } catch (AuraHandledException e) {
            throw e;
        } catch (DmlException e) {
            throw new AuraHandledException('Error saving Calendar Event: ' + e.getDmlMessage(0));
        } catch (QueryException e) {
            throw new AuraHandledException('Error querying Calendar Event attendees: ' + e.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException('Error saving Calendar Event: ' + e.getMessage());
        }
    }

    /* =========================================================
       Private: Resolve attendee users from user + group IDs
       ========================================================= */

    private static Map<Id, User> resolveAttendeeUsers(
        List<Id> selectedUserIds,
        List<Id> selectedGroupIds,
        Id ownerId
    ) {
        Map<Id, User> attendeeUsers = new Map<Id, User>();

        if (selectedUserIds != null && !selectedUserIds.isEmpty()) {
            for (User u : [
                SELECT Id, Name, Email
                FROM User
                WHERE Id IN :selectedUserIds
                AND IsActive = true
                AND UserType = 'Standard'
                AND (Profile.Name IN :ALLOWED_PROFILE_NAMES OR Username IN :ALLOWED_USERNAMES)
            ]) {
                attendeeUsers.put(u.Id, u);
            }
        }

        if (selectedGroupIds != null && !selectedGroupIds.isEmpty()) {
            Set<Id> groupUserIds = new Set<Id>();
            for (GroupMember gm : [
                SELECT UserOrGroupId
                FROM GroupMember
                WHERE GroupId IN :selectedGroupIds
                LIMIT 500
            ]) {
                if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                    groupUserIds.add(gm.UserOrGroupId);
                }
            }
            if (!groupUserIds.isEmpty()) {
                for (User u : [
                    SELECT Id, Name, Email
                    FROM User
                    WHERE Id IN :groupUserIds
                    AND IsActive = true
                    AND UserType = 'Standard'
                    AND (Profile.Name IN :ALLOWED_PROFILE_NAMES OR Username IN :ALLOWED_USERNAMES)
                ]) {
                    attendeeUsers.put(u.Id, u);
                }
            }
        }

        return attendeeUsers;
    }

    /* =========================================================
       Private: Insert Calendar_Attendee__c records
       ========================================================= */

    private static void createAttendees(List<Id> allEventIds, Map<Id, User> attendeeUsers) {
        if (attendeeUsers.isEmpty()) return;
        List<Calendar_Attendee__c> attendees = new List<Calendar_Attendee__c>();
        for (Id eventId : allEventIds) {
            for (User u : attendeeUsers.values()) {
                attendees.add(new Calendar_Attendee__c(
                    Calendar_Event__c = eventId,
                    User__c           = u.Id,
                    Email__c          = u.Email
                ));
            }
        }
        insert attendees;
    }

    /* =========================================================
       Private: Insert Event_Reminder__c records
       ========================================================= */

    private static void createReminders(
        List<Id> allEventIds,
        Map<Id, Datetime> eventStartMap,
        List<String> reminderOptions,
        Map<Id, User> attendeeUsers,
        String normalizedSubject
    ) {
        if (reminderOptions == null || reminderOptions.isEmpty() || attendeeUsers.isEmpty()) return;

        // attendeeUsers already contains Id + Email from resolveAttendeeUsers — no re-query needed
        Integer totalRows = allEventIds.size() * attendeeUsers.size() * reminderOptions.size();
        if (totalRows > 9000) {
            throw new AuraHandledException(
                'Too many reminders to schedule (' + totalRows + '). Reduce occurrences, attendees, or reminder options and try again.'
            );
        }

        List<Event_Reminder__c> reminders = new List<Event_Reminder__c>();

        for (Id eventId : allEventIds) {
            Datetime evStart = eventStartMap.get(eventId);
            for (User u : attendeeUsers.values()) {
                for (String option : reminderOptions) {
                    Integer daysBefore;
                    try {
                        daysBefore = Integer.valueOf(option.split(' ')[0]);
                    } catch (Exception e) {
                        daysBefore = null;
                        System.debug(LoggingLevel.WARN, 'createReminders: unrecognised reminder option skipped: ' + option);
                    }
                    if (daysBefore != null) {
                        reminders.add(new Event_Reminder__c(
                            Calendar_Event__c     = eventId,
                            Event_Name__c         = normalizedSubject,
                            Recipient_User_ID__c  = u.Id,
                            Recipient_Email__c    = u.Email,
                            Reminder_Type__c      = option,
                            Reminder_Date_Time__c = evStart.addDays(-daysBefore)
                        ));
                    }
                }
            }
        }

        if (!reminders.isEmpty()) insert reminders;
    }

    /* =========================================================
       Private: Insert recurrence occurrence events
       Mutates allEventIds and eventStartMap in place.
       ========================================================= */

    private static void insertRecurrenceOccurrences(
        Calendar_Event__c ev,
        Datetime startDt,
        Datetime endDt,
        String recurrencePattern,
        Integer safeInterval,
        Date recEndDate,
        List<String> recurrenceDaysOfWeek,
        Boolean countBased,
        Integer recurrenceCount,
        List<Id> allEventIds,
        Map<Id, Datetime> eventStartMap
    ) {
        List<Datetime> occurrenceDts = generateOccurrenceDatetimes(
            startDt, recurrencePattern, safeInterval, recEndDate, recurrenceDaysOfWeek,
            countBased ? recurrenceCount : null
        );

        Long durationMs = endDt.getTime() - startDt.getTime();
        List<Calendar_Event__c> occurrences = new List<Calendar_Event__c>();

        // Skip index 0 — that's the first event already inserted
        for (Integer i = 1; i < occurrenceDts.size(); i++) {
            Datetime occStart = occurrenceDts[i];
            Datetime occEnd   = Datetime.newInstance(occStart.getTime() + durationMs);

            occurrences.add(new Calendar_Event__c(
                Subject__c                    = ev.Subject__c,
                Start_DateTime__c             = occStart,
                End_DateTime__c               = occEnd,
                OwnerId                       = ev.OwnerId,
                Matter__c                     = ev.Matter__c,
                Is_All_Day__c                 = ev.Is_All_Day__c,
                Location__c                   = ev.Location__c,
                Description__c                = ev.Description__c,
                Event_Type__c                 = ev.Event_Type__c,
                Show_Time_As__c               = ev.Show_Time_As__c,
                Sync_To_Firm_Calendar__c      = true,
                Recurrence_Pattern__c         = recurrencePattern,
                Recurrence_Interval__c        = safeInterval,
                Recurrence_End_Date__c        = recEndDate,
                Recurrence_Days_Of_Week__c    = ev.Recurrence_Days_Of_Week__c
            ));
        }

        if (!occurrences.isEmpty()) {
            insert occurrences;
            for (Calendar_Event__c occ : occurrences) {
                allEventIds.add(occ.Id);
                eventStartMap.put(occ.Id, occ.Start_DateTime__c);
            }
        }
    }

    /* =========================================================
       Recurrence: Generate occurrence datetimes
       ========================================================= */

    private static List<Datetime> generateOccurrenceDatetimes(
        Datetime startDt,
        String pattern,
        Integer intervalVal,
        Date endDate,
        List<String> daysOfWeek,
        Integer maxCount
    ) {
        List<Datetime> result = new List<Datetime>();

        // When endDate is null (count-based), cap at maxCount; otherwise cap at MAX_OCCURRENCES
        Integer effectiveLimit = (endDate == null && maxCount != null && maxCount > 0)
            ? Math.min(maxCount, MAX_OCCURRENCES)
            : MAX_OCCURRENCES;

        if (pattern == 'Daily') {
            Datetime cursor = startDt;
            while ((endDate == null || cursor.date() <= endDate) && result.size() < effectiveLimit) {
                result.add(cursor);
                cursor = cursor.addDays(intervalVal);
            }

        } else if (pattern == 'Weekly') {
            Set<Integer> selectedDows = new Set<Integer>();
            if (daysOfWeek != null) {
                for (String d : daysOfWeek) {
                    Integer dow = dayNameToInt(d);
                    if (dow >= 0) selectedDows.add(dow);
                }
            }
            if (selectedDows.isEmpty()) return result;

            // Find the Sunday of the week containing startDt
            Date anchor    = startDt.date();
            Integer ancDow = dateToDownInt(anchor);
            Date weekSun   = anchor.addDays(-ancDow);

            while ((endDate == null || weekSun <= endDate) && result.size() < effectiveLimit) {
                for (Integer d = 0; d < 7 && result.size() < effectiveLimit; d++) {
                    Date candidate = weekSun.addDays(d);
                    if (candidate < startDt.date()) continue;
                    if (endDate != null && candidate > endDate) break;
                    if (selectedDows.contains(d)) {
                        result.add(Datetime.newInstance(candidate, startDt.time()));
                    }
                }
                weekSun = weekSun.addDays(7 * intervalVal);
            }

        } else if (pattern == 'Absolute_Monthly') {
            Datetime cursor = startDt;
            while ((endDate == null || cursor.date() <= endDate) && result.size() < effectiveLimit) {
                result.add(cursor);
                cursor = cursor.addMonths(intervalVal);
            }

        } else if (pattern == 'Relative_Monthly') {
            Integer startDow  = dateToDownInt(startDt.date());
            Integer weekOfMon = (startDt.date().day() - 1) / 7;

            Datetime cursor = startDt;
            while ((endDate == null || cursor.date() <= endDate) && result.size() < effectiveLimit) {
                result.add(cursor);
                Date nextBase     = cursor.date().addMonths(intervalVal);
                Date firstOfMonth = Date.newInstance(nextBase.year(), nextBase.month(), 1);
                Integer firstDow  = dateToDownInt(firstOfMonth);
                Integer daysToTgt = Math.mod(startDow - firstDow + 7, 7);
                Date target       = firstOfMonth.addDays(daysToTgt + (weekOfMon * 7));
                if (target.month() != firstOfMonth.month()) {
                    target = target.addDays(-7);
                }
                cursor = Datetime.newInstance(target, cursor.time());
            }

        } else if (pattern == 'Absolute_Yearly') {
            Datetime cursor = startDt;
            while ((endDate == null || cursor.date() <= endDate) && result.size() < effectiveLimit) {
                result.add(cursor);
                cursor = cursor.addMonths(12 * intervalVal);
            }
        }

        return result;
    }

    // Returns 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat for a Date
    private static Integer dateToDownInt(Date d) {
        Datetime dt = Datetime.newInstance(d, Time.newInstance(12, 0, 0, 0));
        String name = dt.formatGmt('EEEE').toLowerCase();
        return dayNameToInt(name);
    }

    // Maps picklist API name (monday, tuesday...) to 0=Sun..6=Sat integer
    private static Integer dayNameToInt(String name) {
        Map<String, Integer> m = new Map<String, Integer>{
            'sunday' => 0, 'monday' => 1, 'tuesday' => 2,
            'wednesday' => 3, 'thursday' => 4, 'friday' => 5, 'saturday' => 6
        };
        return m.containsKey(name.toLowerCase()) ? m.get(name.toLowerCase()) : -1;
    }

    /* =========================================================
       Utility
       ========================================================= */

    private static Date parseDateInput(String value) {
        if (String.isBlank(value)) return null;

        String trimmed = value.trim();

        if (trimmed.contains('T') || trimmed.contains('Z')) {
            Datetime parsedDateTime =
                (Datetime) JSON.deserialize('"' + trimmed + '"', Datetime.class);
            return parsedDateTime == null ? null : parsedDateTime.date();
        }

        return Date.valueOf(trimmed);
    }

    private static Boolean isValidPicklistValue(Schema.SObjectField field, String value) {
        if (String.isBlank(value)) return false;
        for (Schema.PicklistEntry pe : field.getDescribe().getPicklistValues()) {
            if (pe.getValue() == value) return true;
        }
        return false;
    }

    private static String normalizeShowAs(String value) {
        if (String.isBlank(value)) return DEFAULT_SHOW_AS;
        String v = value.trim();
        for (Schema.PicklistEntry pe : Calendar_Event__c.Show_Time_As__c.getDescribe().getPicklistValues()) {
            if (pe.isActive() && pe.getValue().toLowerCase() == v.toLowerCase()) {
                return pe.getValue();
            }
        }
        return DEFAULT_SHOW_AS;
    }

    /* =========================================================
       Reschedule: delegates to CalendarRescheduleAction for Graph-aware
       clone + sync, then transfers reminders to the new event.
       ========================================================= */

    @AuraEnabled
    public static Id rescheduleEvent(Id eventId, String newStartIso, String newEndIso, Boolean isAllDay, String newDescription) {
        Savepoint sp = Database.setSavepoint();
        try {
            Datetime newStart = (Datetime) JSON.deserialize('"' + newStartIso + '"', Datetime.class);
            Datetime newEnd   = (Datetime) JSON.deserialize('"' + newEndIso   + '"', Datetime.class);
            boolean endBeforeStart = (isAllDay == true)
                ? newEnd.getTime() < newStart.getTime()
                : newEnd.getTime() <= newStart.getTime();
            if (endBeforeStart) {
                throw new AuraHandledException('End must be after Start.');
            }

            // Capture reminder types before the action runs
            List<Event_Reminder__c> oldReminders = [
                SELECT Id, Reminder_Type__c
                FROM Event_Reminder__c
                WHERE Calendar_Event__c = :eventId
            ];
            Set<String> reminderTypes = new Set<String>();
            for (Event_Reminder__c r : oldReminders) {
                if (r.Reminder_Type__c != null) reminderTypes.add(r.Reminder_Type__c);
            }

            // Delegate clone, Graph ID transfer, attendee copy, and status flip
            // to CalendarRescheduleAction — this issues a PATCH to Outlook so
            // attendees receive one "Meeting Updated" email rather than cancel + new invite.
            CalendarRescheduleAction.Request req = new CalendarRescheduleAction.Request();
            req.sourceEventId  = eventId;
            req.newStart       = newStart;
            req.newEnd         = newEnd;
            req.newIsAllDay    = isAllDay;
            req.newDescription = newDescription;
            Id newEvtId = CalendarRescheduleAction.reschedule(
                new List<CalendarRescheduleAction.Request>{ req }
            )[0].newEventId;

            // Transfer reminders: delete from source, recreate on new event
            if (!oldReminders.isEmpty()) new DeleteHelper().deleteReminderList(oldReminders);
            if (!reminderTypes.isEmpty()) {
                Set<Id> uids = new Set<Id>();
                for (Calendar_Attendee__c a : [
                    SELECT User__c FROM Calendar_Attendee__c WHERE Calendar_Event__c = :newEvtId
                ]) {
                    uids.add(a.User__c);
                }
                if (!uids.isEmpty()) {
                    Map<Id, User> attendeeUserMap = new Map<Id, User>();
                    for (User u : [SELECT Id, Name, Email FROM User WHERE Id IN :uids]) {
                        attendeeUserMap.put(u.Id, u);
                    }
                    List<Calendar_Event__c> subjList = [SELECT Subject__c FROM Calendar_Event__c WHERE Id = :newEvtId LIMIT 1];
                    String subj = subjList.isEmpty() ? null : subjList[0].Subject__c;
                    createReminders(
                        new List<Id>{ newEvtId },
                        new Map<Id, Datetime>{ newEvtId => newStart },
                        new List<String>(reminderTypes),
                        attendeeUserMap,
                        subj?.trim()
                    );
                }
            }

            return newEvtId;

        } catch (CalendarRescheduleAction.RescheduleException e) {
            Database.rollback(sp);
            throw new AuraHandledException(e.getMessage());
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw new AuraHandledException('Reschedule failed: ' + e.getMessage());
        }
    }

    private without sharing class DedupeSupport {
        private List<Calendar_Event__c> findRecentCandidates(
            Id ownerId,
            Id caseId,
            String normalizedSubject,
            Datetime duplicateThreshold
        ) {
            if (caseId != null) {
                return [
                    SELECT Id, Start_DateTime__c, End_DateTime__c, Is_All_Day__c, Show_Time_As__c
                    FROM Calendar_Event__c
                    WHERE OwnerId = :ownerId
                      AND Matter__c = :caseId
                      AND Subject__c = :normalizedSubject
                      AND CreatedDate >= :duplicateThreshold
                    ORDER BY CreatedDate DESC
                    LIMIT 10
                ];
            }

            return [
                SELECT Id, Start_DateTime__c, End_DateTime__c, Is_All_Day__c, Show_Time_As__c
                FROM Calendar_Event__c
                WHERE OwnerId = :ownerId
                  AND Matter__c = null
                  AND Subject__c = :normalizedSubject
                  AND CreatedDate >= :duplicateThreshold
                ORDER BY CreatedDate DESC
                LIMIT 10
            ];
        }
    }

    // Calendar_Attendee__c and Event_Reminder__c records are often owned by a different
    // user than the one editing the event. Without sharing allows these deletes to succeed
    // regardless of record ownership while the outer class still enforces sharing on reads.
    private without sharing class DeleteHelper {
        void deleteAttendeeById(Id attendeeId) {
            delete [SELECT Id FROM Calendar_Attendee__c WHERE Id = :attendeeId LIMIT 1];
        }
        void deleteAttendeesForEvent(Id eventId) {
            delete [SELECT Id FROM Calendar_Attendee__c WHERE Calendar_Event__c = :eventId];
        }
        void deleteRemindersForEvent(Id eventId) {
            delete [SELECT Id FROM Event_Reminder__c WHERE Calendar_Event__c = :eventId];
        }
        void deleteReminderList(List<Event_Reminder__c> reminders) {
            delete reminders;
        }
    }
}