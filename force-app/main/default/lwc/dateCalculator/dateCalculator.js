import { LightningElement, track } from 'lwc';

const PRESETS = [
    { label: '+30 Days',  years: 0, months: 0, days: 30 },
    { label: '+60 Days',  years: 0, months: 0, days: 60 },
    { label: '+90 Days',  years: 0, months: 0, days: 90 },
    { label: '+6 Months', years: 0, months: 6, days: 0  },
    { label: '+1 Year',   years: 1, months: 0, days: 0  },
    { label: '+2 Years',  years: 2, months: 0, days: 0  },
    { label: '+3 Years',  years: 3, months: 0, days: 0  },
    { label: '+5 Years',  years: 5, months: 0, days: 0  },
];

const DAYS         = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS       = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// LA Superior Court judicial holidays 2026–2030 (exact observed dates from lacourt.ca.gov)
const JUDICIAL_HOLIDAYS = {
    '2026-01-01': "New Year's Day",         '2026-01-19': 'Martin Luther King, Jr. Birthday',
    '2026-02-12': 'Lincoln Day',             '2026-02-16': "Presidents' Day",
    '2026-03-31': 'Farmworkers Day',         '2026-05-25': 'Memorial Day',
    '2026-06-19': 'Juneteenth',              '2026-07-03': 'Independence Day',
    '2026-09-07': 'Labor Day',               '2026-09-25': 'Native American Day',
    '2026-11-11': 'Veterans Day',            '2026-11-26': 'Thanksgiving Day',
    '2026-11-27': 'Day after Thanksgiving',  '2026-12-25': 'Christmas Day',

    '2027-01-01': "New Year's Day",          '2027-01-18': 'Martin Luther King, Jr. Birthday',
    '2027-02-12': 'Lincoln Day',             '2027-02-15': "Presidents' Day",
    '2027-03-31': 'Farmworkers Day',         '2027-05-31': 'Memorial Day',
    '2027-06-18': 'Juneteenth',              '2027-07-05': 'Independence Day',
    '2027-09-06': 'Labor Day',               '2027-09-24': 'Native American Day',
    '2027-11-11': 'Veterans Day',            '2027-11-25': 'Thanksgiving Day',
    '2027-11-26': 'Day after Thanksgiving',  '2027-12-24': 'Christmas Day',
    '2027-12-31': "New Year's Day (2028)",

    '2028-01-17': 'Martin Luther King, Jr. Birthday',
    '2028-02-11': 'Lincoln Day',             '2028-02-21': "Presidents' Day",
    '2028-03-31': 'Farmworkers Day',         '2028-05-29': 'Memorial Day',
    '2028-06-19': 'Juneteenth',              '2028-07-04': 'Independence Day',
    '2028-09-04': 'Labor Day',               '2028-09-22': 'Native American Day',
    '2028-11-10': 'Veterans Day',            '2028-11-23': 'Thanksgiving Day',
    '2028-11-24': 'Day after Thanksgiving',  '2028-12-25': 'Christmas Day',

    '2029-01-01': "New Year's Day",          '2029-01-15': 'Martin Luther King, Jr. Birthday',
    '2029-02-12': 'Lincoln Day',             '2029-02-19': "Presidents' Day",
    '2029-03-30': 'Farmworkers Day',         '2029-05-28': 'Memorial Day',
    '2029-06-19': 'Juneteenth',              '2029-07-04': 'Independence Day',
    '2029-09-03': 'Labor Day',               '2029-09-28': 'Native American Day',
    '2029-11-12': 'Veterans Day',            '2029-11-22': 'Thanksgiving Day',
    '2029-11-23': 'Day after Thanksgiving',  '2029-12-25': 'Christmas Day',

    '2030-01-01': "New Year's Day",          '2030-01-21': 'Martin Luther King, Jr. Birthday',
    '2030-02-12': 'Lincoln Day',             '2030-02-18': "Presidents' Day",
    '2030-04-01': 'Farmworkers Day',         '2030-05-27': 'Memorial Day',
    '2030-06-19': 'Juneteenth',              '2030-07-04': 'Independence Day',
    '2030-09-02': 'Labor Day',               '2030-09-27': 'Native American Day',
    '2030-11-11': 'Veterans Day',            '2030-11-28': 'Thanksgiving Day',
    '2030-11-29': 'Day after Thanksgiving',  '2030-12-25': 'Christmas Day',
};

const JUDICIAL_YEARS = new Set([2026, 2027, 2028, 2029, 2030]);

export default class DateCalculator extends LightningElement {
    // Add to Date
    @track startDate = today();
    @track addYears  = 0;
    @track addMonths = 0;
    @track addDays   = 0;
    @track copyLabel = 'Copy';

    // Days Between
    @track countStart       = today();
    @track countEnd         = '';
    @track businessDaysOnly = false;

    // Add Business Days
    @track awStart = today();
    @track awDays  = 0;

    // Day of Week
    @track weekdayDate = today();

    // Week Number
    @track weekNumDate = today();

    // ── Add to Date ───────────────────────────────────────────────────────────

    get deadlineRows() {
        if (!this.startDate) return [];
        return PRESETS.map(p => {
            const d           = addToDate(this.startDate, p.years, p.months, p.days);
            const isWeekend   = d.getDay() === 0 || d.getDay() === 6;
            const holidayName = getHolidayName(d);
            const rowClass    = 'deadline-row' +
                (isWeekend ? ' weekend-row' : '') +
                (holidayName && !isWeekend ? ' holiday-row' : '');
            return {
                label:       p.label,
                wkKey:       p.label + '-wk',
                holidayKey:  p.label + '-hol',
                dateStr:     formatDate(d),
                copyStr:     formatCopy(d),
                dow:         DAYS[d.getDay()],
                daysLabel:   daysLabel(d),
                isWeekend,
                weekendNote: isWeekend ? weekendNote(d) : '',
                holidayName: holidayName || '',
                rowClass,
            };
        });
    }

    get customResult() {
        if (!this.startDate || (!this.addYears && !this.addMonths && !this.addDays)) return null;
        const d = addToDate(this.startDate, this.addYears, this.addMonths, this.addDays);
        if (!d) return null;
        const isWeekend   = d.getDay() === 0 || d.getDay() === 6;
        const holidayName = getHolidayName(d);
        return {
            dateStr: formatDate(d), copyStr: formatCopy(d),
            dow: DAYS[d.getDay()], daysLabel: daysLabel(d),
            isWeekend, weekendNote: isWeekend ? weekendNote(d) : '',
            holidayName: holidayName || '',
        };
    }

    handleStartDate(e) { this.startDate = e.detail.value; }
    handleYears(e)     { this.addYears  = parseInt(e.detail.value, 10) || 0; }
    handleMonths(e)    { this.addMonths = parseInt(e.detail.value, 10) || 0; }
    handleDays(e)      { this.addDays   = parseInt(e.detail.value, 10) || 0; }

    handleCopy() {
        const r = this.customResult;
        if (!r) return;
        navigator.clipboard.writeText(r.copyStr).then(() => {
            this.copyLabel = 'Copied!';
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this.copyLabel = 'Copy'; }, 2000);
        });
    }

    handleRowCopy(e) {
        navigator.clipboard.writeText(e.currentTarget.dataset.text);
    }

    // ── Days Between ─────────────────────────────────────────────────────────

    get daysBetweenResult() {
        if (!this.countStart || !this.countEnd) return null;
        const start = parseLocal(this.countStart);
        const end   = parseLocal(this.countEnd);
        if (end < start) return null;
        const totalDays = Math.round((end - start) / 864e5);
        const weeks     = Math.floor(totalDays / 7);
        const remDays   = totalDays % 7;
        const { years, months, days } = ymd(start, end);
        return {
            totalDays,
            workdays:   countWorkdays(start, end),
            weeksLine:  `${weeks} week${weeks !== 1 ? 's' : ''}, ${remDays} day${remDays !== 1 ? 's' : ''}`,
            monthsLine: `${years * 12 + months} month${(years * 12 + months) !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''}`,
            yearsLine:  years > 0 ? `${years} year${years !== 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''}` : '',
        };
    }

    handleCountStart(e)         { this.countStart       = e.detail.value;   }
    handleCountEnd(e)           { this.countEnd         = e.detail.value;   }
    handleBusinessDaysToggle(e) { this.businessDaysOnly = e.detail.checked; }

    // ── Add Business Days ─────────────────────────────────────────────────────

    get addWorkdaysResult() {
        if (!this.awStart || this.awDays === 0 || this.awDays == null) return null;
        const d = addWorkdays(this.awStart, this.awDays);
        if (!d) return null;
        const isWeekend   = d.getDay() === 0 || d.getDay() === 6;
        const holidayName = getHolidayName(d);
        return {
            dateStr: formatDate(d), copyStr: formatCopy(d),
            dow: DAYS[d.getDay()], daysLabel: daysLabel(d),
            isWeekend, weekendNote: isWeekend ? weekendNote(d) : '',
            holidayName: holidayName || '',
        };
    }

    handleAwStart(e) { this.awStart = e.detail.value;              }
    handleAwDays(e)  { this.awDays  = parseInt(e.detail.value, 10) || 0; }

    // ── Day of Week ───────────────────────────────────────────────────────────

    get weekdayResult() {
        if (!this.weekdayDate) return null;
        const d = parseLocal(this.weekdayDate);
        return { dow: DAYS[d.getDay()], dateStr: formatDate(d), daysLabel: daysLabel(d), holidayName: getHolidayName(d) || '' };
    }

    handleWeekdayDate(e) { this.weekdayDate = e.detail.value; }

    // ── Week Number ───────────────────────────────────────────────────────────

    get weekNumResult() {
        if (!this.weekNumDate) return null;
        const d   = parseLocal(this.weekNumDate);
        const num = isoWeek(d);
        const mon = weekStart(d);
        const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
        return { weekNum: num, year: d.getFullYear(), range: `${formatDate(mon)} – ${formatDate(sun)}`, holidayName: getHolidayName(d) || '' };
    }

    handleWeekNumDate(e) { this.weekNumDate = e.detail.value; }
}

// ── Holiday computation ───────────────────────────────────────────────────────

const holidayCache = {};

function computeHolidays(year) {
    const h = {};

    const addFixed = (month, day, name) => {
        const d = new Date(year, month - 1, day);
        const dow = d.getDay();
        if (dow === 6) d.setDate(d.getDate() - 1);
        if (dow === 0) d.setDate(d.getDate() + 1);
        h[toISO(d)] = name;
    };

    const nthWeekday = (month, n, weekday) => {
        const d = new Date(year, month - 1, 1);
        let count = 0;
        while (true) {
            if (d.getDay() === weekday) { if (++count === n) return new Date(d); }
            d.setDate(d.getDate() + 1);
        }
    };

    const lastMonday = (month) => {
        const d = new Date(year, month, 0);
        while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
        return d;
    };

    addFixed(1,  1,  "New Year's Day");
    addFixed(6,  19, "Juneteenth");
    addFixed(7,  4,  "Independence Day");
    addFixed(11, 11, "Veterans Day");
    addFixed(12, 25, "Christmas Day");
    h[toISO(nthWeekday(1, 3, 1))]  = "Martin Luther King Jr. Day";
    h[toISO(nthWeekday(2, 3, 1))]  = "Presidents' Day";
    h[toISO(lastMonday(5))]         = "Memorial Day";
    h[toISO(nthWeekday(9, 1, 1))]  = "Labor Day";
    h[toISO(nthWeekday(11, 4, 4))] = "Thanksgiving Day";

    return h;
}

function holidaysForYear(year) {
    if (!holidayCache[year]) holidayCache[year] = computeHolidays(year);
    return holidayCache[year];
}

function getHolidayName(d) {
    const iso = toISO(d);
    if (JUDICIAL_YEARS.has(d.getFullYear())) return JUDICIAL_HOLIDAYS[iso] || null;
    return holidaysForYear(d.getFullYear())[iso] || null;
}

function isHolidayDate(d) {
    return !!getHolidayName(d);
}

// ── Pure date helpers ─────────────────────────────────────────────────────────

function today() {
    return toISO(new Date());
}

function toISO(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseLocal(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function addToDate(dateStr, years, months, days) {
    const d = parseLocal(dateStr);
    d.setFullYear(d.getFullYear() + (years  || 0));
    d.setMonth(d.getMonth()       + (months || 0));
    d.setDate(d.getDate()         + (days   || 0));
    return d;
}

function formatDate(d) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatCopy(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
}

function formatShort(d) {
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function daysFromToday(d) {
    const t = new Date(); const tod = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - tod) / 864e5);
}

function daysLabel(d) {
    const diff = daysFromToday(d);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff < 0)  return `${Math.abs(diff)} days ago`;
    return `In ${diff} days`;
}

function weekendNote(d) {
    const day = d.getDay();
    const fri = new Date(d); fri.setDate(fri.getDate() - (day === 0 ? 2 : 1));
    const mon = new Date(d); mon.setDate(mon.getDate() + (day === 0 ? 1 : 2));
    return `⚠️ Weekend — Fri ${formatShort(fri)} or Mon ${formatShort(mon)}`;
}

function isNonWorkday(d) {
    return d.getDay() === 0 || d.getDay() === 6 || isHolidayDate(d);
}

function countWorkdays(start, end) {
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
        if (!isNonWorkday(cur)) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function addWorkdays(dateStr, n) {
    const d = parseLocal(dateStr);
    if (n === 0) return d;
    const step = n > 0 ? 1 : -1;
    let remaining = Math.abs(n);
    while (remaining > 0) {
        d.setDate(d.getDate() + step);
        if (!isNonWorkday(d)) remaining--;
    }
    return d;
}

function ymd(start, end) {
    let years  = end.getFullYear() - start.getFullYear();
    let months = end.getMonth()    - start.getMonth();
    let days   = end.getDate()     - start.getDate();
    if (days < 0)   { months--; days += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
    if (months < 0) { years--;  months += 12; }
    return { years, months, days };
}

function isoWeek(d) {
    const tmp = new Date(d); tmp.setHours(0, 0, 0, 0);
    tmp.setDate(tmp.getDate() + 3 - (tmp.getDay() + 6) % 7);
    const jan4 = new Date(tmp.getFullYear(), 0, 4);
    return 1 + Math.round(((tmp - jan4) / 864e5 - 3 + (jan4.getDay() + 6) % 7) / 7);
}

function weekStart(d) {
    const tmp = new Date(d);
    tmp.setDate(tmp.getDate() - (tmp.getDay() === 0 ? 6 : tmp.getDay() - 1));
    return tmp;
}
