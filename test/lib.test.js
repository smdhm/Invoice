const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

function idGen() {
  let n = 0;
  return () => 'id' + ++n;
}

test('weekStart returns the Monday of the week', () => {
  assert.equal(L.weekStart('2026-10-22'), '2026-10-19'); // Thursday
  assert.equal(L.weekStart('2026-10-19'), '2026-10-19'); // Monday
  assert.equal(L.weekStart('2026-10-25'), '2026-10-19'); // Sunday
  assert.equal(L.weekStart('2026-01-01'), '2025-12-29'); // across a year
});

test('pendingWeeks includes the current week only from the check-in day', () => {
  // Thursday, check-in on Friday: current week not due yet.
  assert.deepEqual(L.pendingWeeks('2026-10-05', [], '2026-10-22', 4), ['2026-10-05', '2026-10-12']);
  // Friday: current week is due.
  assert.deepEqual(L.pendingWeeks('2026-10-05', ['2026-10-05'], '2026-10-23', 4), ['2026-10-12', '2026-10-19']);
  assert.deepEqual(L.pendingWeeks('2026-10-19', [], '2026-10-22', 4), []);
});

test('invoice totals round to cents and apply tax', () => {
  const inv = { taxRate: 10, items: [{ quantity: 1.5, rate: 33.33 }, { quantity: 1, rate: 0.1 }] };
  assert.deepEqual(L.invoiceTotals(inv), { subtotal: 50.1, tax: 5.01, total: 55.11 });
});

test('applyCheckin creates one draft invoice per client and numbers them', () => {
  const state = L.emptyState('2026-10-23');
  const makeId = idGen();
  L.applyCheckin(state, '2026-10-19', [
    { client: 'Acme', description: 'Site visit', date: '2026-10-20', quantity: 3, rate: 60 },
    { client: 'Globex', description: 'Logo', date: '2026-10-21', quantity: 1, rate: 400, unit: 'flat' },
    { client: 'acme ', description: 'Report', date: '2026-10-22', quantity: 2, rate: 60 },
    { client: '', description: 'ignored', quantity: 1, rate: 1 },
  ], '2026-10-23', makeId);

  assert.equal(state.clients.length, 2);
  assert.equal(state.jobs.length, 3);
  assert.equal(state.invoices.length, 2);
  const [acme, globex] = state.invoices;
  assert.equal(acme.number, 'INV-0001');
  assert.equal(globex.number, 'INV-0002');
  assert.equal(acme.items.length, 2);
  assert.equal(L.invoiceTotals(acme).total, 300);
  assert.equal(acme.dueDate, '2026-11-06');
  assert.equal(state.settings.nextInvoiceNumber, 3);
  assert.deepEqual(state.checkins, ['2026-10-19']);

  // A second check-in for the same week appends to the existing draft.
  L.applyCheckin(state, '2026-10-19', [{ client: 'Acme', description: 'Extra', quantity: 1, rate: 60 }], '2026-10-24', makeId);
  assert.equal(state.invoices.length, 2);
  assert.equal(acme.items.length, 3);

  // Once sent, new work goes on a new invoice.
  acme.status = 'sent';
  L.applyCheckin(state, '2026-10-19', [{ client: 'Acme', description: 'Late add', quantity: 1, rate: 60 }], '2026-10-24', makeId);
  assert.equal(state.invoices.length, 3);
  assert.equal(state.invoices[2].number, 'INV-0003');
});

test('a check-in with no jobs still marks the week done', () => {
  const state = L.emptyState('2026-10-23');
  L.applyCheckin(state, '2026-10-19', [], '2026-10-23', idGen());
  assert.deepEqual(state.checkins, ['2026-10-19']);
  assert.equal(state.invoices.length, 0);
});

test('invoiceStatus flags overdue sent invoices', () => {
  assert.equal(L.invoiceStatus({ status: 'sent', dueDate: '2026-10-01' }, '2026-10-22'), 'overdue');
  assert.equal(L.invoiceStatus({ status: 'sent', dueDate: '2026-10-22' }, '2026-10-22'), 'sent');
  assert.equal(L.invoiceStatus({ status: 'paid', dueDate: '2026-10-01' }, '2026-10-22'), 'paid');
});

test('deleteJob removes the line from a draft and drops empty invoices', () => {
  const state = L.emptyState('2026-10-23');
  L.applyCheckin(state, '2026-10-19', [
    { client: 'Acme', description: 'A', quantity: 1, rate: 10 },
    { client: 'Acme', description: 'B', quantity: 1, rate: 10 },
  ], '2026-10-23', idGen());
  const [a, b] = state.jobs;
  L.deleteJob(state, a.id);
  assert.equal(state.invoices[0].items.length, 1);
  L.deleteJob(state, b.id);
  assert.equal(state.invoices.length, 0);
});

test('summarize totals by status', () => {
  const state = L.emptyState('2026-10-23');
  const mk = idGen();
  L.applyCheckin(state, '2026-10-05', [{ client: 'A', description: 'x', quantity: 1, rate: 100 }], '2026-10-05', mk);
  L.applyCheckin(state, '2026-10-12', [{ client: 'A', description: 'y', quantity: 1, rate: 200 }], '2026-10-12', mk);
  L.applyCheckin(state, '2026-10-19', [{ client: 'A', description: 'z', quantity: 1, rate: 50 }], '2026-10-23', mk);
  state.invoices[0].status = 'paid';
  state.invoices[0].paidDate = '2026-10-10';
  state.invoices[1].status = 'sent';
  const s = L.summarize(state, '2026-10-30');
  assert.equal(s.paidThisYear, 100);
  assert.equal(s.outstanding, 200);
  assert.equal(s.overdue, 200);
  assert.equal(s.draft, 50);
});

test('invoicesCsv escapes values', () => {
  const state = L.emptyState('2026-10-23');
  L.applyCheckin(state, '2026-10-19', [{ client: 'Smith, "Jr"', description: 'x', quantity: 1, rate: 5 }], '2026-10-23', idGen());
  const csv = L.invoicesCsv(state, '2026-10-23');
  assert.match(csv, /INV-0001,"Smith, ""Jr""",2026-10-19/);
});

test('weeklyReminderIcs builds a weekly recurring event', () => {
  const ics = L.weeklyReminderIcs(4, '16:30', 'https://example.com/', '2026-10-24');
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=FR/);
  assert.match(ics, /DTSTART:20261030T163000/); // next Friday after Saturday the 24th
  assert.ok(ics.includes('\r\n'));
});

test('client billing overrides apply to new invoices', () => {
  const state = L.emptyState('2026-10-23');
  const makeId = idGen();
  const c = L.findOrCreateClient(state, 'Acme', makeId);
  Object.assign(c, { paymentTermsDays: 30, taxRate: 8, invoiceNotes: 'PO required' });
  L.applyCheckin(state, '2026-10-19', [
    { client: 'Acme', description: 'x', quantity: 1, rate: 100 },
    { client: 'Other', description: 'y', quantity: 1, rate: 100 },
  ], '2026-10-23', makeId);
  const [acme, other] = state.invoices;
  assert.equal(acme.dueDate, '2026-11-22');
  assert.equal(acme.taxRate, 8);
  assert.equal(acme.notes, 'PO required');
  assert.equal(other.dueDate, '2026-11-06');
  assert.equal(other.taxRate, 0);
  // Blank override (0 is a real value, '' / null fall back to settings).
  c.taxRate = 0;
  assert.equal(L.clientSetting(state, c, 'taxRate'), 0);
  c.paymentTermsDays = '';
  assert.equal(L.clientSetting(state, c, 'paymentTermsDays'), 14);
});
