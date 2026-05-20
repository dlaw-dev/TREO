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

export default class DateCalculator extends LightningElement {
    // Add Days
    @track startDate = today();
    @track addYears  = 0;
    @track addMonths = 0;
    @track addDays   = 0;
    @track copyLabel = 'Copy';

    // Count Days
    @track countStart = today();
    @track countEnd   = '';

    // Workdays
    @track wdStart = today();
    @track wdEnd   = '';

    // Add Workdays
    @track awStart = today();
    @track awDays  = 0;

    // Weekday
    @track weekdayDate = today();

    // Week №
    @track weekNumDate = today();

    // ── Add Days ─────────────────────────────────────────────────────────────

    get deadlineRows() {
        if (!this.startDate) return [];
        return PRESETS.map(p => {
            const d = addToDate(this.startDate, p.years, p.months, p.days);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return {
                label:       p.label,
                wkKey:       p.label + '-wk',
                dateStr:     formatDate(d),
                dow:         DAYS[d.getDay()],
                daysLabel:   daysLabel(d),
                isWeekend,
                weekendNote: isWeekend ? weekendNote(d) : '',
                rowClass:    isWeekend ? 'deadline-row weekend-row' : 'deadline-row',
            };
        });
    }

    get customResult() {
        if (!this.startDate || (!this.addYears && !this.addMonths && !this.addDays)) return null;
        const d = addToDate(this.startDate, this.addYears, this.addMonths, this.addDays);
        if (!d) return null;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        return {
            dateStr: formatDate(d), dow: DAYS[d.getDay()],
            daysLabel: daysLabel(d), isWeekend,
            weekendNote: isWeekend ? weekendNote(d) : '',
        };
    }

    handleStartDate(e) { this.startDate = e.detail.value; }
    handleYears(e)     { this.addYears  = parseInt(e.detail.value, 10) || 0; }
    handleMonths(e)    { this.addMonths = parseInt(e.detail.value, 10) || 0; }
    handleDays(e)      { this.addDays   = parseInt(e.detail.value, 10) || 0; }

    handleCopy() {
        const r = this.customResult;
        if (!r) return;
        navigator.clipboard.writeText(`${r.dateStr} (${r.dow})`).then(() => {
            this.copyLabel = 'Copied!';
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this.copyLabel = 'Copy'; }, 2000);
        });
    }

    handleRowCopy(e) {
        navigator.clipboard.writeText(e.currentTarget.dataset.text);
    }

    // ── Count Days ───────────────────────────────────────────────────────────

    get countResult() {
        if (!this.countStart || !this.countEnd) return null;
        const start = parseLocal(this.countStart);
        const end   = parseLocal(this.countEnd);
        if (end < start) return null;
        const totalDays = Math.round((end - start) / 864e5);
        const weeks = Math.floor(totalDays / 7);
        const remDays = totalDays % 7;
        const { years, months, days } = ymd(start, end);
        return {
            totalDays,
            weeksLine:  `${weeks} week${weeks !== 1 ? 's' : ''}, ${remDays} day${remDays !== 1 ? 's' : ''}`,
            monthsLine: `${years * 12 + months} month${(years * 12 + months) !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''}`,
            yearsLine:  years > 0 ? `${years} year${years !== 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''}` : '',
        };
    }

    handleCountStart(e) { this.countStart = e.detail.value; }
    handleCountEnd(e)   { this.countEnd   = e.detail.value; }

    // ── Workdays ─────────────────────────────────────────────────────────────

    get workdayResult() {
        if (!this.wdStart || !this.wdEnd) return null;
        const start = parseLocal(this.wdStart);
        const end   = parseLocal(this.wdEnd);
        if (end < start) return null;
        const calendarDays = Math.round((end - start) / 864e5);
        const workdays     = countWorkdays(start, end);
        return { workdays, calendarDays };
    }

    handleWdStart(e) { this.wdStart = e.detail.value; }
    handleWdEnd(e)   { this.wdEnd   = e.detail.value; }

    // ── Add Workdays ─────────────────────────────────────────────────────────

    get addWorkdaysResult() {
        if (!this.awStart || !this.awDays) return null;
        const d = addWorkdays(this.awStart, this.awDays);
        if (!d) return null;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        return {
            dateStr: formatDate(d), dow: DAYS[d.getDay()],
            daysLabel: daysLabel(d), isWeekend,
            weekendNote: isWeekend ? weekendNote(d) : '',
        };
    }

    handleAwStart(e) { this.awStart = e.detail.value; }
    handleAwDays(e)  { this.awDays  = parseInt(e.detail.value, 10) || 0; }

    // ── Weekday ──────────────────────────────────────────────────────────────

    get weekdayResult() {
        if (!this.weekdayDate) return null;
        const d = parseLocal(this.weekdayDate);
        return { dow: DAYS[d.getDay()], dateStr: formatDate(d), daysLabel: daysLabel(d) };
    }

    handleWeekdayDate(e) { this.weekdayDate = e.detail.value; }

    // ── Week № ───────────────────────────────────────────────────────────────

    get weekNumResult() {
        if (!this.weekNumDate) return null;
        const d   = parseLocal(this.weekNumDate);
        const num = isoWeek(d);
        const mon = weekStart(d);
        const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
        return {
            weekNum: num,
            year:    d.getFullYear(),
            range:   `${formatDate(mon)} – ${formatDate(sun)}`,
        };
    }

    handleWeekNumDate(e) { this.weekNumDate = e.detail.value; }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function today() {
    const d = new Date();
    return toISO(d);
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

function formatShort(d) {
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function daysFromToday(d) {
    const t = new Date(); const tod = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const tgt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((tgt - tod) / 864e5);
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

function ymd(start, end) {
    let years  = end.getFullYear() - start.getFullYear();
    let months = end.getMonth()    - start.getMonth();
    let days   = end.getDate()     - start.getDate();
    if (days < 0)   { months--; days += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
    if (months < 0) { years--;  months += 12; }
    return { years, months, days };
}

function countWorkdays(start, end) {
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
        const day = cur.getDay();
        if (day !== 0 && day !== 6) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function addWorkdays(dateStr, n) {
    const d = parseLocal(dateStr);
    let added = 0;
    while (added < n) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) added++;
    }
    return d;
}

function isoWeek(d) {
    const tmp = new Date(d); tmp.setHours(0, 0, 0, 0);
    tmp.setDate(tmp.getDate() + 3 - (tmp.getDay() + 6) % 7);
    const jan4 = new Date(tmp.getFullYear(), 0, 4);
    return 1 + Math.round(((tmp - jan4) / 864e5 - 3 + (jan4.getDay() + 6) % 7) / 7);
}

function weekStart(d) {
    const tmp = new Date(d);
    const day = tmp.getDay();
    tmp.setDate(tmp.getDate() - (day === 0 ? 6 : day - 1));
    return tmp;
}
