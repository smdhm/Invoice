// UI for the weekly invoice tracker. Data lives in this browser's localStorage;
// use Settings → Back up to keep a copy elsewhere.
(function () {
  'use strict';

  const L = window.InvoiceLib;
  const STORAGE_KEY = 'weeklyInvoiceTracker.v1';
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const UNITS = ['hrs', 'days', 'flat', 'items'];

  let state = load();
  let tab = 'dashboard';
  let checkinQueue = [];

  // ---- Storage ----

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const fresh = L.emptyState(L.todayISO());
        return Object.assign(fresh, saved, {
          settings: Object.assign(fresh.settings, saved.settings),
          // Fill in billing fields added after the client was saved.
          clients: (saved.clients || []).map((c) => Object.assign(L.newClient(c.id, c.name), c)),
        });
      }
    } catch (e) {
      console.error('Could not load saved data', e);
    }
    return L.emptyState(L.todayISO());
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert('Could not save your data in this browser: ' + e.message);
    }
  }

  // ---- Helpers ----

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function money(n) {
    return L.formatMoney(n, state.settings.currency);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return L.parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function weekLabel(week) {
    return fmtDate(week) + ' – ' + fmtDate(L.addDays(week, 6));
  }

  function client(id) {
    return state.clients.find((c) => c.id === id) || { name: '(deleted client)', email: '', address: '' };
  }

  function pill(status) {
    return '<span class="pill ' + status + '">' + status + '</span>';
  }

  function pending() {
    return L.pendingWeeks(state.startWeek, state.checkins, L.todayISO(), Number(state.settings.checkinDay));
  }

  function download(filename, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function appUrl() {
    return location.protocol.startsWith('http') ? location.href.split('#')[0] : '';
  }

  // ---- Rendering ----

  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('client-names').innerHTML = state.clients.map((c) => '<option value="' + esc(c.name) + '">').join('');
    const views = { dashboard, invoices, jobs, clients, settings };
    document.getElementById('view').innerHTML = views[tab]();
    const n = pending().length;
    document.title = (n ? '(' + n + ') ' : '') + 'Weekly Invoices';
  }

  function invoiceRows(list) {
    if (!list.length) return '<p class="muted">No invoices yet.</p>';
    const today = L.todayISO();
    const rows = list.map((inv) => {
      const st = L.invoiceStatus(inv, today);
      const actions = ['<button class="small" data-action="view-invoice" data-id="' + inv.id + '">View</button>'];
      if (inv.status === 'draft') actions.push('<button class="small" data-action="mark-sent" data-id="' + inv.id + '">Mark sent</button>');
      if (inv.status === 'sent') actions.push('<button class="small" data-action="mark-paid" data-id="' + inv.id + '">Mark paid</button>');
      return '<tr>' +
        '<td>' + esc(inv.number) + '</td>' +
        '<td>' + esc(client(inv.clientId).name) + '</td>' +
        '<td>' + esc(weekLabel(inv.week)) + '</td>' +
        '<td>' + (inv.status === 'draft' ? '<span class="muted">—</span>' : esc(fmtDate(inv.dueDate))) + '</td>' +
        '<td>' + pill(st) + '</td>' +
        '<td class="num">' + money(L.invoiceTotals(inv).total) + '</td>' +
        '<td><div class="row-actions">' + actions.join('') + '</div></td>' +
        '</tr>';
    }).join('');
    return '<div class="table-wrap"><table><thead><tr><th>#</th><th>Client</th><th>Week</th><th>Due</th><th>Status</th><th class="num">Total</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function sortedInvoices() {
    return state.invoices.slice().sort((a, b) => (b.week + b.number).localeCompare(a.week + a.number));
  }

  function dashboard() {
    const today = L.todayISO();
    const p = pending();
    const sum = L.summarize(state, today);
    let html = '';

    if (!state.settings.businessName) {
      html += '<div class="card banner"><div><strong>Welcome!</strong> Add your business details so they appear on your invoices.</div>' +
        '<button class="primary" data-action="goto" data-tab="settings">Set up</button></div>';
    }

    if (p.length) {
      html += '<div class="card banner"><div><strong>Time for your weekly check-in.</strong> ' +
        (p.length === 1 ? 'What jobs did you work on the week of ' + esc(weekLabel(p[0])) + '?'
          : p.length + ' weeks need logging (oldest: ' + esc(weekLabel(p[0])) + ').') +
        '</div><button class="primary" data-action="start-checkin">Log my jobs</button></div>';
    } else {
      const next = L.addDays(L.weekStart(today), Number(state.settings.checkinDay) + (state.checkins.includes(L.weekStart(today)) ? 7 : 0));
      html += '<div class="card"><strong>You\'re all caught up.</strong> <span class="muted">Next check-in: ' +
        esc(DAYS[state.settings.checkinDay]) + ', ' + esc(fmtDate(next)) + '.</span> ' +
        '<button class="small" data-action="log-week">Log jobs for any week</button></div>';
    }

    html += '<div class="stats">' +
      stat('Drafts to send', money(sum.draft), sum.draftCount + ' invoice' + (sum.draftCount === 1 ? '' : 's')) +
      stat('Outstanding', money(sum.outstanding)) +
      stat('Overdue', money(sum.overdue), sum.overdueCount + ' invoice' + (sum.overdueCount === 1 ? '' : 's'), sum.overdue > 0 ? 'overdue' : '') +
      stat('Paid in ' + today.slice(0, 4), money(sum.paidThisYear)) +
      '</div>';

    const open = sortedInvoices().filter((i) => i.status !== 'paid');
    html += '<div class="card"><h3 style="margin-top:0">Open invoices</h3>' + invoiceRows(open) + '</div>';

    html += '<div class="card"><h3 style="margin-top:0">Weekly reminder</h3>' +
      '<p class="muted">The app asks you every ' + esc(DAYS[state.settings.checkinDay]) + ' when you open it. ' +
      'To get reminded even when it\'s closed, add the recurring event to your calendar.</p>' +
      '<div class="row-actions" style="justify-content:flex-start">' +
      '<button data-action="download-ics">Add weekly reminder to my calendar (.ics)</button>' +
      ('Notification' in window && Notification.permission !== 'granted'
        ? '<button data-action="enable-notifications">Enable browser notifications</button>' : '') +
      '</div></div>';
    return html;
  }

  function stat(label, value, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div>' +
      (sub ? '<div class="muted" style="font-size:13px">' + esc(sub) + '</div>' : '') + '</div>';
  }

  let invoiceFilter = { status: 'all', client: 'all' };

  function invoices() {
    const today = L.todayISO();
    const list = sortedInvoices().filter((inv) =>
      (invoiceFilter.status === 'all' || L.invoiceStatus(inv, today) === invoiceFilter.status) &&
      (invoiceFilter.client === 'all' || inv.clientId === invoiceFilter.client));
    const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    return '<h2>Invoices</h2><div class="filters">' +
      '<select data-filter="status">' + ['all', 'draft', 'sent', 'overdue', 'paid'].map((s) => opt(s, s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1), invoiceFilter.status)).join('') + '</select>' +
      '<select data-filter="client">' + opt('all', 'All clients', invoiceFilter.client) + state.clients.map((c) => opt(c.id, c.name, invoiceFilter.client)).join('') + '</select>' +
      '<button data-action="export-csv">Export CSV</button>' +
      '</div><div class="card">' + invoiceRows(list) + '</div>';
  }

  function jobs() {
    let html = '<h2>Jobs</h2><p><button class="primary" data-action="log-week">Log jobs for a week</button></p>';
    const weeks = [...new Set(state.jobs.map((j) => j.week).concat(state.checkins))].sort().reverse();
    if (!weeks.length) return html + '<p class="muted">No jobs logged yet.</p>';
    for (const w of weeks) {
      const list = state.jobs.filter((j) => j.week === w).sort((a, b) => a.date.localeCompare(b.date));
      html += '<div class="card"><h3 style="margin-top:0">Week of ' + esc(weekLabel(w)) + '</h3>';
      if (!list.length) { html += '<p class="muted">No work logged this week.</p></div>'; continue; }
      html += '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Job</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th>Invoice</th><th></th></tr></thead><tbody>' +
        list.map((j) => {
          const inv = state.invoices.find((i) => i.id === j.invoiceId);
          return '<tr><td>' + esc(fmtDate(j.date)) + '</td><td>' + esc(client(j.clientId).name) + '</td><td>' + esc(j.description) + '</td>' +
            '<td class="num">' + esc(j.quantity) + ' ' + esc(j.unit) + '</td><td class="num">' + money(j.rate) + '</td>' +
            '<td class="num">' + money(L.lineAmount(j)) + '</td>' +
            '<td>' + (inv ? '<button class="small" data-action="view-invoice" data-id="' + inv.id + '">' + esc(inv.number) + '</button>' : '<span class="muted">—</span>') + '</td>' +
            '<td>' + (!inv || inv.status === 'draft' ? '<button class="small danger" data-action="delete-job" data-id="' + j.id + '">Delete</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }
    return html;
  }

  function clients() {
    let html = '<h2>Clients</h2><p class="muted">Clients are added automatically when you log a job, or add one here. ' +
      'Fill in their billing info so invoices are ready to send. Blank rate, terms and tax use your Settings.</p>' +
      '<p><button class="primary" data-action="add-client">+ Add client</button></p>';
    if (!state.clients.length) return html + '<p class="muted">No clients yet.</p>';
    const s = state.settings;
    for (const c of state.clients.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const field = (name, label, attrs, placeholder) => '<label>' + label + '<input name="' + name + '" value="' +
        esc(c[name] == null ? '' : c[name]) + '"' + (placeholder != null ? ' placeholder="' + esc(placeholder) + '"' : '') + ' ' + (attrs || '') + '></label>';
      const invCount = state.invoices.filter((i) => i.clientId === c.id).length;
      html += '<form class="card" data-form="client" data-id="' + c.id + '">' +
        '<h3 style="margin-top:0">' + esc(c.name) + '</h3><div class="grid2">' +
        field('name', 'Client / company name', 'required') +
        field('contactName', 'Contact person') +
        '</div><h4>Billing info</h4><div class="grid2">' +
        field('email', 'Billing email', 'type="email"') +
        field('phone', 'Phone', 'type="tel"') +
        field('taxId', 'Tax ID / VAT / EIN') +
        field('reference', 'PO / reference number') +
        '</div><label>Billing address<textarea name="address">' + esc(c.address) + '</textarea></label>' +
        '<div class="grid2">' +
        field('rate', 'Rate', 'type="number" step="0.01" min="0"', s.defaultRate) +
        field('paymentTermsDays', 'Payment due (days)', 'type="number" min="0"', s.paymentTermsDays) +
        field('taxRate', 'Tax rate %', 'type="number" step="0.01" min="0"', s.taxRate) +
        '</div><label>Default note on their invoices<textarea name="invoiceNotes" placeholder="e.g. Please include the PO number with payment">' + esc(c.invoiceNotes) + '</textarea></label>' +
        '<div class="row-actions">' +
        (invCount ? '' : '<button type="button" class="danger" data-action="delete-client" data-id="' + c.id + '">Delete</button>') +
        '<button class="primary">Save</button></div></form>';
    }
    return html;
  }

  function settings() {
    const s = state.settings;
    const field = (name, label, attrs) => '<label>' + label + '<input name="' + name + '" value="' + esc(s[name]) + '" ' + (attrs || '') + '></label>';
    return '<h2>Settings</h2><form class="card" data-form="settings">' +
      '<h3 style="margin-top:0">Your business</h3><div class="grid2">' +
      field('businessName', 'Business / your name', 'required') +
      field('email', 'Email', 'type="email"') +
      '</div><label>Address, phone, tax ID (shown on invoices)<textarea name="businessDetails">' + esc(s.businessDetails) + '</textarea></label>' +
      '<label>Payment instructions (bank details, Venmo, etc.)<textarea name="paymentInstructions">' + esc(s.paymentInstructions) + '</textarea></label>' +
      '<h3>Invoicing</h3><div class="grid2">' +
      field('currency', 'Currency code (USD, EUR, GBP…)', 'maxlength="3"') +
      field('defaultRate', 'Default rate', 'type="number" step="0.01" min="0"') +
      field('taxRate', 'Tax rate %', 'type="number" step="0.01" min="0"') +
      field('paymentTermsDays', 'Payment due (days after sending)', 'type="number" min="0"') +
      field('invoicePrefix', 'Invoice number prefix') +
      field('nextInvoiceNumber', 'Next invoice number', 'type="number" min="1"') +
      '</div><h3>Weekly check-in</h3><div class="grid2">' +
      '<label>Ask me on<select name="checkinDay">' + DAYS.map((d, i) => '<option value="' + i + '"' + (i === Number(s.checkinDay) ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></label>' +
      field('reminderTime', 'Calendar reminder time', 'type="time"') +
      '</div><div class="row-actions"><button class="primary">Save settings</button></div></form>' +
      '<div class="card"><h3 style="margin-top:0">Your data</h3><p class="muted">Everything is stored in this browser only. Back up regularly, and restore the file to move to another device.</p>' +
      '<div class="row-actions" style="justify-content:flex-start">' +
      '<button data-action="backup">Back up (JSON)</button>' +
      '<button data-action="restore">Restore from backup…</button>' +
      '<button data-action="export-csv">Export invoices (CSV)</button>' +
      '<button class="danger" data-action="reset">Erase all data</button>' +
      '</div></div>';
  }

  // ---- Weekly check-in ----

  function defaultJobDate(week) {
    const today = L.todayISO();
    const end = L.addDays(week, 6);
    return today >= week && today <= end ? today : L.addDays(week, Math.min(Number(state.settings.checkinDay), 4));
  }

  function entryRow(week) {
    return '<div class="entry">' +
      '<label>Client<input name="client" list="client-names" placeholder="Client name"></label>' +
      '<label class="desc">What did you do?<input name="description" placeholder="e.g. Kitchen remodel – demo"></label>' +
      '<label>Date<input name="date" type="date" min="' + week + '" max="' + L.addDays(week, 6) + '" value="' + defaultJobDate(week) + '"></label>' +
      '<label>Qty<input name="quantity" type="number" step="0.25" min="0" value="1"></label>' +
      '<label>Unit<select name="unit">' + UNITS.map((u) => '<option>' + u + '</option>').join('') + '</select></label>' +
      '<label>Rate<input name="rate" type="number" step="0.01" min="0" placeholder="' + esc(state.settings.defaultRate) + '"></label>' +
      '<button type="button" class="small danger" data-action="remove-entry" title="Remove">✕</button>' +
      '</div>';
  }

  function openCheckin(week) {
    const form = document.getElementById('checkin-form');
    const queuePos = checkinQueue.indexOf(week);
    const already = state.checkins.includes(week);
    form.dataset.week = week;
    form.innerHTML =
      '<h2 style="margin-top:0">What jobs did you work on?</h2>' +
      '<p><strong>Week of ' + esc(weekLabel(week)) + '</strong>' +
      (checkinQueue.length > 1 && queuePos >= 0 ? ' <span class="muted">(' + (queuePos + 1) + ' of ' + checkinQueue.length + ' weeks to log)</span>' : '') +
      (already ? ' <span class="muted">— already logged; new jobs will be added to this week\'s draft invoices.</span>' : '') + '</p>' +
      '<label style="max-width:240px">Change week<input type="date" name="week-picker" value="' + week + '"></label>' +
      '<div id="entries">' + entryRow(week) + '</div>' +
      '<p><button type="button" data-action="add-entry">+ Add another job</button></p>' +
      '<p class="muted">Jobs are grouped by client into draft invoices. Review and send them from the Invoices tab.</p>' +
      '<div class="row-actions">' +
      '<button type="button" data-action="close-checkin">Later</button>' +
      '<button type="button" data-action="no-work">I didn\'t work this week</button>' +
      '<button type="submit" class="primary">Save &amp; create invoices</button>' +
      '</div>';
    const dlg = document.getElementById('checkin-dialog');
    if (!dlg.open) dlg.showModal();
    form.querySelector('input[name=client]').focus();
  }

  function readEntries(form) {
    return [...form.querySelectorAll('.entry')].map((row) => {
      const v = (n) => row.querySelector('[name=' + n + ']').value;
      const c = state.clients.find((x) => x.name.toLowerCase() === v('client').trim().toLowerCase());
      const fallbackRate = c && c.rate != null && c.rate !== '' ? c.rate : state.settings.defaultRate;
      return {
        client: v('client'),
        description: v('description'),
        date: v('date'),
        quantity: v('quantity'),
        unit: v('unit'),
        rate: v('rate') === '' ? fallbackRate : v('rate'),
      };
    }).filter((e) => e.client.trim() || e.description.trim());
  }

  function finishCheckin(week, entries) {
    const touched = L.applyCheckin(state, week, entries, L.todayISO(), makeId);
    save();
    checkinQueue = checkinQueue.filter((w) => w !== week);
    if (checkinQueue.length) {
      openCheckin(checkinQueue[0]);
    } else {
      document.getElementById('checkin-dialog').close();
      tab = touched.length ? 'invoices' : 'dashboard';
      invoiceFilter = { status: touched.length ? 'draft' : 'all', client: 'all' };
    }
    render();
  }

  // ---- Invoice document ----

  function invoiceHtml(inv) {
    const s = state.settings;
    const c = client(inv.clientId);
    const t = L.invoiceTotals(inv);
    const sorted = inv.items.slice().sort((a, b) => a.date.localeCompare(b.date));
    return '<article class="invoice">' +
      '<header><div><h2>INVOICE</h2><div><strong>' + esc(s.businessName || 'Your business') + '</strong></div>' +
      '<div class="pre">' + esc(s.businessDetails) + '</div>' + (s.email ? '<div>' + esc(s.email) + '</div>' : '') + '</div>' +
      '<table class="meta"><tr><td>Invoice #</td><td><strong>' + esc(inv.number) + '</strong></td></tr>' +
      '<tr><td>Date</td><td>' + esc(fmtDate(inv.issueDate)) + '</td></tr>' +
      '<tr><td>Due</td><td>' + esc(fmtDate(inv.dueDate)) + '</td></tr>' +
      '<tr><td>Period</td><td>' + esc(weekLabel(inv.week)) + '</td></tr></table></header>' +
      '<div style="margin-bottom:20px"><div class="muted">Bill to</div><strong>' + esc(c.name) + '</strong>' +
      (c.contactName ? '<div>Attn: ' + esc(c.contactName) + '</div>' : '') +
      '<div class="pre">' + esc(c.address) + '</div>' + (c.email ? '<div>' + esc(c.email) + '</div>' : '') +
      (c.phone ? '<div>' + esc(c.phone) + '</div>' : '') +
      (c.taxId ? '<div>Tax ID: ' + esc(c.taxId) + '</div>' : '') +
      (c.reference ? '<div>PO / Ref: ' + esc(c.reference) + '</div>' : '') + '</div>' +
      '<table><thead><tr><th>Date</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>' +
      sorted.map((it) => '<tr><td>' + esc(fmtDate(it.date)) + '</td><td>' + esc(it.description) + '</td>' +
        '<td class="num">' + esc(it.unit === 'flat' ? '' : it.quantity + ' ' + it.unit) + '</td>' +
        '<td class="num">' + money(Number(it.rate)) + '</td><td class="num">' + money(L.lineAmount(it)) + '</td></tr>').join('') +
      '</tbody></table>' +
      '<table class="totals"><tr><td>Subtotal</td><td class="num">' + money(t.subtotal) + '</td></tr>' +
      (inv.taxRate ? '<tr><td>Tax (' + esc(inv.taxRate) + '%)</td><td class="num">' + money(t.tax) + '</td></tr>' : '') +
      '<tr class="grand"><td>Total due</td><td class="num">' + money(t.total) + '</td></tr></table>' +
      '<footer>' + (inv.notes ? '<p class="pre">' + esc(inv.notes) + '</p>' : '') +
      (s.paymentInstructions ? '<p><strong>Payment</strong><br><span class="pre">' + esc(s.paymentInstructions) + '</span></p>' : '') +
      (inv.status === 'paid' ? '<p><strong>PAID ' + esc(fmtDate(inv.paidDate)) + '</strong> — thank you!</p>' : '<p>Thank you for your business!</p>') +
      '</footer></article>';
  }

  function openInvoice(id) {
    const inv = state.invoices.find((i) => i.id === id);
    if (!inv) return;
    const st = L.invoiceStatus(inv, L.todayISO());
    const actions = [pill(st), '<span style="flex:1"></span>'];
    if (inv.status === 'draft') actions.push('<button data-action="edit-notes" data-id="' + id + '">Add note</button>');
    actions.push('<button data-action="email-invoice" data-id="' + id + '">Email</button>');
    actions.push('<button data-action="print">Print / Save PDF</button>');
    if (inv.status === 'draft') actions.push('<button class="primary" data-action="mark-sent" data-id="' + id + '">Mark sent</button>');
    if (inv.status === 'sent') actions.push('<button class="primary" data-action="mark-paid" data-id="' + id + '">Mark paid</button>');
    if (inv.status !== 'draft') actions.push('<button data-action="mark-draft" data-id="' + id + '">Back to draft</button>');
    if (inv.status === 'draft') actions.push('<button class="danger" data-action="delete-invoice" data-id="' + id + '">Delete</button>');
    actions.push('<button data-action="close-invoice">Close</button>');
    document.getElementById('invoice-actions').innerHTML = actions.join('');
    document.getElementById('print-area').innerHTML = invoiceHtml(inv);
    const dlg = document.getElementById('invoice-dialog');
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
  }

  function refreshInvoice() {
    const dlg = document.getElementById('invoice-dialog');
    if (dlg.open) {
      if (state.invoices.some((i) => i.id === dlg.dataset.id)) openInvoice(dlg.dataset.id);
      else dlg.close();
    }
  }

  function emailInvoice(inv) {
    const s = state.settings;
    const c = client(inv.clientId);
    const t = L.invoiceTotals(inv);
    const lines = inv.items.map((it) => '- ' + fmtDate(it.date) + ': ' + it.description + ' — ' + money(L.lineAmount(it)));
    const body = 'Hi ' + (c.contactName || c.name) + ',\n\nPlease find invoice ' + inv.number + ' for the week of ' + weekLabel(inv.week) +
      (c.reference ? ' (PO / Ref: ' + c.reference + ')' : '') + '.\n\n' +
      lines.join('\n') + '\n\nTotal due: ' + money(t.total) + ' by ' + fmtDate(inv.dueDate) + '.\n' +
      (s.paymentInstructions ? '\nPayment details:\n' + s.paymentInstructions + '\n' : '') +
      '\nThanks,\n' + (s.businessName || '');
    location.href = 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent('Invoice ' + inv.number + (s.businessName ? ' from ' + s.businessName : '')) +
      '&body=' + encodeURIComponent(body);
  }

  // ---- Reminders ----

  function notifyIfDue() {
    const p = pending();
    if (!p.length || !('Notification' in window) || Notification.permission !== 'granted') return;
    const key = 'weeklyInvoiceTracker.notified';
    let last = null;
    try { last = localStorage.getItem(key); } catch (e) { /* ignore */ }
    if (last === L.todayISO()) return;
    try { localStorage.setItem(key, L.todayISO()); } catch (e) { /* ignore */ }
    const n = new Notification('Weekly check-in', { body: 'What jobs did you work on the week of ' + weekLabel(p[p.length - 1]) + '?' });
    n.onclick = () => { window.focus(); startCheckin(); };
  }

  function startCheckin() {
    checkinQueue = pending();
    openCheckin(checkinQueue[0] || L.weekStart(L.todayISO()));
  }

  // ---- Events ----

  const actions = {
    goto: (el) => { tab = el.dataset.tab; render(); },
    'start-checkin': startCheckin,
    'log-week': () => { checkinQueue = []; openCheckin(L.weekStart(L.todayISO())); },
    'add-entry': () => {
      const form = document.getElementById('checkin-form');
      form.querySelector('#entries').insertAdjacentHTML('beforeend', entryRow(form.dataset.week));
      const rows = form.querySelectorAll('.entry');
      rows[rows.length - 1].querySelector('input').focus();
    },
    'remove-entry': (el) => {
      const entries = el.closest('#entries');
      if (entries.children.length > 1) el.closest('.entry').remove();
      else el.closest('.entry').querySelectorAll('input[name=client], input[name=description], input[name=rate]').forEach((i) => { i.value = ''; });
    },
    'close-checkin': () => document.getElementById('checkin-dialog').close(),
    'no-work': () => finishCheckin(document.getElementById('checkin-form').dataset.week, []),
    'view-invoice': (el) => openInvoice(el.dataset.id),
    'close-invoice': () => document.getElementById('invoice-dialog').close(),
    'mark-sent': (el) => {
      const inv = state.invoices.find((i) => i.id === el.dataset.id);
      const today = L.todayISO();
      inv.status = 'sent';
      inv.sentDate = today;
      inv.issueDate = today;
      inv.dueDate = L.addDays(today, L.clientSetting(state, client(inv.clientId), 'paymentTermsDays'));
      save(); render(); refreshInvoice();
    },
    'mark-paid': (el) => {
      const inv = state.invoices.find((i) => i.id === el.dataset.id);
      inv.status = 'paid';
      inv.paidDate = L.todayISO();
      save(); render(); refreshInvoice();
    },
    'mark-draft': (el) => {
      const inv = state.invoices.find((i) => i.id === el.dataset.id);
      inv.status = 'draft';
      inv.sentDate = null;
      inv.paidDate = null;
      save(); render(); refreshInvoice();
    },
    'delete-invoice': (el) => {
      if (!confirm('Delete this draft invoice? Its jobs stay in your log.')) return;
      L.deleteInvoice(state, el.dataset.id);
      save(); render(); refreshInvoice();
    },
    'edit-notes': (el) => {
      const inv = state.invoices.find((i) => i.id === el.dataset.id);
      const notes = prompt('Note to show on this invoice:', inv.notes || '');
      if (notes === null) return;
      inv.notes = notes;
      save(); refreshInvoice();
    },
    'email-invoice': (el) => emailInvoice(state.invoices.find((i) => i.id === el.dataset.id)),
    print: () => window.print(),
    'add-client': () => {
      const name = prompt('Client / company name:');
      if (!name || !name.trim()) return;
      L.findOrCreateClient(state, name, makeId);
      save(); render();
    },
    'delete-client': (el) => {
      if (!confirm('Delete this client?')) return;
      state.clients = state.clients.filter((c) => c.id !== el.dataset.id);
      state.jobs = state.jobs.filter((j) => j.clientId !== el.dataset.id || j.invoiceId);
      save(); render();
    },
    'delete-job': (el) => {
      if (!confirm('Delete this job?')) return;
      L.deleteJob(state, el.dataset.id);
      save(); render();
    },
    'download-ics': () => download('weekly-invoice-checkin.ics',
      L.weeklyReminderIcs(Number(state.settings.checkinDay), state.settings.reminderTime, appUrl(), L.todayISO()), 'text/calendar'),
    'enable-notifications': () => Notification.requestPermission().then(() => { render(); notifyIfDue(); }),
    'export-csv': () => download('invoices-' + L.todayISO() + '.csv', L.invoicesCsv(state, L.todayISO()), 'text/csv'),
    backup: () => download('invoice-tracker-backup-' + L.todayISO() + '.json', JSON.stringify(state, null, 2), 'application/json'),
    restore: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        file.text().then((text) => {
          const data = JSON.parse(text);
          if (!data || !Array.isArray(data.invoices) || !data.settings) throw new Error('Not a backup file');
          if (!confirm('Replace all current data with this backup?')) return;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          state = load();
          render();
        }).catch((e) => alert('Could not restore: ' + e.message));
      };
      input.click();
    },
    reset: () => {
      if (!confirm('Erase ALL clients, jobs and invoices from this browser? This cannot be undone.')) return;
      state = L.emptyState(L.todayISO());
      save(); tab = 'dashboard'; render();
    },
  };

  document.addEventListener('click', (ev) => {
    const tabBtn = ev.target.closest('#tabs button');
    if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }
    const el = ev.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) { ev.preventDefault(); actions[el.dataset.action](el); }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.filter) { invoiceFilter[t.dataset.filter] = t.value; render(); return; }
    if (t.name === 'week-picker' && t.value) {
      checkinQueue = [];
      openCheckin(L.weekStart(t.value));
      return;
    }
    if (t.name === 'unit' && t.value === 'flat') {
      t.closest('.entry').querySelector('input[name=quantity]').value = 1;
    }
    if (t.name === 'client') {
      const c = state.clients.find((x) => x.name.toLowerCase() === t.value.trim().toLowerCase());
      const rate = t.closest('.entry').querySelector('input[name=rate]');
      if (c && c.rate != null && c.rate !== '' && !rate.value) rate.value = c.rate;
    }
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    ev.preventDefault();
    if (form.id === 'checkin-form') {
      const entries = readEntries(form);
      const missing = entries.find((e) => !e.client.trim() || !e.description.trim());
      if (missing) { alert('Each job needs a client and a description.'); return; }
      if (!entries.length) { alert('Add at least one job, or choose "I didn\'t work this week".'); return; }
      finishCheckin(form.dataset.week, entries);
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'settings') {
      const numeric = ['defaultRate', 'taxRate', 'paymentTermsDays', 'nextInvoiceNumber', 'checkinDay'];
      for (const k of numeric) data[k] = Number(data[k]) || 0;
      data.nextInvoiceNumber = Math.max(1, data.nextInvoiceNumber);
      data.currency = (data.currency || 'USD').toUpperCase();
      Object.assign(state.settings, data);
      save(); tab = 'dashboard'; render();
    } else if (form.dataset.form === 'client') {
      const c = state.clients.find((x) => x.id === form.dataset.id);
      for (const k of ['contactName', 'email', 'phone', 'taxId', 'reference']) c[k] = data[k].trim();
      for (const k of ['rate', 'paymentTermsDays', 'taxRate']) c[k] = data[k] === '' ? null : Number(data[k]);
      const previousNotes = c.invoiceNotes;
      c.name = data.name.trim() || c.name;
      c.address = data.address;
      c.invoiceNotes = data.invoiceNotes;
      // Keep unsent drafts in step with the client's tax rate and note.
      for (const inv of state.invoices) {
        if (inv.clientId !== c.id || inv.status !== 'draft') continue;
        inv.taxRate = L.clientSetting(state, c, 'taxRate');
        if (!inv.notes || inv.notes === previousNotes) inv.notes = c.invoiceNotes;
      }
      save(); render();
    }
  });

  // ---- Start ----

  render();
  if (pending().length && state.settings.businessName) startCheckin();
  notifyIfDue();
  // Re-check hourly for tabs left open (only re-render the dashboard so we
  // never wipe a form you're in the middle of editing).
  setInterval(() => { if (tab === 'dashboard') render(); notifyIfDue(); }, 60 * 60 * 1000);
})();
