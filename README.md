# Weekly Invoice Tracker

A small app that asks you every week what jobs you worked on, then
automatically creates your invoices and tracks whether they're sent, paid or
overdue.

No accounts, servers or installs. It's a plain web page, and your data stays
in your browser.

## How to use it

1. **Open the app.** Double-click `index.html`, or serve the folder (`npm start`, then
   go to http://localhost:8000). You can also host it for free with GitHub Pages
   (Settings → Pages → deploy from this branch) and open it on your phone.
2. **Fill in Settings:** your business name, contact details, payment instructions,
   default rate, tax rate, payment terms, and the day you want to be asked (Friday by default).
3. **Every week the app asks:** *"What jobs did you work on?"* When the check-in
   day comes round, it opens the check-in by itself. If you missed some weeks, it
   asks about each one in turn, starting with the oldest.
   - Add each job: client, what you did, date, quantity (hours/days/flat/items) and rate.
   - New clients are created automatically, and their saved rate fills in next time.
   - On the **Clients** tab, fill in each client's billing info: contact person, billing email,
     phone, address, tax ID, PO/reference number, and their own rate, payment terms, tax rate
     and default invoice note. Anything left blank uses your Settings.
   - If you didn't work that week, choose **"I didn't work this week"**.
4. **Invoices are created for you.** You get one draft invoice per client per week,
   numbered in order (`INV-0001`, `INV-0002`, …).
5. **Send and track:** open an invoice, then **Print / Save PDF** or **Email** it
   (this opens your mail app with a summary). Then click **Mark sent**, and **Mark paid**
   when the money arrives. Sent invoices past their due date show as **overdue**.

The dashboard shows drafts waiting to be sent, what's outstanding, what's overdue
and what you've been paid this year.

## Weekly reminders when the app is closed

On the dashboard:

- **Add weekly reminder to my calendar (.ics)** downloads a repeating calendar
  event for your check-in day and time. Open it to add it to Google Calendar,
  Apple Calendar or Outlook. If the app is hosted, the event includes a link to it.
- **Enable browser notifications** shows a notification when a check-in is due
  while the app is open in a tab.

## Your data

Everything is saved in your browser's local storage. That means:

- Use the same browser and device, or use **Settings → Back up** and **Restore**
  to move your data between them.
- Back up regularly, because clearing your browser data erases it.
- **Export invoices (CSV)** gives you a spreadsheet for taxes or accounting.

## Development

- `lib.js` holds the logic (weeks, check-ins, invoice totals, CSV/ICS). It has no DOM code.
- `app.js` holds the user interface.
- `npm test` runs the unit tests (needs Node 18+).
