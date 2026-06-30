import LightningModal from 'lightning/modal';
import { api, track, wire } from 'lwc';
import currentUserId from '@salesforce/user/Id';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getPicklistValues } from 'lightning/uiObjectInfoApi';
import { publish, MessageContext } from 'lightning/messageService';
import CALENDAR_EVENT_CHANGED from '@salesforce/messageChannel/calendarEventChanged__c';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import FLATPICKR from '@salesforce/resourceUrl/Flatpickr';

import searchUsers from '@salesforce/apex/EventAttendeeUiControllerRefactor.searchUsers';
import searchGroups from '@salesforce/apex/EventAttendeeUiControllerRefactor.searchGroups';
import getGroupUsers from '@salesforce/apex/EventAttendeeUiControllerRefactor.getGroupUsers';
import saveEventWithAttendees from '@salesforce/apex/EventAttendeeUiControllerRefactor.saveEventWithAttendees';
import updateCalendarEvent from '@salesforce/apex/EventAttendeeUiControllerRefactor.updateCalendarEvent';
import getEventReminderTypes from '@salesforce/apex/EventAttendeeUiControllerRefactor.getEventReminderTypes';

import CASE_TITLE from '@salesforce/schema/NEOS_Matter__c.Case_Title__c';
import EVENT_TYPE_FIELD from '@salesforce/schema/Calendar_Event__c.Event_Type__c';
import RECURRENCE_PATTERN_FIELD from '@salesforce/schema/Calendar_Event__c.Recurrence_Pattern__c';
import RECURRENCE_DAYS_FIELD from '@salesforce/schema/Calendar_Event__c.Recurrence_Days_Of_Week__c';

const MASTER_RECORD_TYPE_ID = '012000000000000AAA';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const AUTO_REMINDER_EVENT_TYPES = new Set([
    'Class Cert - Deadline',
    'Trial',
    'Arbitration'
]);
const AUTO_REMINDER_VALUES = [
    '270 Days Before',
    '180 Days Before',
    '90 Days Before',
    '30 Days Before'
];
const SEARCH_FOCUS_CLICK_WINDOW_MS = 200;
const SEARCH_BLUR_CLOSE_DELAY_MS = 150;

export default class EventCreateModalAction extends LightningModal {

    @api recordId;
    @api editEventId;
    @api duplicateSourceEventId;
    @api initialAttendees = [];

    // Getter/setter pairs so values populate correctly whether the LWC modal
    // framework sets them before or after connectedCallback fires.
    _initialSubject;
    @api get initialSubject() { return this._initialSubject; }
    set initialSubject(val) { this._initialSubject = val; if (val) this.subject = val; }

    _initialEventType;
    @api get initialEventType() { return this._initialEventType; }
    set initialEventType(val) { this._initialEventType = val; if (val) this.typeValue = val; }

    _initialLocation;
    @api get initialLocation() { return this._initialLocation; }
    set initialLocation(val) { this._initialLocation = val; if (val) this.location = val; }

    _initialDescription;
    @api get initialDescription() { return this._initialDescription; }
    set initialDescription(val) { this._initialDescription = val; if (val) this.description = val; }

    _initialIsAllDay = false;
    @api get initialIsAllDay() { return this._initialIsAllDay; }
    set initialIsAllDay(val) {
        this._initialIsAllDay = val === true;
        this.isAllDay = val === true;
        this._refreshDateTimes();
    }

    _initialStartDateTime;
    @api get initialStartDateTime() { return this._initialStartDateTime; }
    set initialStartDateTime(val) { this._initialStartDateTime = val; this._refreshDateTimes(); }

    _initialEndDateTime;
    @api get initialEndDateTime() { return this._initialEndDateTime; }
    set initialEndDateTime(val) { this._initialEndDateTime = val; this._refreshDateTimes(); }

    _initialShowAs;
    @api get initialShowAs() { return this._initialShowAs; }
    set initialShowAs(val) {
        this._initialShowAs = val;
        if (val) this.showAs = val;
    }

    get isEditMode() { return !!this.editEventId; }
    get modalTitle()  { return this.isEditMode ? 'Edit Event' : 'New Event'; }

    subject = '';
    startDateTime;
    endDateTime;
    isAllDay = false;
    showAs = 'Free';

    _fpStart = null;
    _fpEnd   = null;
    _flatpickrLoaded = false;
    typeValue = '';
    isReminderSet = false;
    location = '';
    description = '';
    mediatorId = null;
    isCreatingProvider = false;

    @track selectedFiles = [];
    fileWarning = '';
    isDragOver = false;

    get hasSelectedFiles() { return this.selectedFiles.length > 0; }

    get dropZoneClass() {
        return this.isDragOver ? 'drop-zone drop-zone--active' : 'drop-zone';
    }

    get attachBannerText() {
        const n = this.selectedFiles.length;
        return n === 1 ? '1 file attached' : `${n} files attached`;
    }

    /* -------------------------
       Recurrence
    -------------------------- */

    isRecurring = false;
    recurrencePattern = '';
    recurrenceInterval = 1;
    recurrenceEndDate = '';
    @track recurrenceDaysOfWeek = [];

    @wire(MessageContext) messageContext;

    @wire(getPicklistValues, { recordTypeId: MASTER_RECORD_TYPE_ID, fieldApiName: RECURRENCE_PATTERN_FIELD })
    recurrencePatternPicklist;

    @wire(getPicklistValues, { recordTypeId: MASTER_RECORD_TYPE_ID, fieldApiName: RECURRENCE_DAYS_FIELD })
    recurrenceDaysPicklist;

    get recurrencePatternOptions() {
        return (this.recurrencePatternPicklist?.data?.values ?? []).filter(v => v.value !== 'None');
    }

    get recurrenceDaysOptions() {
        return this.recurrenceDaysPicklist?.data?.values ?? [];
    }

    get isWeeklyPattern() {
        return this.recurrencePattern === 'Weekly' || this.recurrencePattern === 'Relative_Monthly';
    }

    get weekdayMismatchWarning() {
        if (
            !this.isRecurring ||
            this.recurrencePattern !== 'Weekly' ||
            !this.recurrenceDaysOfWeek.length ||
            !this.startDateTime
        ) {
            return '';
        }
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const start = new Date(this.startDateTime);
        if (isNaN(start.getTime())) return '';
        const startDay = dayNames[start.getDay()];
        if (!this.recurrenceDaysOfWeek.includes(startDay)) {
            const display = startDay.charAt(0).toUpperCase() + startDay.slice(1);
            return `Warning: event starts on ${display} but ${display} is not selected — the first generated occurrence may not align with the start date.`;
        }
        return '';
    }

    get intervalHelpText() {
        const help = {
            'Daily':            'How many days between each occurrence. E.g. 1 = every day, 2 = every other day.',
            'Weekly':           'How many weeks between each occurrence. E.g. 1 = every week, 2 = every other week.',
            'Absolute_Monthly': 'How many months between each occurrence. E.g. 1 = every month, 3 = every quarter.',
            'Relative_Monthly': 'How many months between each occurrence. E.g. 1 = every month, 3 = every quarter.',
            'Absolute_Yearly':  'How many years between each occurrence. E.g. 1 = every year, 2 = every other year.'
        };
        return help[this.recurrencePattern] || 'How many days/weeks/months/years between each occurrence.';
    }

    get recurrenceOccurrencePreview() {
        if (!this.isRecurring || !this.recurrencePattern || !this.recurrenceEndDate || !this.startDateTime) return null;
        const interval = Math.max(1, parseInt(this.recurrenceInterval, 10) || 1);
        const start = new Date(this.startDateTime);
        const end   = new Date(this.recurrenceEndDate + 'T00:00:00');
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;

        let count = 0;
        const p = this.recurrencePattern;

        if (p === 'Daily') {
            const days = Math.floor((end - start) / 86400000);
            count = Math.floor(days / interval) + 1;
        } else if (p === 'Weekly') {
            if (!this.recurrenceDaysOfWeek.length) return null;
            const weeks = Math.floor((end - start) / (7 * 86400000 * interval));
            count = (weeks + 1) * this.recurrenceDaysOfWeek.length;
        } else if (p === 'Absolute_Monthly' || p === 'Relative_Monthly') {
            const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
            count = Math.floor(months / interval) + 1;
        } else if (p === 'Absolute_Yearly') {
            const years = end.getFullYear() - start.getFullYear();
            count = Math.floor(years / interval) + 1;
        }

        count = Math.max(1, count);
        return `~${count} occurrence${count === 1 ? '' : 's'} will be created`;
    }

    /* -------------------------
       Reminder Support
    -------------------------- */

    autoRemindersAdded = false;
    selectedReminderOptions = [];

    reminderOptionsList = [
        { label: '360 Days Before', value: '360 Days Before' },
        { label: '270 Days Before', value: '270 Days Before' },
        { label: '180 Days Before', value: '180 Days Before' },
        { label: '90 Days Before', value: '90 Days Before' },
        { label: '60 Days Before', value: '60 Days Before' },
        { label: '45 Days Before', value: '45 Days Before' },
        { label: '30 Days Before', value: '30 Days Before' },
        { label: '15 Days Before', value: '15 Days Before' },
        { label: '10 Days Before', value: '10 Days Before' },
        { label: '7 Days Before', value: '7 Days Before' },
        { label: '5 Days Before', value: '5 Days Before' },
        { label: '4 Days Before', value: '4 Days Before' },
        { label: '3 Days Before', value: '3 Days Before' },
        { label: '2 Days Before', value: '2 Days Before' },
        { label: '1 Day Before', value: '1 Day Before' }
    ];

    get reminderOptionsWithState() {
        const selected = new Set(this.selectedReminderOptions);
        return this.reminderOptionsList.map(opt => ({ ...opt, checked: selected.has(opt.value) }));
    }

    handleReminderOptionChange(e) {
        const val = e.currentTarget.dataset.value;
        const checked = e.target.checked;
        if (checked) {
            if (!this.selectedReminderOptions.includes(val)) {
                this.selectedReminderOptions = [...this.selectedReminderOptions, val];
            }
        } else {
            this.selectedReminderOptions = this.selectedReminderOptions.filter(v => v !== val);
        }
    }

    /* -------------------------
       Attendees
    -------------------------- */

    @track userResults = [];
    @track groupResults = [];
    @track selectedUsers = [];
    @track selectedGroups = [];

    selectedUserIds = new Set();
    selectedGroupIds = new Set();
    isSaving = false;

    _userHighlightIndex  = -1;
    _groupHighlightIndex = -1;

    userSearchTimeout;
    groupSearchTimeout;
    userSearchKeyword = '';
    groupSearchKeyword = '';

    /* -------------------------
       Init
    -------------------------- */

    connectedCallback() {

        const now = this.parseLocalDateTime(this.initialStartDateTime) || new Date();
        if (!this.initialStartDateTime) {
            now.setMinutes(0, 0, 0);
        }

        let end = this.parseLocalDateTime(this.initialEndDateTime);
        if (!end || end.getTime() <= now.getTime()) {
            end = new Date(now);
            end.setHours(end.getHours() + 1);
        }

        this.isAllDay = this.initialIsAllDay === true;
        this.startDateTime = this.isAllDay ? this.formatDateOnly(now) : this.format(now);
        this.endDateTime = this.isAllDay ? this.formatDateOnly(end) : this.format(end);

        if (this.initialSubject)     this.subject     = this.initialSubject;
        if (this.initialEventType)   this.typeValue   = this.initialEventType;
        if (this.initialLocation)    this.location    = this.initialLocation;
        if (this.initialDescription) this.description = this.initialDescription;
        if (this.initialShowAs)      this.showAs      = this.initialShowAs;

        if (this.isEditMode) {
            getEventReminderTypes({ eventId: this.editEventId })
                .then(types => {
                    if (types && types.length > 0) {
                        this.isReminderSet = true;
                        this.selectedReminderOptions = types;
                    }
                })
                .catch(() => {});
        } else if (this.duplicateSourceEventId) {
            getEventReminderTypes({ eventId: this.duplicateSourceEventId })
                .then(types => {
                    if (types && types.length > 0) {
                        this.isReminderSet = true;
                        this.selectedReminderOptions = types;
                    }
                })
                .catch(() => {});
        } else if (AUTO_REMINDER_EVENT_TYPES.has(this.typeValue)) {
            this.selectedReminderOptions = [...AUTO_REMINDER_VALUES];
            this.autoRemindersAdded = true;
        }

        if (Array.isArray(this.initialAttendees) && this.initialAttendees.length > 0) {
            for (const a of this.initialAttendees) {
                if (a.id && !this.selectedUserIds.has(a.id)) {
                    this.selectedUserIds.add(a.id);
                    this.selectedUsers = [...this.selectedUsers, { id: a.id, name: a.name }];
                }
            }
        }

        Promise.all([
            loadStyle(this, FLATPICKR + '/Flatpickr/flatpickr.min.css'),
            loadScript(this, FLATPICKR + '/Flatpickr/flatpickr.min.js')
        ]).then(() => {
            this._flatpickrLoaded = true;
            this._initFlatpickr();
        }).catch(() => {});
    }

    format(d) {

        const p = n => n.toString().padStart(2, '0');

        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    formatDateOnly(d) {
        return this.format(d).split('T')[0];
    }

    parseLocalDateTime(value) {
        if (!value) return null;
        // LWS treats bare 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM' strings as UTC,
        // shifting the date by the local offset. Use the explicit local constructor
        // for those forms (same pattern as toIsoString). Strings that already carry
        // a timezone designator ('...Z', '...+HH:MM') fall through to new Date()
        // which handles them correctly.
        const local = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
        if (local) {
            const d = new Date(+local[1], +local[2] - 1, +local[3], +(local[4] ?? 0), +(local[5] ?? 0));
            return Number.isNaN(d.getTime()) ? null : d;
        }
        const parsed = new Date(String(value));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    _refreshDateTimes() {
        const startParsed = this.parseLocalDateTime(this._initialStartDateTime);
        const endParsed   = this.parseLocalDateTime(this._initialEndDateTime);
        if (startParsed) {
            this.startDateTime = this.isAllDay ? this.formatDateOnly(startParsed) : this.format(startParsed);
        }
        if (endParsed && (!startParsed || endParsed.getTime() > startParsed.getTime())) {
            this.endDateTime = this.isAllDay ? this.formatDateOnly(endParsed) : this.format(endParsed);
        }
    }

    toIsoString(value) {
        if (!value) return null;
        // 'YYYY-MM-DDTHH:MM' strings (from flatpickr) must be parsed as local time.
        // new Date('YYYY-MM-DDTHH:MM') is spec-undefined and LWS treats it as UTC,
        // which shifts the time and causes false "End before Start" errors.
        const local = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (local) {
            const d = new Date(+local[1], +local[2] - 1, +local[3], +local[4], +local[5]);
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    toDateOnly(value) {
        if (!value) {
            return null;
        }
        return String(value).split('T')[0];
    }

    /* -------------------------
       Matter record
    -------------------------- */

    @wire(getRecord, { recordId: '$recordId', fields: [CASE_TITLE] })
    matter;

    get relatedToName() {
        return this.matter?.data?.fields?.Case_Title__c?.value;
    }

    renderedCallback() {
        if (!this.subject && !this._initialSubject && this.relatedToName) {
            this.subject = this.relatedToName;
        }
        if (this._flatpickrLoaded && !this._fpStart) {
            this._initFlatpickr();
        }
    }

    /* -------------------------
       Picklists
    -------------------------- */

    @wire(getPicklistValues, {
        recordTypeId: MASTER_RECORD_TYPE_ID,
        fieldApiName: EVENT_TYPE_FIELD
    })
    typePicklist;

    get typeOptions() {
        return this.typePicklist?.data?.values ?? [];
    }

    /* -------------------------
       UI helpers
    -------------------------- */

    get hasSelectedAttendees() {
        return this.selectedUsers.length || this.selectedGroups.length;
    }

    get hasUserResults() {
        return this.userResults.length > 0;
    }

    get hasGroupResults() {
        return this.groupResults.length > 0;
    }

    get showAsOptions() {
        return [
            { label: 'Busy', value: 'Busy' },
            { label: 'Free', value: 'Free' }
        ];
    }

    get isMediationType() {
        return this.typeValue?.toLowerCase() === 'mediation';
    }

    get isSaveDisabled() {
        return this.isSaving;
    }

    /* -------------------------
       Field Handlers
    -------------------------- */

    handleSubject = e => this.subject = e.target.value;
    handleAllDay = e => {
        this.isAllDay = e.target.checked;
        const startParsed = this.parseLocalDateTime(this.startDateTime);
        const endParsed   = this.parseLocalDateTime(this.endDateTime);
        if (this.isAllDay) {
            if (startParsed) this.startDateTime = this.formatDateOnly(startParsed);
            if (endParsed)   this.endDateTime   = this.formatDateOnly(endParsed);
        } else {
            if (startParsed) this.startDateTime = this.format(startParsed);
            if (endParsed)   this.endDateTime   = this.format(endParsed);
        }
        this._destroyFlatpickr();
        this._initFlatpickr();
    };
    handleShowAs = e => this.showAs = e.target.value;
    handleType = e => {
        this.typeValue = e.target.value;

        if (!this.isEditMode) {
            if (AUTO_REMINDER_EVENT_TYPES.has(this.typeValue)) {
                this.isReminderSet = true;
                this.selectedReminderOptions = [...AUTO_REMINDER_VALUES];
                this.autoRemindersAdded = true;
            } else {
                this.isReminderSet = false;
                this.selectedReminderOptions = [];
                this.autoRemindersAdded = false;
            }
        }

        if (this.typeValue?.toLowerCase() !== 'mediation') {
            this.mediatorId = null;
            this.isCreatingProvider = false;
        }
    };
    handleMediatorChange = e => { this.mediatorId = e.detail.recordId; };
    handleNewProvider() { this.isCreatingProvider = true; }
    handleCancelNewProvider() { this.isCreatingProvider = false; }
    handleProviderCreated(event) {
        this.mediatorId = event.detail.id;
        this.isCreatingProvider = false;
    }
    handleReminderSet = e => this.isReminderSet = e.target.checked;
    handleLocation = e => this.location = e.target.value;
    handleDescription = e => this.description = e.target.value;

    handleIsRecurring = e => {
        this.isRecurring = e.target.checked;
        if (!this.isRecurring) {
            this.recurrencePattern = '';
            this.recurrenceInterval = 1;
            this.recurrenceEndDate = '';
            this.recurrenceDaysOfWeek = [];
        }
    };
    handleRecurrencePattern = e => {
        this.recurrencePattern = e.target.value;
        if (this.recurrencePattern !== 'Weekly' && this.recurrencePattern !== 'Relative_Monthly') {
            this.recurrenceDaysOfWeek = [];
        }
    };
    handleRecurrenceInterval = e => this.recurrenceInterval = parseInt(e.target.value, 10) || 1;
    handleRecurrenceEndDate = e => this.recurrenceEndDate = e.target.value;
    handleRecurrenceDays = e => this.recurrenceDaysOfWeek = e.detail.value;

    handleDropZoneClick() {
        this.template.querySelector('[data-id="file-input"]').click();
    }

    handleDragOver(e) {
        e.preventDefault();
        this.isDragOver = true;
    }

    handleDragLeave() {
        this.isDragOver = false;
    }

    handleDrop(e) {
        e.preventDefault();
        this.isDragOver = false;
        this.processFiles(Array.from(e.dataTransfer.files));
    }

    handleFileChange(e) {
        this.processFiles(Array.from(e.target.files));
    }

    handleRemoveFile(e) {
        const name = e.currentTarget.dataset.name;
        this.selectedFiles = this.selectedFiles.filter(f => f.name !== name);
        if (this.selectedFiles.length === 0) this.fileWarning = '';
    }

    // Read files immediately on selection — before LWS wraps File objects in a
    // reactive proxy that blocks FileReader. Stores base64 directly in selectedFiles
    // so save() can pass them straight to Apex without re-reading.
    processFiles(files) {
        const oversized = files.filter(f => f.size > MAX_FILE_BYTES);
        const valid = files.filter(f => f.size <= MAX_FILE_BYTES);

        if (oversized.length > 0) {
            this.fileWarning = `File(s) exceed the 5 MB limit and were removed: ${oversized.map(f => f.name).join(', ')}`;
        } else {
            this.fileWarning = '';
        }

        if (valid.length === 0) return;

        const existingNames = new Set(this.selectedFiles.map(f => f.name));
        const toRead = valid.filter(f => !existingNames.has(f.name));
        if (toRead.length === 0) return;

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        Promise.all(
            toRead.map(f => this.readFileAsBase64(f).catch(() => ({ _failed: true, name: f.name })))
        ).then(results => {
            const failed    = results.filter(r => r._failed);
            const succeeded = results.filter(r => !r._failed);
            if (succeeded.length > 0) this.selectedFiles = [...this.selectedFiles, ...succeeded];
            if (failed.length > 0) {
                this.fileWarning = `Failed to read: ${failed.map(f => f.name).join(', ')}`;
            }
        });
    }

    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: file.name,
                base64Data: reader.result.split(',')[1],
                contentType: file.type || 'application/octet-stream'
            });
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /* -------------------------
       Search
    -------------------------- */

    handleUserFocus() {
        if (this._skipNextUserFocus) {
            this._skipNextUserFocus = false;
            return;
        }
        clearTimeout(this.userBlurTimeout);
        this._lastUserFocusSearchAt = Date.now();
        this.searchUsersInternal(this.userSearchKeyword || '');
    }

    handleUserClick() {
        clearTimeout(this.userBlurTimeout);
        this._skipNextUserFocus = false;

        if (
            this.isUserSearchOpen &&
            this.userResults.length > 0 &&
            Date.now() - (this._lastUserFocusSearchAt || 0) < SEARCH_FOCUS_CLICK_WINDOW_MS
        ) {
            return;
        }

        this.searchUsersInternal(this.userSearchKeyword || '');
    }

    handleUserBlur() {
        if (this._isInteractingWithSearchDropdown) {
            return;
        }

        clearTimeout(this.userBlurTimeout);
        this.userBlurTimeout = setTimeout(() => {
            this.closeUserSearch();
        }, SEARCH_BLUR_CLOSE_DELAY_MS);
    }

    handleGroupFocus() {
        if (this._skipNextGroupFocus) {
            this._skipNextGroupFocus = false;
            return;
        }
        clearTimeout(this.groupBlurTimeout);
        this._lastGroupFocusSearchAt = Date.now();
        this.searchGroupsInternal(this.groupSearchKeyword || '');
    }

    handleGroupClick() {
        clearTimeout(this.groupBlurTimeout);
        this._skipNextGroupFocus = false;

        if (
            this.isGroupSearchOpen &&
            this.groupResults.length > 0 &&
            Date.now() - (this._lastGroupFocusSearchAt || 0) < SEARCH_FOCUS_CLICK_WINDOW_MS
        ) {
            return;
        }

        this.searchGroupsInternal(this.groupSearchKeyword || '');
    }

    handleGroupBlur() {
        if (this._isInteractingWithSearchDropdown) {
            return;
        }

        clearTimeout(this.groupBlurTimeout);
        this.groupBlurTimeout = setTimeout(() => {
            this.closeGroupSearch();
        }, SEARCH_BLUR_CLOSE_DELAY_MS);
    }

    handleSearchDropdownMouseDown() {
        this._isInteractingWithSearchDropdown = true;
        clearTimeout(this.searchDropdownInteractionTimeout);
        this.searchDropdownInteractionTimeout = setTimeout(() => {
            this._isInteractingWithSearchDropdown = false;
        }, 0);
    }

    handleSearchAreaClick(e) {
        e.stopPropagation();
    }

    handleModalOutsideSearchClick() {
        this.closeUserSearch();
        this.closeGroupSearch();
    }

    handleUserSearch(e) {
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;

        clearTimeout(this.userSearchTimeout);

        const val = e.target.value;
        this.userSearchKeyword = val || '';

        this.userSearchTimeout = setTimeout(() => {
            this.searchUsersInternal(val || '');
        }, 300);
    }

    handleGroupSearch(e) {
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;

        clearTimeout(this.groupSearchTimeout);

        const val = e.target.value;
        this.groupSearchKeyword = val || '';

        this.groupSearchTimeout = setTimeout(() => {
            this.searchGroupsInternal(val || '');
        }, 300);
    }

    handleUserKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!this.userResults.length) return;
            const next = Math.min(this._userHighlightIndex + 1, this.userResults.length - 1);
            this._userHighlightIndex = next;
            this.userResults = this._applyUserHighlight(this.userResults, next);
            this._scrollActiveIntoView('dropdown-item--active');
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!this.userResults.length) return;
            const prev = Math.max(this._userHighlightIndex - 1, -1);
            this._userHighlightIndex = prev;
            this.userResults = this._applyUserHighlight(this.userResults, prev);
            if (prev >= 0) this._scrollActiveIntoView('dropdown-item--active');
            return;
        }
        if (e.key === 'Escape') {
            this.closeUserSearch();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.isUserSearchOpen && this.userResults.length > 0) {
                const idx = this._userHighlightIndex >= 0 ? this._userHighlightIndex : 0;
                this.addSelectedUser(this.userResults[idx], true);
                return;
            }
            const keyword = e.target.value || '';
            this.userSearchKeyword = keyword;
            this.searchUsersInternal(keyword);
        }
    }

    handleGroupKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!this.groupResults.length) return;
            const next = Math.min(this._groupHighlightIndex + 1, this.groupResults.length - 1);
            this._groupHighlightIndex = next;
            this.groupResults = this._applyGroupHighlight(this.groupResults, next);
            this._scrollActiveIntoView('result-row--active');
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!this.groupResults.length) return;
            const prev = Math.max(this._groupHighlightIndex - 1, -1);
            this._groupHighlightIndex = prev;
            this.groupResults = this._applyGroupHighlight(this.groupResults, prev);
            if (prev >= 0) this._scrollActiveIntoView('result-row--active');
            return;
        }
        if (e.key === 'Escape') {
            this.closeGroupSearch();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.isGroupSearchOpen && this.groupResults.length > 0) {
                const idx = this._groupHighlightIndex >= 0 ? this._groupHighlightIndex : 0;
                this._addGroupByIndex(idx);
                return;
            }
            const keyword = e.target.value || '';
            this.groupSearchKeyword = keyword;
            this.searchGroupsInternal(keyword);
        }
    }

    async searchUsersInternal(keyword) {
        this.isUserSearchOpen = true;
        const requestId = (this.userSearchRequestId || 0) + 1;
        this.userSearchRequestId = requestId;

        try {
            const results = await searchUsers({ keyword });

            if (!this.isUserSearchOpen || requestId !== this.userSearchRequestId) {
                return;
            }

            this._userHighlightIndex = -1;
            this.userResults = results
                .filter(user => !this.selectedUserIds.has(user.Id))
                .map(u => ({ ...u, itemClass: 'dropdown-item' }));
        } catch (err) {
            if (this.isUserSearchOpen && requestId === this.userSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load users',
                    message: err?.body?.message || 'An error occurred while searching users.',
                    variant: 'error'
                }));
                this.userResults = [];
            }
        }
    }

    async searchGroupsInternal(keyword) {
        this.isGroupSearchOpen = true;
        const requestId = (this.groupSearchRequestId || 0) + 1;
        this.groupSearchRequestId = requestId;

        const existingGroupsById = new Map(
            this.groupResults.map(group => [group.Id, group])
        );

        try {
            const results = await searchGroups({ keyword });

            if (!this.isGroupSearchOpen || requestId !== this.groupSearchRequestId) {
                return;
            }

            this._groupHighlightIndex = -1;
            this.groupResults = results.map(group =>
                this.buildGroupResult(group, existingGroupsById.get(group.Id))
            );

            this.syncGroupMembersSelection();
        } catch (err) {
            if (this.isGroupSearchOpen && requestId === this.groupSearchRequestId) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Could not load groups',
                    message: err?.body?.message || 'An error occurred while searching groups.',
                    variant: 'error'
                }));
                this.groupResults = [];
            }
        }
    }

    closeUserSearch() {
        this.isUserSearchOpen = false;
        this.userSearchRequestId = (this.userSearchRequestId || 0) + 1;
        this.userResults = [];
        this._userHighlightIndex = -1;
    }

    closeGroupSearch() {
        this.isGroupSearchOpen = false;
        this.groupSearchRequestId = (this.groupSearchRequestId || 0) + 1;
        this.groupResults = [];
        this._groupHighlightIndex = -1;
    }

    _applyUserHighlight(results, idx) {
        return results.map((u, i) => ({
            ...u,
            itemClass: i === idx ? 'dropdown-item dropdown-item--active' : 'dropdown-item'
        }));
    }

    _applyGroupHighlight(results, idx) {
        const base = 'result-row slds-grid slds-grid_align-spread slds-p-around_small';
        return results.map((g, i) => ({
            ...g,
            resultRowClass: i === idx ? base + ' result-row--active' : base
        }));
    }

    _scrollActiveIntoView(activeClass) {
        // Defer one tick so LWC has re-rendered the updated class before we scroll.
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const el = this.template.querySelector('.' + activeClass);
            if (el) el.scrollIntoView({ block: 'nearest' });
        }, 0);
    }

    _addGroupByIndex(idx) {
        const g = this.groupResults[idx];
        if (!g || this.selectedGroupIds.has(g.Id)) return;
        this.selectedGroupIds.add(g.Id);
        this.selectedGroups = [...this.selectedGroups, { id: g.Id, name: g.Name }];
        this._groupHighlightIndex = -1;
        this.groupResults = [];
        this.resetSearchAfterSelection('group');
    }

    /* -------------------------
       Attendee selection
    -------------------------- */

    addUser(e) {

        const id = e.currentTarget.dataset.id;

        if (this.selectedUserIds.has(id)) return;

        const u = this.userResults.find(x => x.Id === id);

        if (!u) return;

        this.addSelectedUser(u, true);
    }

    addUserFromGroup(e) {

        const userId = e.currentTarget.dataset.id;

        if (this.selectedUserIds.has(userId)) return;

        let user;

        for (const group of this.groupResults) {
            user = (group.members || []).find(member => member.Id === userId);

            if (user) {
                break;
            }
        }

        if (!user) return;

        this.addSelectedUser(user);
    }

    addSelectedUser(user, keepUserSearchOpen = false) {

        this.selectedUserIds.add(user.Id);

        this.selectedUsers = [
            ...this.selectedUsers,
            { id: user.Id, name: user.Name }
        ];

        this.syncGroupMembersSelection();

        if (keepUserSearchOpen) {
            this.resetUserSearchAfterSelection();
        } else {
            this.closeUserSearch();
        }
    }

    addGroup(e) {

        const id = e.currentTarget.dataset.id;

        if (this.selectedGroupIds.has(id)) return;

        const g = this.groupResults.find(x => x.Id === id);

        this.selectedGroupIds.add(id);

        this.selectedGroups = [
            ...this.selectedGroups,
            { id, name: g.Name }
        ];

        this.groupResults = [];
        this.resetSearchAfterSelection('group');
    }

    resetSearchAfterSelection(type) {
        this.userSearchKeyword = '';
        this.groupSearchKeyword = '';
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.groupSearchTimeout);
        clearTimeout(this.userBlurTimeout);
        clearTimeout(this.groupBlurTimeout);

        const selector = type === 'group'
            ? 'lightning-input[data-id="group-search-input"]'
            : 'lightning-input[data-id="user-search-input"]';

        const searchInput = this.template.querySelector(selector);

        if (searchInput) {
            if (type === 'group') {
                this._skipNextGroupFocus = true;
            } else {
                this._skipNextUserFocus = true;
            }
            searchInput.focus();
        }
    }

    resetUserSearchAfterSelection() {
        this.userSearchKeyword = '';
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.userBlurTimeout);

        const searchInput = this.template.querySelector('lightning-input[data-id="user-search-input"]');

        if (searchInput) {
            this._skipNextUserFocus = true;
            searchInput.focus();
            this._skipNextUserFocus = false;
        }

        this.searchUsersInternal('');
    }

    removeUser(e) {

        const id = e.target.dataset.id;

        this.selectedUserIds.delete(id);

        this.selectedUsers =
            this.selectedUsers.filter(u => u.id !== id);

        this.userResults = [
            ...this.userResults
        ];

        this.syncGroupMembersSelection();
    }

    removeGroup(e) {

        const id = e.target.dataset.id;

        this.selectedGroupIds.delete(id);

        this.selectedGroups =
            this.selectedGroups.filter(g => g.id !== id);
    }

    async toggleGroupMembers(e) {

        const id = e.currentTarget.dataset.id;
        const group = this.groupResults.find(item => item.Id === id);

        if (!group) return;

        if (group.membersLoaded) {
            this.updateGroupResult(id, {
                isExpanded: !group.isExpanded,
                memberToggleLabel: group.isExpanded ? 'Show users' : 'Hide users'
            });
            return;
        }

        this.updateGroupResult(id, {
            isExpanded: true,
            isLoadingMembers: true,
            memberToggleLabel: 'Hide users'
        });

        try {
            const members = await getGroupUsers({ groupId: id });

            this.updateGroupResult(id, {
                members: members.map(member => this.buildGroupMember(member)),
                membersLoaded: true,
                isLoadingMembers: false,
                showNoMembers: members.length === 0
            });
        } catch (error) {
            this.updateGroupResult(id, {
                isExpanded: false,
                isLoadingMembers: false,
                memberToggleLabel: 'Show users'
            });

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Error',
                    message: error?.body?.message || error.message,
                    variant: 'error'
                })
            );
        }
    }

    buildGroupResult(group, existingGroup) {
        return {
            ...group,
            isExpanded: existingGroup?.isExpanded || false,
            isLoadingMembers: false,
            membersLoaded: existingGroup?.membersLoaded || false,
            members: (existingGroup?.members || []).map(member => this.buildGroupMember(member)),
            memberToggleLabel: existingGroup?.isExpanded ? 'Hide users' : 'Show users',
            showNoMembers: existingGroup?.showNoMembers || false,
            resultRowClass: existingGroup?.resultRowClass || 'result-row slds-grid slds-grid_align-spread slds-p-around_small'
        };
    }

    buildGroupMember(member) {
        const isSelected = this.selectedUserIds.has(member.Id);

        return {
            ...member,
            isSelected,
            actionLabel: isSelected ? 'Selected' : 'Add'
        };
    }

    updateGroupResult(id, changes) {
        this.groupResults = this.groupResults.map(group =>
            group.Id === id ? { ...group, ...changes } : group
        );
    }

    syncGroupMembersSelection() {
        this.groupResults = this.groupResults.map(group => ({
            ...group,
            members: (group.members || []).map(member => this.buildGroupMember(member)),
            showNoMembers: group.membersLoaded && (group.members || []).length === 0
        }));
    }

    /* -------------------------
       Save Event
    -------------------------- */

    // Flush any value the user typed into a flatpickr alt-input without the
    // onChange callback firing (happens in LWS where blur events are sandboxed).
    _commitFlatpickrTypedValues() {
        const commit = (fp) => {
            if (!fp?.altInput?.value) return null;
            fp.setDate(fp.altInput.value, false, fp.config.altFormat);
            return fp.selectedDates?.[0] ?? null;
        };

        const start = commit(this._fpStart);
        if (start) {
            const formatted = this.isAllDay ? this.formatDateOnly(start) : this.format(start);
            if (formatted !== this.startDateTime) {
                const prev = this.startDateTime;
                this.startDateTime = formatted;
                this._syncEndAfterStart(prev);
            }
        }

        const end = commit(this._fpEnd);
        if (end) {
            const formatted = this.isAllDay ? this.formatDateOnly(end) : this.format(end);
            if (formatted !== this.endDateTime) {
                this.endDateTime = formatted;
            }
        }
    }

    async _performSave() {
        this._commitFlatpickrTypedValues();

        if (!this.subject || !this.subject.trim()) {
            throw new Error('Enter a subject.');
        }

        const startDateTimeIso = this.isAllDay
            ? this.toDateOnly(this.startDateTime)
            : this.toIsoString(this.startDateTime);
        const endDateTimeIso = this.isAllDay
            ? this.toDateOnly(this.endDateTime)
            : this.toIsoString(this.endDateTime);

        if (!startDateTimeIso || !endDateTimeIso) {
            throw new Error('Enter a valid start and end date/time.');
        }

        if (this.isAllDay && endDateTimeIso < startDateTimeIso) {
            throw new Error('End date must be on or after start date.');
        }

        if (this.typeValue?.toLowerCase() === 'mediation' && !this.mediatorId) {
            throw new Error('Mediator is required for Mediation events.');
        }

        if (
            !this.isAllDay &&
            new Date(endDateTimeIso).getTime() <= new Date(startDateTimeIso).getTime()
        ) {
            throw new Error('End must be after Start.');
        }

        const attachments = this.selectedFiles;

        if (this.isEditMode) {
            await updateCalendarEvent({
                eventId:          this.editEventId,
                subject:          this.subject,
                startDateTimeIso,
                endDateTimeIso,
                isAllDay:         this.isAllDay,
                typeValue:        this.typeValue,
                location:         this.location,
                description:      this.description,
                selectedUserIds:  [...this.selectedUserIds],
                selectedGroupIds: [...this.selectedGroupIds],
                attachments,
                reminderOptions:  this.isReminderSet ? this.selectedReminderOptions : [],
                showAs:           this.showAs
            });
        } else {
            if (this.isRecurring) {
                if (!this.recurrencePattern) throw new Error('Select a recurrence pattern.');
                if (!this.recurrenceEndDate) throw new Error('Enter a recurrence end date.');
            }

            await saveEventWithAttendees({
                caseId: this.recordId,
                ownerId: currentUserId,
                subject: this.subject,
                startDateTimeIso,
                endDateTimeIso,
                isAllDay: this.isAllDay,
                typeValue: this.typeValue,
                location: this.location,
                description: this.description,
                selectedUserIds: [...this.selectedUserIds],
                selectedGroupIds: [...this.selectedGroupIds],
                reminderOptions: this.selectedReminderOptions,
                attachments,
                recurrencePattern: this.isRecurring ? this.recurrencePattern : null,
                recurrenceInterval: this.isRecurring ? this.recurrenceInterval : null,
                recurrenceEndDateStr: this.isRecurring ? this.recurrenceEndDate : null,
                recurrenceDaysOfWeek: this.isRecurring ? this.recurrenceDaysOfWeek : null,
                recurrenceCount: null,
                showAs: this.showAs,
                mediatorId: this.mediatorId
            });
        }
    }

    async save() {
        if (this.isSaving) return;
        this.isSaving = true;
        try {
            await this._performSave();
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: this.isEditMode ? 'Event updated' : 'Event created', variant: 'success' }));
            this.close('success');
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: e.body?.message || e.message, variant: 'error' }));
        } finally {
            this.isSaving = false;
        }
    }

    async saveAndNew() {
        if (this.isSaving) return;
        this.isSaving = true;
        try {
            await this._performSave();
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: 'Event created', variant: 'success' }));
            publish(this.messageContext, CALENDAR_EVENT_CHANGED, {});
            this.resetForNew();
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: e.body?.message || e.message, variant: 'error' }));
        } finally {
            this.isSaving = false;
        }
    }

    resetForNew() {
        // startDateTime, endDateTime, isAllDay preserved so next event defaults to same date/time
        this.subject              = '';
        this.typeValue            = '';
        this.isReminderSet        = false;
        this.selectedReminderOptions = [];
        this.autoRemindersAdded   = false;
        this.location             = '';
        this.description          = '';
        this.selectedFiles        = [];
        this.fileWarning          = '';
        this.isDragOver           = false;
        this.isRecurring          = false;
        this.recurrencePattern    = '';
        this.recurrenceInterval   = 1;
        this.recurrenceEndDate    = '';
        this.recurrenceDaysOfWeek = [];
        this.mediatorId           = null;
        this.isCreatingProvider   = false;
        this.userResults          = [];
        this.groupResults         = [];
        // attendees (selectedUsers, selectedGroups, selectedUserIds, selectedGroupIds) are intentionally kept
    }

    /* -------------------------
       Flatpickr
    -------------------------- */

    _flatpickrConfig() {
        const isAllDay = this.isAllDay;
        return {
            enableTime: !isAllDay,
            dateFormat: isAllDay ? 'Y-m-d' : 'Y-m-d H:i',
            altInput: true,
            altFormat: isAllDay ? 'm/d/Y' : 'm/d/Y h:i K',
            altInputClass: 'slds-input',
            allowInput: true,
            monthSelectorType: 'dropdown',
            appendTo: document.body,
            disableMobile: true,
            time_24hr: false
        };
    }

    _initFlatpickr() {
        if (this._fpStart) return;
        const startEl = this.template.querySelector('[data-id="start-input"]');
        const endEl   = this.template.querySelector('[data-id="end-input"]');
        const fp = window.flatpickr;
        if (!startEl || !endEl || typeof fp !== 'function') return;

        const cfg = this._flatpickrConfig();

        // For all-day, pass the YYYY-MM-DD string directly so flatpickr parses it
        // with its own Y-m-d parser (avoids UTC→local day-shift bug).
        // For datetime, pass a Date object (string is YYYY-MM-DDTHH:MM which doesn't
        // match dateFormat 'Y-m-d H:i').
        const toDefault = (val) => this.isAllDay
            ? (val || undefined)
            : (this.parseLocalDateTime(val) || undefined);

        this._fpStart = fp(startEl, {
            ...cfg,
            defaultDate: toDefault(this.startDateTime),
            onChange: (dates) => {
                if (!dates.length) return;
                const prev = this.startDateTime;
                this.startDateTime = this.isAllDay
                    ? this.formatDateOnly(dates[0])
                    : this.format(dates[0]);
                this._syncEndAfterStart(prev);
            }
        });

        this._fpEnd = fp(endEl, {
            ...cfg,
            defaultDate: toDefault(this.endDateTime),
            onChange: (dates) => {
                if (!dates.length) return;
                this.endDateTime = this.isAllDay
                    ? this.formatDateOnly(dates[0])
                    : this.format(dates[0]);
            }
        });
    }

    _destroyFlatpickr() {
        if (this._fpStart) { this._fpStart.destroy(); this._fpStart = null; }
        if (this._fpEnd)   { this._fpEnd.destroy();   this._fpEnd   = null; }
    }

    _syncEndAfterStart(prevStartValue) {
        if (this.isAllDay) {
            if (this.endDateTime && this.endDateTime < this.startDateTime) {
                this.endDateTime = this.startDateTime;
                if (this._fpEnd) this._fpEnd.setDate(this.startDateTime, false);
            }
            return;
        }
        const previousStart = this.parseLocalDateTime(prevStartValue);
        const previousEnd   = this.parseLocalDateTime(this.endDateTime);
        const nextStart     = this.parseLocalDateTime(this.startDateTime);
        if (!nextStart) return;

        let newEnd;
        if (previousStart && previousEnd) {
            const durationMs = previousEnd.getTime() - previousStart.getTime();
            if (durationMs > 0) newEnd = new Date(nextStart.getTime() + durationMs);
        }
        if (!newEnd) newEnd = new Date(nextStart.getTime() + 60 * 60 * 1000);
        this.endDateTime = this.format(newEnd);
        if (this._fpEnd) this._fpEnd.setDate(newEnd, false);
    }

    disconnectedCallback() {
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.groupSearchTimeout);
        clearTimeout(this.userBlurTimeout);
        clearTimeout(this.groupBlurTimeout);
        clearTimeout(this.searchDropdownInteractionTimeout);
        this._destroyFlatpickr();
    }

    handleCancel() {
        this.close();
    }
}