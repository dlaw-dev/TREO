import LightningModal from 'lightning/modal';
import { api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getPicklistValues } from 'lightning/uiObjectInfoApi';

import searchUsers from '@salesforce/apex/EventAttendeeUiController.searchUsers';
import searchGroups from '@salesforce/apex/EventAttendeeUiController.searchGroups';
import getGroupUsers from '@salesforce/apex/EventAttendeeUiController.getGroupUsers';
import saveEventWithAttendees from '@salesforce/apex/EventAttendeeUiController.saveEventWithAttendees';

import CASE_TITLE from '@salesforce/schema/neos_matter__c.Case_Title__c';
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
    showAs = 'Free';
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
        { label: '7 Days Before', value: '7 Days Before' },
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
    isSaving = false;

    userSearchTimeout;
    groupSearchTimeout;
    userSearchKeyword = '';
    groupSearchKeyword = '';

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

    parseLocalDateTime(value) {
        if (!value) {
            return null;
        }

        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    toIsoString(value) {
        if (!value) {
            return null;
        }

        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            return null;
        }

        return parsed.toISOString();
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

    get isSaveDisabled() {
        return this.isSaving;
    }

    /* -------------------------
       Field Handlers
    -------------------------- */

    handleSubject = e => this.subject = e.target.value;
    handleStart = e => {
        const nextStartValue = e.target.value;
        const previousStart = this.parseLocalDateTime(this.startDateTime);
        const previousEnd = this.parseLocalDateTime(this.endDateTime);
        const nextStart = this.parseLocalDateTime(nextStartValue);

        this.startDateTime = nextStartValue;

        if (!nextStart) {
            return;
        }

        if (previousStart && previousEnd) {
            const durationMs = previousEnd.getTime() - previousStart.getTime();

            if (durationMs > 0) {
                this.endDateTime = this.format(
                    new Date(nextStart.getTime() + durationMs)
                );
                return;
            }
        }

        this.endDateTime = this.format(
            new Date(nextStart.getTime() + (60 * 60 * 1000))
        );
    };
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
        this.userSearchKeyword = val || '';

        this.userSearchTimeout = setTimeout(() => {
            this.searchUsersInternal(val || '');
        }, 300);
    }

    handleGroupSearch(e) {

        clearTimeout(this.groupSearchTimeout);

        const val = e.target.value;
        this.groupSearchKeyword = val || '';

        this.groupSearchTimeout = setTimeout(() => {
            this.searchGroupsInternal(val || '');
        }, 300);
    }

    handleUserKeydown(e) {

        if (e.key === 'Enter') {
            e.preventDefault();
            const keyword = e.target.value || '';
            this.userSearchKeyword = keyword;
            this.searchUsersInternal(keyword);
        }
    }

    handleGroupKeydown(e) {

        if (e.key === 'Enter') {
            e.preventDefault();
            const keyword = e.target.value || '';
            this.groupSearchKeyword = keyword;
            this.searchGroupsInternal(keyword);
        }
    }

    async searchUsersInternal(keyword) {
        const results = await searchUsers({ keyword });

        this.userResults = results.filter(
            user => !this.selectedUserIds.has(user.Id)
        );
    }

    async searchGroupsInternal(keyword) {
        const existingGroupsById = new Map(
            this.groupResults.map(group => [group.Id, group])
        );

        this.groupResults = (await searchGroups({ keyword })).map(group =>
            this.buildGroupResult(group, existingGroupsById.get(group.Id))
        );

        this.syncGroupMembersSelection();
    }

    /* -------------------------
       Attendee selection
    -------------------------- */

    addUser(e) {

        const id = e.currentTarget.dataset.id;

        if (this.selectedUserIds.has(id)) return;

        const u = this.userResults.find(x => x.Id === id);

        if (!u) return;

        this.addSelectedUser(u);
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

    addSelectedUser(user) {

        this.selectedUserIds.add(user.Id);

        this.selectedUsers = [
            ...this.selectedUsers,
            { id: user.Id, name: user.Name }
        ];

        this.userResults = this.userResults.filter(
            result => result.Id !== user.Id
        );

        this.syncGroupMembersSelection();
        this.resetSearchAfterSelection('user');
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

        this.resetSearchAfterSelection('group');
    }

    resetSearchAfterSelection(type) {
        this.userSearchKeyword = '';
        this.groupSearchKeyword = '';
        clearTimeout(this.userSearchTimeout);
        clearTimeout(this.groupSearchTimeout);

        const selector = type === 'group'
            ? 'lightning-input[data-id="group-search-input"]'
            : 'lightning-input[data-id="user-search-input"]';

        const searchInput = this.template.querySelector(selector);

        if (searchInput) {
            searchInput.focus();
        }
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
            showNoMembers: existingGroup?.showNoMembers || false
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

    async save() {
        if (this.isSaving) {
            return;
        }

        this.isSaving = true;

        try {
            const startDateTimeIso = this.toIsoString(this.startDateTime);
            const endDateTimeIso = this.toIsoString(this.endDateTime);

            if (!startDateTimeIso || !endDateTimeIso) {
                throw new Error('Enter a valid start and end date/time.');
            }

            if (new Date(endDateTimeIso).getTime() <= new Date(startDateTimeIso).getTime()) {
                throw new Error('End must be after Start.');
            }

            await saveEventWithAttendees({

                caseId: this.recordId,
                ownerId: FIRM_CALENDAR_USER_ID,
                subject: this.subject,
                startDateTimeIso,
                endDateTimeIso,
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
        } finally {
            this.isSaving = false;
        }
    }

    handleCancel() {
        this.close();
    }
}
