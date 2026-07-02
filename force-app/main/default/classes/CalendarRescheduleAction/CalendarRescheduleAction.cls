public without sharing class CalendarRescheduleAction {

    public class RescheduleException extends Exception {}

    public class Request {
        @InvocableVariable(required=true label='Source Event Id' description='The Calendar_Event__c being rescheduled.')
        public Id sourceEventId;

        @InvocableVariable(required=true label='New Start' description='New start datetime for the continuation event.')
        public Datetime newStart;

        @InvocableVariable(required=true label='New End' description='New end datetime for the continuation event.')
        public Datetime newEnd;

        @InvocableVariable(label='New Subject' description='Optional override. Defaults to the source event subject.')
        public String newSubject;

        @InvocableVariable(label='New Description' description='Optional override. Defaults to the source event description.')
        public String newDescription;

        @InvocableVariable(label='New Location' description='Optional override. Defaults to the source event location.')
        public String newLocation;

        @InvocableVariable(label='New Is All Day' description='Optional override. Defaults to the source event flag.')
        public Boolean newIsAllDay;

        @InvocableVariable(label='New Matter Id' description='Optional override. Defaults to the source event matter.')
        public Id newMatterId;

        @InvocableVariable(label='New Event Type' description='Optional override. Defaults to the source event type.')
        public String newEventType;
    }

    public class Result {
        @InvocableVariable(label='New Event Id')
        public Id newEventId;
    }

    @InvocableMethod(label='Reschedule Calendar Event'
                     description='Creates a continuation Calendar_Event__c with new dates, transfers the Outlook event so attendees receive one "Meeting Updated" email (RSVPs preserved), and marks the source as Rescheduled with cross-reference lineage. Source must be active and synced; recurring events are not supported.')
    public static List<Result> reschedule(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) results.add(rescheduleOne(req));
        return results;
    }

    private static Result rescheduleOne(Request req) {
        validate(req);

        Calendar_Event__c source = loadSource(req.sourceEventId);
        validateSource(source);

        // Clear source's Graph IDs first so the unique constraint on Graph_Event_Id__c
        // allows the new event to inherit them. Status flip to Rescheduled here also fires
        // a CANCEL PE with null gid (no-op in the queueable).
        update new Calendar_Event__c(
            Id = source.Id,
            Status__c = 'Continued/Rescheduled',
            Graph_Event_Id__c = null,
            Graph_iCalUId__c = null,
            Graph_Change_Key__c = null
        );

        Calendar_Event__c newEvt = buildNewEvent(source, req);
        insert newEvt;

        cloneAttendees(source.Id, newEvt.Id);
        cloneAttachments(source.Id, newEvt.Id);

        // Flip the new event's sync flag — this fires the trigger's CREATE path. Queueable
        // detects Graph_Event_Id__c is set and routes to PATCH instead of POST.
        update new Calendar_Event__c(Id = newEvt.Id, Sync_To_Firm_Calendar__c = true);

        // Wire the source -> new lineage.
        update new Calendar_Event__c(Id = source.Id, Continued_To__c = newEvt.Id);

        Result res = new Result();
        res.newEventId = newEvt.Id;
        return res;
    }

    private static void validate(Request req) {
        if (req.sourceEventId == null) throw new RescheduleException('Source Event Id is required.');
        if (req.newStart == null) throw new RescheduleException('New Start is required.');
        if (req.newEnd == null) throw new RescheduleException('New End is required.');
        boolean endBeforeStart = (req.newIsAllDay == true)
            ? req.newEnd < req.newStart
            : req.newEnd <= req.newStart;
        if (endBeforeStart) throw new RescheduleException('New End must be after New Start.');
    }

    private static Calendar_Event__c loadSource(Id sourceId) {
        List<Calendar_Event__c> rows = [
            SELECT Id, Subject__c, Description__c, Location__c, Is_All_Day__c, Show_Time_As__c,
                   Status__c, Sync_To_Firm_Calendar__c, Matter__c, Event_Type__c,
                   Graph_Event_Id__c, Graph_iCalUId__c, Graph_Change_Key__c,
                   Recurrence_Pattern__c, Recurrence_Interval__c, Recurrence_Days_Of_Week__c, Recurrence_End_Date__c,
                   Continued_To__c
            FROM Calendar_Event__c WHERE Id = :sourceId LIMIT 1
        ];
        if (rows.isEmpty()) throw new RescheduleException('Source event not found.');
        return rows[0];
    }

    private static void validateSource(Calendar_Event__c source) {
        if (source.Continued_To__c != null) {
            throw new RescheduleException('This event has already been rescheduled.');
        }
        if (CalendarSyncTriggerHandler.isCancelledLike(source.Status__c)) {
            throw new RescheduleException('This event is already cancelled, vacated, or rescheduled.');
        }
        if (source.Sync_To_Firm_Calendar__c != true || String.isBlank(source.Graph_Event_Id__c)) {
            throw new RescheduleException('This event is not synced to the firm calendar.');
        }
        if (String.isNotBlank(source.Recurrence_Pattern__c) && source.Recurrence_Pattern__c != 'None') {
            throw new RescheduleException('Reschedule is not supported for recurring events. Edit the source event directly to change the series.');
        }
    }

    private static Calendar_Event__c buildNewEvent(Calendar_Event__c source, Request req) {
        return new Calendar_Event__c(
            Subject__c = String.isNotBlank(req.newSubject) ? req.newSubject : source.Subject__c,
            Description__c = req.newDescription != null ? req.newDescription : source.Description__c,
            Location__c = req.newLocation != null ? req.newLocation : source.Location__c,
            Is_All_Day__c = req.newIsAllDay != null ? req.newIsAllDay : source.Is_All_Day__c,
            Show_Time_As__c = source.Show_Time_As__c,
            Matter__c = req.newMatterId != null ? req.newMatterId : source.Matter__c,
            Event_Type__c = String.isNotBlank(req.newEventType) ? req.newEventType : source.Event_Type__c,
            Start_DateTime__c = req.newStart,
            End_DateTime__c = req.newEnd,
            Status__c = 'Active',
            Sync_To_Firm_Calendar__c = false,
            Continued_From__c = source.Id,
            Graph_Event_Id__c = source.Graph_Event_Id__c,
            Graph_iCalUId__c = source.Graph_iCalUId__c,
            Graph_Change_Key__c = source.Graph_Change_Key__c
        );
    }

    private static void cloneAttendees(Id sourceId, Id newEventId) {
        List<Calendar_Attendee__c> sourceAtts = [
            SELECT Email__c, User__c, Is_Optional__c
            FROM Calendar_Attendee__c WHERE Calendar_Event__c = :sourceId
            LIMIT 200
        ];
        if (sourceAtts.isEmpty()) return;
        List<Calendar_Attendee__c> clones = new List<Calendar_Attendee__c>();
        for (Calendar_Attendee__c a : sourceAtts) {
            clones.add(new Calendar_Attendee__c(
                Calendar_Event__c = newEventId,
                Email__c = a.Email__c,
                User__c = a.User__c,
                Is_Optional__c = a.Is_Optional__c
            ));
        }
        insert clones;
    }

    private static void cloneAttachments(Id sourceId, Id newEventId) {
        List<Calendar_Event_Attachment__c> sourceAtts = [
            SELECT Content_Document_Id__c, Content_Version_Id__c, File_Name__c, File_Size_Bytes__c
            FROM Calendar_Event_Attachment__c
            WHERE Calendar_Event__c = :sourceId
            LIMIT 200
        ];
        if (sourceAtts.isEmpty()) return;

        List<ContentDocumentLink> newLinks = new List<ContentDocumentLink>();
        List<Calendar_Event_Attachment__c> newAtts = new List<Calendar_Event_Attachment__c>();

        for (Calendar_Event_Attachment__c a : sourceAtts) {
            if (String.isBlank(a.Content_Document_Id__c)) continue;
            newLinks.add(new ContentDocumentLink(
                ContentDocumentId = (Id) a.Content_Document_Id__c,
                LinkedEntityId    = newEventId,
                ShareType         = 'V',
                Visibility        = 'AllUsers'
            ));
            newAtts.add(new Calendar_Event_Attachment__c(
                Calendar_Event__c      = newEventId,
                Content_Document_Id__c = a.Content_Document_Id__c,
                Content_Version_Id__c  = a.Content_Version_Id__c,
                File_Name__c           = a.File_Name__c,
                File_Size_Bytes__c     = a.File_Size_Bytes__c
            ));
        }

        if (!newLinks.isEmpty()) insert newLinks;
        if (!newAtts.isEmpty()) insert newAtts;
    }
}