// Pure logic for the invoice tracker. No DOM access here so it can be
// unit-tested with `node --test` and loaded in the browser as a classic script.
(function (root) {
  'use strict';

  // ---- Dates (all dates are local "YYYY-MM-DD" strings) ----

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseISODate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function addDays(iso, n) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  // Day of week with Monday = 0 ... Sunday = 6.
  function weekday(iso) {
    return (parseISODate(iso).getDay() + 6) % 7;
  }

  // Monday of the week containing `iso`.
  function weekStart(iso) {
    return addDays(iso, -weekday(iso));
  }

  // Weeks (by Monday) that still need a check-in. The current week becomes due
  // once `checkinDay` (Monday = 0) is reached; earlier weeks are always due.
  function pendingWeeks(startWeek, checkedIn, today, checkinDay) {
    const done = new Set(checkedIn);
    const current = weekStart(today);
    const last = weekday(today) >= checkinDay ? current : addDays(current, -7);
    const out = [];
    for (let w = weekStart(startWeek); w <= last; w = addDays(w, 7)) {
      if (!done.has(w)) out.push(w);
    }
    return out;
  }

  // ---- Money ----

  function round2(x) {
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  function lineAmount(item) {
    return round2((Number(item.quantity) || 0) * (Number(item.rate) || 0));
  }

  function invoiceTotals(inv) {
    const subtotal = round2(inv.items.reduce((sum, it) => sum + lineAmount(it), 0));
    const tax = round2(subtotal * (Number(inv.taxRate) || 0) / 100);
    return { subtotal, tax, total: round2(subtotal + tax) };
  }

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
    } catch (e) {
      return (currency || '') + ' ' + amount.toFixed(2);
    }
  }

  // ---- Invoices ----

  function formatInvoiceNumber(prefix, n) {
    return (prefix || '') + String(n).padStart(4, '0');
  }

  // Effective status: a sent invoice past its due date is "overdue".
  function invoiceStatus(inv, today) {
    if (inv.status === 'sent' && inv.dueDate < today) return 'overdue';
    return inv.status;
  }

  function emptyState(today) {
    return {
      version: 1,
      settings: {
        businessName: '',
        businessDetails: '',
        email: '',
        currency: 'USD',
        defaultRate: 50,
        taxRate: 0,
        paymentTermsDays: 14,
        invoicePrefix: 'INV-',
        nextInvoiceNumber: 1,
        checkinDay: 4, // Friday
        reminderTime: '16:00',
        paymentInstructions: '',
      },
      startWeek: weekStart(today),
      checkins: [],
      clients: [],
      jobs: [],
      invoices: [],
    };
  }

  // Billing fields a client can have. Numeric overrides are null when the
  // client should use the business-wide setting.
  function newClient(id, name) {
    return {
      id,
      name,
      contactName: '',
      email: '',
      phone: '',
      address: '',
      taxId: '',
      reference: '', // PO / reference number shown on invoices
      rate: null,
      paymentTermsDays: null,
      taxRate: null,
      invoiceNotes: '',
    };
  }

  function findOrCreateClient(state, name, makeId) {
    const trimmed = name.trim();
    let client = state.clients.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (!client) {
      client = newClient(makeId(), trimmed);
      state.clients.push(client);
    }
    return client;
  }

  function hasValue(v) {
    return v != null && v !== '';
  }

  // Client override if set, otherwise the business-wide setting.
  function clientSetting(state, client, key) {
    const v = client && client[key];
    return Number(hasValue(v) ? v : state.settings[key]) || 0;
  }

  // Record the jobs worked during `week` and add them to that week's draft
  // invoice for each client (creating the invoice if needed). Mutates and
  // returns `state`. Each entry: { client, description, date, quantity, rate, unit }.
  function applyCheckin(state, week, entries, today, makeId) {
    const s = state.settings;
    const touched = [];
    for (const e of entries) {
      if (!e.client || !e.client.trim() || !e.description || !e.description.trim()) continue;
      const client = findOrCreateClient(state, e.client, makeId);
      const job = {
        id: makeId(),
        week,
        clientId: client.id,
        date: e.date || week,
        description: e.description.trim(),
        quantity: Number(e.quantity) || 0,
        unit: e.unit || 'hrs',
        rate: Number(e.rate) || 0,
        invoiceId: null,
      };

      let inv = state.invoices.find(
        (i) => i.clientId === client.id && i.week === week && i.status === 'draft'
      );
      if (!inv) {
        inv = {
          id: makeId(),
          number: formatInvoiceNumber(s.invoicePrefix, s.nextInvoiceNumber),
          clientId: client.id,
          week,
          issueDate: today,
          dueDate: addDays(today, clientSetting(state, client, 'paymentTermsDays')),
          taxRate: clientSetting(state, client, 'taxRate'),
          status: 'draft',
          sentDate: null,
          paidDate: null,
          notes: client.invoiceNotes || '',
          items: [],
        };
        s.nextInvoiceNumber += 1;
        state.invoices.push(inv);
      }
      inv.items.push({
        jobId: job.id,
        date: job.date,
        description: job.description,
        quantity: job.quantity,
        unit: job.unit,
        rate: job.rate,
      });
      job.invoiceId = inv.id;
      state.jobs.push(job);
      if (!touched.includes(inv)) touched.push(inv);
    }
    if (!state.checkins.includes(week)) state.checkins.push(week);
    return touched;
  }

  // Remove a job; if it sits on a draft invoice, drop the line too (and the
  // invoice if it becomes empty). Jobs on sent/paid invoices stay on them.
  function deleteJob(state, jobId) {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    state.jobs = state.jobs.filter((j) => j.id !== jobId);
    const inv = state.invoices.find((i) => i.id === job.invoiceId);
    if (inv && inv.status === 'draft') {
      inv.items = inv.items.filter((it) => it.jobId !== jobId);
      if (inv.items.length === 0) state.invoices = state.invoices.filter((i) => i !== inv);
    }
  }

  function deleteInvoice(state, invoiceId) {
    state.invoices = state.invoices.filter((i) => i.id !== invoiceId);
    for (const j of state.jobs) if (j.invoiceId === invoiceId) j.invoiceId = null;
  }

  function summarize(state, today) {
    const year = today.slice(0, 4);
    const sum = { draft: 0, outstanding: 0, overdue: 0, paidThisYear: 0, overdueCount: 0, draftCount: 0 };
    for (const inv of state.invoices) {
      const { total } = invoiceTotals(inv);
      const st = invoiceStatus(inv, today);
      if (st === 'draft') { sum.draft += total; sum.draftCount += 1; }
      if (st === 'sent' || st === 'overdue') sum.outstanding += total;
      if (st === 'overdue') { sum.overdue += total; sum.overdueCount += 1; }
      if (st === 'paid' && (inv.paidDate || '').slice(0, 4) === year) sum.paidThisYear += total;
    }
    for (const k of ['draft', 'outstanding', 'overdue', 'paidThisYear']) sum[k] = round2(sum[k]);
    return sum;
  }

  // ---- Exports ----

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function invoicesCsv(state, today) {
    const byId = Object.fromEntries(state.clients.map((c) => [c.id, c]));
    const rows = [['Number', 'Client', 'Week of', 'Issue date', 'Due date', 'Status', 'Subtotal', 'Tax', 'Total', 'Sent', 'Paid']];
    for (const inv of state.invoices) {
      const t = invoiceTotals(inv);
      rows.push([
        inv.number, (byId[inv.clientId] || {}).name, inv.week, inv.issueDate, inv.dueDate,
        invoiceStatus(inv, today), t.subtotal.toFixed(2), t.tax.toFixed(2), t.total.toFixed(2),
        inv.sentDate || '', inv.paidDate || '',
      ]);
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  }

  const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

  // A weekly recurring calendar event so your calendar app reminds you to
  // check in even when the tracker isn't open.
  function weeklyReminderIcs(checkinDay, time, appUrl, today) {
    const [hh, mm] = (time || '16:00').split(':');
    let first = addDays(weekStart(today), checkinDay);
    if (first < today) first = addDays(first, 7);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const desc = 'What jobs did you work on this week? Log them and your invoices will be created automatically.' +
      (appUrl ? '\\n' + appUrl : '');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Weekly Invoice Tracker//EN',
      'BEGIN:VEVENT',
      'UID:weekly-checkin@weekly-invoice-tracker',
      'DTSTAMP:' + stamp,
      'DTSTART:' + first.replace(/-/g, '') + 'T' + pad(hh) + pad(mm) + '00',
      'DURATION:PT15M',
      'RRULE:FREQ=WEEKLY;BYDAY=' + ICS_DAYS[checkinDay],
      'SUMMARY:Weekly check-in: log jobs & send invoices',
      'DESCRIPTION:' + desc,
      appUrl ? 'URL:' + appUrl : null,
      'BEGIN:VALARM',
      'TRIGGER:PT0M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Log this week\'s jobs',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n') + '\r\n';
  }

  const api = {
    toISODate, parseISODate, todayISO, addDays, weekday, weekStart, pendingWeeks,
    round2, lineAmount, invoiceTotals, formatMoney,
    formatInvoiceNumber, invoiceStatus, emptyState, newClient, findOrCreateClient, clientSetting,
    applyCheckin, deleteJob, deleteInvoice, summarize,
    invoicesCsv, weeklyReminderIcs,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
