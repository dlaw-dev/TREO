public with sharing class TimeTrackerController {

    // ===== DTO returned to LWC (unchanged shape) =====
    public class TimeEntryDTO {
        @AuraEnabled public Id        id;
        @AuraEnabled public Datetime  startTime;
        @AuraEnabled public Datetime  endTime;
        @AuraEnabled public Boolean   isRunning;
        @AuraEnabled public Boolean   isPaused;
        @AuraEnabled public Integer   pausedSeconds;     // accumulated pause (seconds)
        @AuraEnabled public Datetime  pausedStart;       // start of current pause (if any)
        @AuraEnabled public Integer   durationSeconds;   // net seconds when stopped
        @AuraEnabled public String    durationFormatted; // "MM:SS" when stopped
        @AuraEnabled public Datetime  serverNow;
    }

    // ===== Utilities =====
    private static Id uid() { return UserInfo.getUserId(); }

    private static Integer secondsBetween(Datetime a, Datetime b) {
        if (a == null || b == null) {
            return 0;
        }
        Long ms = b.getTime() - a.getTime();
        return Math.max(0, Integer.valueOf(ms / 1000));
    }

    private static String formatMmSs(Integer totalSeconds) {
        Integer mins   = totalSeconds / 60;
        Integer secs   = Math.mod(totalSeconds, 60);
        String  secStr = (secs < 10 ? '0' : '') + String.valueOf(secs);
        return String.valueOf(mins) + ':' + secStr;
    }

    private static TimeEntryDTO toDTO(Time_Entry__c t, Boolean treatAsRunningIfNoEnd) {
        TimeEntryDTO dto  = new TimeEntryDTO();
        dto.id            = t.Id;
        dto.startTime     = t.Start_time__c;
        dto.endTime       = t.end_time__c;
        dto.pausedStart   = t.Paused_Start__c;
        dto.serverNow     = System.now();

        // Decimal → Integer safely
        Integer pausedAccum = 0;
        if (t.Paused_Seconds__c != null) {
            pausedAccum = t.Paused_Seconds__c.intValue();
        }
        dto.pausedSeconds = pausedAccum;

        dto.isRunning = (t.end_time__c == null) && treatAsRunningIfNoEnd;
        dto.isPaused  = (t.Paused_Start__c != null);

        // Elapsed from start to (now or end)
        Datetime effectiveEnd = (t.end_time__c == null ? dto.serverNow : t.end_time__c);
        Integer  totalElapsed = secondsBetween(t.Start_time__c, effectiveEnd);

        // Include the in-progress paused window if currently paused
        Integer inProgressPause = 0;
        if (t.Paused_Start__c != null) {
            inProgressPause = secondsBetween(t.Paused_Start__c, effectiveEnd);
        }

        Integer netSeconds = Math.max(0, totalElapsed - pausedAccum - inProgressPause);

        if (!dto.isRunning) {
            dto.durationSeconds   = netSeconds;
            dto.durationFormatted = formatMmSs(netSeconds);
        }
        return dto;
    }

    // ===== Queries =====
    @AuraEnabled(cacheable=true)
    public static TimeEntryDTO getActiveEntry(Id matterId) {
        List<Time_Entry__c> rows = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  OwnerId = :uid()
            AND    NEOS_matter__c = :matterId
            AND    end_time__c = NULL
            LIMIT  1
        ];
        return rows.isEmpty() ? null : toDTO(rows[0], true);
    }

    // ===== Commands =====
    @AuraEnabled
    public static TimeEntryDTO start(Id matterId) {
        // Idempotent: return running if already exists
        List<Time_Entry__c> existing = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  OwnerId = :uid()
            AND    NEOS_matter__c = :matterId
            AND    end_time__c = NULL
            LIMIT  1
        ];
        if (!existing.isEmpty()) {
            return toDTO(existing[0], true);
        }

        Time_Entry__c t = new Time_Entry__c(
            NEOS_matter__c    = matterId,
            Start_time__c     = System.now(),
            Paused_Seconds__c = 0
        );
        insert t;
        return toDTO(t, true);
    }

    @AuraEnabled
    public static TimeEntryDTO pause(Id timeEntryId) {
        Time_Entry__c t = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
            FOR UPDATE
        ];
        if (t.end_time__c != null) {
            throw new AuraHandledException('Cannot pause a stopped entry.');
        }
        if (t.Paused_Start__c == null) {
            t.Paused_Start__c = System.now();
            update t;
        }
        return toDTO(t, true);
    }

    @AuraEnabled
    public static TimeEntryDTO resume(Id timeEntryId) {
        Time_Entry__c t = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
            FOR UPDATE
        ];
        if (t.end_time__c != null) {
            throw new AuraHandledException('Cannot resume a stopped entry.');
        }
        if (t.Paused_Start__c != null) {
            Integer add = secondsBetween(t.Paused_Start__c, System.now());
            t.Paused_Seconds__c = (t.Paused_Seconds__c == null ? 0 : t.Paused_Seconds__c) + Math.max(0, add);
            t.Paused_Start__c   = null;
            update t;
        }
        return toDTO(t, true);
    }

    @AuraEnabled
    public static TimeEntryDTO stop(Id timeEntryId) {
        Time_Entry__c t = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
            FOR UPDATE
        ];
        if (t.end_time__c == null) {
            // If currently paused, roll the open pause window into the accumulator first.
            if (t.Paused_Start__c != null) {
                Integer add = secondsBetween(t.Paused_Start__c, System.now());
                t.Paused_Seconds__c = (t.Paused_Seconds__c == null ? 0 : t.Paused_Seconds__c) + Math.max(0, add);
                t.Paused_Start__c   = null;
            }
            t.end_time__c = System.now();
            update t;
        }
        return toDTO(t, false);
    }

    // ===== Save methods =====

    // Save Notes__c only (no duration change)
    @AuraEnabled
    public static TimeEntryDTO saveDetails(Id timeEntryId, String notes) {
        if (String.isBlank(notes)) {
            throw new AuraHandledException('Please enter a note before saving.');
        }

        Time_Entry__c t = [
            SELECT Id, Notes__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
            LIMIT  1
        ];
        t.Notes__c = notes;
        update t;

        // Requery to return fresh DTO
        t = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
        ];
        return toDTO(t, false);
    }

    /**
     * Save Notes__c and an edited net duration (seconds) from the modal.
     * Duration is a formula in your org, so we adjust end_time__c so the formula recalculates:
     *   net = (End - Start) - Paused_Seconds__c  =>  End = Start + Paused_Seconds__c + editedSeconds
     *
     * The `editedStartIso` string may be either:
     *  - a full ISO-8601 UTC timestamp (e.g., "2025-11-12T17:10:00.000Z"), or
     *  - a local `YYYY-MM-DDTHH:mm` string from `<input type="datetime-local">`.
     *
     * When ISO-8601 UTC is provided, we parse with Datetime.valueOfGmt to avoid timezone drift.
     */
    @AuraEnabled
    public static TimeEntryDTO saveDetailsWithEditedDuration(Id timeEntryId, String notes, Integer editedSeconds, String editedStartIso) {
        if (String.isBlank(notes)) {
            throw new AuraHandledException('Please enter a note before saving.');
        }
        if (editedSeconds == null || editedSeconds < 0) {
            throw new AuraHandledException('Enter a valid duration (>= 0 seconds).');
        }

        Time_Entry__c t = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c, Notes__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
            FOR UPDATE
        ];

        // Parse editedStartIso supporting:
        //  - Full ISO UTC like "2025-11-12T20:15:00.000Z"
        //  - ISO with timezone offset like "2025-11-12T20:15:00+02:00"
        //  - Local "YYYY-MM-DDTHH:mm" from datetime-local input
        Datetime desiredStart = null;
        if (!String.isBlank(editedStartIso)) {
            String iso = editedStartIso.trim();
            try {
                if (iso.endsWith('Z')) {
                    // Normalize "YYYY-MM-DDTHH:mm[:ss][.SSS]Z" -> "YYYY-MM-DD HH:mm:ss" for valueOfGmt
                    String core = iso.substring(0, iso.length() - 1);
                    if (core.contains('.')) core = core.substring(0, core.indexOf('.'));
                    // Ensure we have seconds
                    if (core.length() == 16) core += ':00'; // YYYY-MM-DDTHH:mm
                    core = core.replace('T', ' ');
                    desiredStart = Datetime.valueOfGmt(core);
                } else if (iso.contains('+') || (iso.lastIndexOf('-') > 9 && iso.contains('T'))) {
                    // Handle timezone offsets, e.g., "+02:00" or "-05:30"
                    Integer plusIdx  = iso.indexOf('+');
                    Integer minusIdx = iso.lastIndexOf('-');
                    Integer tzIdx    = (plusIdx > 0) ? plusIdx : ((minusIdx > 9 && iso.contains('T')) ? minusIdx : -1);
                    if (tzIdx > 0) {
                        String dt = iso.substring(0, tzIdx);
                        String off = iso.substring(tzIdx); // +HH:mm or -HH:mm
                        if (dt.contains('.')) dt = dt.substring(0, dt.indexOf('.'));
                        if (dt.length() == 16) dt += ':00'; // add seconds if missing
                        dt = dt.replace('T', ' ');
                        Integer sign = off.startsWith('+') ? 1 : -1;
                        String offBody = off.substring(1);
                        List<String> hm = offBody.split(':');
                        Integer oh = Integer.valueOf(hm[0]);
                        Integer om = (hm.size() > 1) ? Integer.valueOf(hm[1]) : 0;
                        Integer totalMin = sign * (oh * 60 + om);
                        // Convert local-with-offset to GMT by subtracting the offset from the wall time
                        Datetime asGmtWall = Datetime.valueOfGmt(dt);
                        desiredStart = asGmtWall.addMinutes(-totalMin);
                    }
                } else {
                    // Fallback: treat as local `YYYY-MM-DDTHH:mm`
                    List<String> parts = iso.split('T');
                    if (parts.size() == 2) {
                        Date d = Date.valueOf(parts[0]); // YYYY-MM-DD
                        List<String> hm = parts[1].split(':'); // HH:mm
                        Integer hh = Integer.valueOf(hm[0]);
                        Integer mi = Integer.valueOf(hm[1]);
                        Time timeVal = Time.newInstance(hh, mi, 0, 0);
                        desiredStart = Datetime.newInstance(d, timeVal);
                    }
                }
            } catch (Exception ex) {
                throw new AuraHandledException('Invalid start date/time provided.');
            }
        }
        if (desiredStart != null) {
            t.Start_time__c = desiredStart;
        }

        // If paused, roll in the open pause window first
        if (t.Paused_Start__c != null) {
            Integer add = secondsBetween(t.Paused_Start__c, System.now());
            t.Paused_Seconds__c = (t.Paused_Seconds__c == null ? 0 : t.Paused_Seconds__c) + Math.max(0, add);
            t.Paused_Start__c   = null;
        }

        Integer pausedAccum = (t.Paused_Seconds__c == null ? 0 : t.Paused_Seconds__c.intValue());

        // Use stored start time if present; otherwise fall back to now
        Datetime baseStart = t.Start_time__c;
        if (baseStart == null) {
            baseStart = System.now();
        }

        // Recompute End so that the formula nets to the edited value
        Datetime newEnd = baseStart.addSeconds(pausedAccum + editedSeconds);
        if (newEnd < baseStart) newEnd = baseStart;

        t.end_time__c = newEnd;
        t.Notes__c    = notes;
        update t;

        // Return fresh DTO
        t = [
            SELECT Id, Start_time__c, end_time__c, Paused_Start__c, Paused_Seconds__c
            FROM   Time_Entry__c
            WHERE  Id = :timeEntryId
        ];
        return toDTO(t, false);
    }
}