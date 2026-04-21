public with sharing class TaskUiController {

    private static final Set<String> ALLOWED_PROFILE_NAMES = new Set<String>{
        'System Administrator',
        'TREO Service Agent',
        'TREO Service Supervisor'
    };

    @AuraEnabled
    public static Id saveTask(
        Id relatedId,
        Id ownerId,
        String subject,
        Date dueDate,
        String status,
        String priority,
        String description,
        String taskSubtype,
        String taskSubtypeIfOther,
        String internalExternalType,
        List<String> reminderTypes
    ) {
        try {

            // Validate owner
            User validOwner = [
                SELECT Id, Email
                FROM User
                WHERE Id = :ownerId
                  AND IsActive = true
                  AND UserType = 'Standard'
                  AND Profile.Name IN :ALLOWED_PROFILE_NAMES
                LIMIT 1
            ];

            // ===============================
            // Native Reminder Logic (Option A)
            // Always set a Day Of reminder
            // ===============================
            Boolean setNativeReminder = (dueDate != null);
            Datetime nativeReminderDT;

            if (setNativeReminder) {

                Datetime earliestDayOf;

                if (reminderTypes != null) {
                    for (String typeLabel : reminderTypes) {
                        if (typeLabel != null && typeLabel.contains('Day Of')) {
                            Datetime dt = calculateReminderDatetime(dueDate, typeLabel);

                            if (dt != null &&
                                (earliestDayOf == null || dt.getTime() < earliestDayOf.getTime())) {
                                earliestDayOf = dt;
                            }
                        }
                    }
                }

                // If user selected Day Of options, use earliest.
                // Otherwise default to 9:00 AM Day Of.
                if (earliestDayOf != null) {
                    nativeReminderDT = earliestDayOf;
                } else {
                    nativeReminderDT = Datetime.newInstance(
                        dueDate,
                        Time.newInstance(9, 0, 0, 0)
                    );
                }
            }

            // Create Task
            Task t = new Task(
                WhatId               = relatedId,
                NEOS_Matter__c       = relatedId,
                OwnerId              = validOwner.Id,
                Subject              = subject,
                ActivityDate         = dueDate,
                Status               = status,
                Priority             = priority,
                Description          = description,
                Task_Subtype__c      = taskSubtype,
                Task_Subtype_If_Other__c = taskSubtypeIfOther,
                Internal_External_Type__c = internalExternalType,
                IsReminderSet        = setNativeReminder,
                ReminderDateTime     = nativeReminderDT
            );

            insert t;

            // ===============================
            // Custom Reminder Records
            // ===============================
            if (reminderTypes != null && dueDate != null && !reminderTypes.isEmpty()) {

                List<Task_Reminder__c> reminders = new List<Task_Reminder__c>();

                for (String typeLabel : reminderTypes) {

                    Datetime reminderDT =
                        calculateReminderDatetime(dueDate, typeLabel);

                    if (reminderDT != null) {
                        reminders.add(new Task_Reminder__c(
                            Task_ID__c            = t.Id,
                            Task_Name__c          = t.Subject,
                            Reminder_Type__c      = typeLabel,
                            Reminder_Date_Time__c = reminderDT,
                            Is_Sent__c            = false,
                            Recipient_User_Id__c  = t.OwnerId,
                            Recipient_Email__c    = validOwner.Email
                        ));
                    }
                }

                if (!reminders.isEmpty()) {
                    insert reminders;
                }
            }

            return t.Id;

        } catch (QueryException qe) {
            throw new AuraHandledException('Selected assignee is not allowed.');
        } catch (Exception e) {
            throw new AuraHandledException('Error saving Task: ' + e.getMessage());
        }
    }

    // ======================================
    // Reminder Date Calculation Logic
    // ======================================
    private static Datetime calculateReminderDatetime(Date dueDate, String typeLabel) {

        if (dueDate == null || String.isBlank(typeLabel)) {
            return null;
        }

        Time defaultTime = Time.newInstance(9, 0, 0, 0);

        // 1 Month Before
        if (typeLabel == '1 Month Before') {
            return Datetime.newInstance(
                dueDate.addMonths(-1),
                defaultTime
            );
        }

        // 1 Week Before
        if (typeLabel == '1 Week Before') {
            return Datetime.newInstance(
                dueDate.addDays(-7),
                defaultTime
            );
        }

        // X Days Before (6–1)
        if (typeLabel.contains('Days Before') ||
            typeLabel.contains('Day Before')) {

            try {
                Integer daysBefore =
                    Integer.valueOf(typeLabel.split(' ')[0]);

                return Datetime.newInstance(
                    dueDate.addDays(-daysBefore),
                    defaultTime
                );

            } catch (Exception e) {
                return null;
            }
        }

        // Day Of (6:00 AM – 6:00 PM etc.)
        if (typeLabel.contains('Day Of')) {

            String timeString = typeLabel.replace(' Day Of', '');
            Boolean isPM = timeString.contains('PM');

            timeString = timeString.replace(' AM', '')
                                   .replace(' PM', '');

            List<String> parts = timeString.split(':');
            if (parts.size() != 2) return null;

            Integer hour = Integer.valueOf(parts[0]);
            Integer minute = Integer.valueOf(parts[1]);

            // Convert to 24-hour format
            if (isPM && hour != 12) hour += 12;
            if (!isPM && hour == 12) hour = 0;

            return Datetime.newInstance(
                dueDate,
                Time.newInstance(hour, minute, 0, 0)
            );
        }

        return null;
    }
}
