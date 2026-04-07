import LightningModal from 'lightning/modal';
import { api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getPicklistValues } from 'lightning/uiObjectInfoApi';

import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';
import searchGroups from '@salesforce/apex/EventAttendeeUiController.searchGroups';
import saveEventWithAttendees from '@salesforce/apex/EventAttendeeUiController.saveEventWithAttendees';

import MATTER_NAME from '@salesforce/schema/neos_matter__c.Name';
import EVENT_TYPE_FIELD from '@salesforce/schema/Event.Type';

const MASTER_RECORD_TYPE_ID = '012000000000000AAA';
const FIRM_CALENDAR_USER_ID = '005Hs00000GDhuK';
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

export default class EventCreateModalAction extends LightningModal {

    @api recordId;

    subject = '';
    startDateTime;
    endDateTime;
    isAllDay = false;
    showAs = 'Busy';
    typeValue = '';
    isReminderSet = false;
    location = '';
    description = '';

    /* -------------------------
       Reminder Support
    -------------------------- */

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
        { label: '5 Days Before', value: '5 Days Before' },
        { label: '4 Days Before', value: '4 Days Before' },
        { label: '3 Days Before', value: '3 Days Before' },
        { label: '2 Days Before', value: '2 Days Before' },
        { label: '1 Day Before', value: '1 Day Before' }
    ];

    handleReminderChange(event) {
        this.selectedReminderOptions = event.detail.value;
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

    userSearchTimeout;
    groupSearchTimeout;

    /* -------------------------
       Init
    -------------------------- */

    connectedCallback() {

        const now = new Date();
        now.setMinutes(0, 0, 0);

        const end = new Date(now);
        end.setHours(end.getHours() + 1);

        this.startDateTime = this.format(now);
        this.endDateTime = this.format(end);
    }

    format(d) {

        const p = n => n.toString().padStart(2, '0');

        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    /* -------------------------
       Matter record
    -------------------------- */

    @wire(getRecord, { recordId: '$recordId', fields: [MATTER_NAME] })
    matter;

    get relatedToName() {
        return this.matter?.data?.fields?.Name?.value;
    }

    renderedCallback() {

        if (!this.subject && this.relatedToName) {
            this.subject = this.relatedToName;
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

    get showAsOptions() {
        return [
            { label: 'Busy', value: 'Busy' },
            { label: 'Free', value: 'Free' }
        ];
    }

    /* -------------------------
       Field Handlers
    -------------------------- */

    handleSubject = e => this.subject = e.target.value;
    handleStart = e => this.startDateTime = e.target.value;
    handleEnd = e => this.endDateTime = e.target.value;
    handleAllDay = e => this.isAllDay = e.target.checked;
    handleShowAs = e => this.showAs = e.target.value;
    handleType = e => {
        this.typeValue = e.target.value;

        if (AUTO_REMINDER_EVENT_TYPES.has(this.typeValue)) {
            this.isReminderSet = true;
            this.selectedReminderOptions = [...AUTO_REMINDER_VALUES];
        } else {
            this.isReminderSet = false;
            this.selectedReminderOptions = [];
        }
    };
    handleReminderSet = e => this.isReminderSet = e.target.checked;
    handleLocation = e => this.location = e.target.value;
    handleDescription = e => this.description = e.target.value;

    /* -------------------------
       Search
    -------------------------- */

    handleUserFocus() {
        this.searchUsersInternal('');
    }

    handleGroupFocus() {
        this.searchGroupsInternal('');
    }

    handleUserSearch(e) {

        clearTimeout(this.userSearchTimeout);

        const val = e.target.value;

        this.userSearchTimeout = setTimeout(() => {
            this.searchUsersInternal(val || '');
        }, 300);
    }

    handleGroupSearch(e) {

        clearTimeout(this.groupSearchTimeout);

        const val = e.target.value;

        this.groupSearchTimeout = setTimeout(() => {
            this.searchGroupsInternal(val || '');
        }, 300);
    }

    handleUserKeydown(e) {

        if (e.key === 'Enter') {
            e.preventDefault();
            this.searchUsersInternal(e.target.value || '');
        }
    }

    handleGroupKeydown(e) {

        if (e.key === 'Enter') {
            e.preventDefault();
            this.searchGroupsInternal(e.target.value || '');
        }
    }

    async searchUsersInternal(keyword) {
        this.userResults = await searchUsers({ keyword });
    }

    async searchGroupsInternal(keyword) {
        this.groupResults = await searchGroups({ keyword });
    }

    /* -------------------------
       Attendee selection
    -------------------------- */

    addUser(e) {

        const id = e.target.dataset.id;

        if (this.selectedUserIds.has(id)) return;

        const u = this.userResults.find(x => x.Id === id);

        this.selectedUserIds.add(id);

        this.selectedUsers = [
            ...this.selectedUsers,
            { id, name: u.Name }
        ];
    }

    addGroup(e) {

        const id = e.target.dataset.id;

        if (this.selectedGroupIds.has(id)) return;

        const g = this.groupResults.find(x => x.Id === id);

        this.selectedGroupIds.add(id);

        this.selectedGroups = [
            ...this.selectedGroups,
            { id, name: g.Name }
        ];
    }

    removeUser(e) {

        const id = e.target.dataset.id;

        this.selectedUserIds.delete(id);

        this.selectedUsers =
            this.selectedUsers.filter(u => u.id !== id);
    }

    removeGroup(e) {

        const id = e.target.dataset.id;

        this.selectedGroupIds.delete(id);

        this.selectedGroups =
            this.selectedGroups.filter(g => g.id !== id);
    }

    /* -------------------------
       Save Event
    -------------------------- */

    async save() {

        try {

            await saveEventWithAttendees({

                caseId: this.recordId,
                ownerId: FIRM_CALENDAR_USER_ID,
                subject: this.subject,
                startDateTimeIso: this.startDateTime,
                endDateTimeIso: this.endDateTime,
                isAllDay: this.isAllDay,
                showAs: this.showAs,
isReminderSet: this.isReminderSet,
typeValue: this.typeValue,
                location: this.location,
                description: this.description,
                selectedUserIds: [...this.selectedUserIds],
                selectedGroupIds: [...this.selectedGroupIds],
                reminderOptions: this.selectedReminderOptions
            });

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Success',
                    message: 'Event created',
                    variant: 'success'
                })
            );

            this.close('success');

        } catch (e) {

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Error',
                    message: e.body?.message || e.message,
                    variant: 'error'
                })
            );
        }
    }

    handleCancel() {
        this.close();
    }
}
