# SalonBook — Salon Booking & Billing

A clean, single-page web app for salons, spas, and barbershops: appointment
bookings plus service billing in one place. No build step, no account, no
server — open `index.html` directly or host it on GitHub Pages, and all data
stays in the browser (localStorage).

## What it does

- **Service menu** — add services with duration and price, and choose which
  staff members offer each one (leave all staff ticked and the service is
  offered by everyone). Ships with 6 starter services and 3 staff members.
- **Appointment calendar** — book a slot per staff member with date, start
  time, service, customer, phone, and notes. The day view filters by date and
  staff. Double-bookings are refused: if a new booking overlaps an existing
  one for the same staff member on the same day, the app names the clashing
  booking instead of silently overwriting it. Back-to-back bookings (one ends
  exactly when the next starts) are allowed.
- **Walk-in billing** — pick services from the menu, add products sold
  (name + price), set discount % and GST % (default 18%, changeable in
  settings), choose Cash / UPI / Card, and save a numbered bill
  (`SB-0001`, `SB-0002`, …). Bills are printable via the browser's print
  dialog (Print / Save as PDF) — only the bill itself prints, not the app.
  Billing an appointment from its row pre-fills the customer and service,
  and saving that bill marks the appointment Completed.
- **Customer history** — past visits and total spent per customer, grouped
  by phone number when one is given, otherwise by name. "Total spent" counts
  saved bills only, so a booked-but-unbilled visit never inflates revenue.
- **Dashboard** — today's appointment count, today's revenue, customer and
  service counts, staff-wise bookings for today (with completed counts),
  today's appointment list, and recent bills. Salon name and default GST %
  are editable in settings.

## How to run

No installation needed:

1. Download or clone this repo.
2. Open `index.html` in any modern browser.
3. That's it. Data is saved automatically in the browser's localStorage
   under the key `salonbook-v1`.

To host it: enable GitHub Pages for this repo (Settings → Pages → Deploy
from branch `main`, root folder) — there is no build step to configure.

To run the tests (optional, needs Node.js, no dependencies):

```bash
node test_salonbook.js
```

## Files

- `index.html` — all five screens (Dashboard, Services & Staff,
  Appointments, Billing, Customers) and the print-only bill view.
- `styles.css` — plain CSS, warm salon theme, mobile-friendly, plus a
  `@media print` rule that prints only the bill.
- `app.js` — all logic. The pure functions (slot-conflict detection, bill
  maths, customer grouping) are DOM-free and exported for Node tests;
  the browser UI code is guarded so the same file can be required by tests.
- `test_salonbook.js` — 15 Node assertions covering overlap rules, bill
  maths, bill numbering, staff filtering, and customer stats.

## Deliberately not built

- **No AI angle.** Billing and booking math must be deterministic and
  auditable — a wrong slot or a wrong total is worse than a missing
  "smart" feature. (An AI appointment-reminder message generator would be a
  natural later addition; it is not here.)
- **No multi-device sync or accounts.** Data lives in one browser. A salon
  that needs two chairs on two devices sharing bookings would need a small
  backend — that is the honest next step, not a localStorage hack.
- **No editing of past bills.** Bills are records, not drafts; if a bill is
  wrong, the salon re-issues a new one. This keeps revenue totals
  trustworthy.
- **No SMS reminders or online payments.** Both need a backend and real
  credentials; this app is fully offline by design.

## Trade-offs and limitations

- **localStorage limits:** roughly 5 MB per origin — plenty for a small
  salon's bookings and bills, but not a multi-year archive. There is no
  export yet; clearing browser data deletes everything (back up by keeping
  printed/PDF bills).
- **Money is stored as decimal-rounded floats** (`Math.round` to paise at
  each step). For salon-sized totals this is exact in practice, but a
  high-volume shop should switch to integer-paise arithmetic.
- **One browser = one salon book.** Two staff members on different devices
  cannot see each other's bookings.
- **Print styling depends on the browser's print dialog.** "Save as PDF"
  works everywhere; exact margins vary by browser.
- **Deleting staff/services keeps history readable** because appointments
  and bills store name snapshots — but a deleted service's price on old
  bills is the price at billing time, not today's menu price, which is the
  correct behaviour for a receipt.

## How I'd extend it

1. Export/import (JSON or CSV) for backup and moving to a new device.
2. A weekly calendar view next to the day view, and a "next free slot"
   suggestion per staff member.
3. Integer-paise money handling and a daily closing report (cash vs UPI vs
   card totals).
4. Optional backend (even a tiny one) for multi-device booking and SMS
   reminders — only when the salon actually needs a second device.

## Interview notes

**What is this project?**
SalonBook is a static, offline-first web app that combines the two things a
small salon actually does every day — booking chairs and billing customers —
into one page, with no server, no account, and no build step.

**Why static HTML/CSS/JS with localStorage instead of a framework or backend?**
The user is a single salon owner on one device, and the brief asked for
something that runs from GitHub Pages. A framework would add a build step
and bundle weight for five screens of mostly form logic, and a backend
would add hosting cost and a login the owner never asked for. localStorage
gives instant saves and offline use for free; the price is single-device
data, which I state plainly in the README rather than pretending otherwise.

**Why is the slot-conflict check interval-based instead of fixed time slots?**
Salons don't run on uniform 30-minute grid slots — a colour takes 90
minutes, a trim 20. So each booking is an interval `[start, start +
duration)` per staff member per day, and a new booking conflicts only if
the intervals truly overlap. Back-to-back bookings are allowed because
one client leaving as the next sits down is normal. Cancelled bookings
never block a slot, which is why the check skips them explicitly.

**Why are names snapshotted onto appointments and bills?**
If a service is renamed or a staff member leaves, deleting them must not
rewrite history — a past bill should still say what the customer actually
paid for. So appointments store `serviceName`/`staffName` and bills store
item names and prices at billing time, even though the live menu is the
source for new bookings and bills. The trade-off is mild duplication, and
it is the right one for records.

**Why is discount applied before GST?**
That is the standard order for a discounted sale: GST is charged on what
the customer actually pays, not the list price. The `calcBill` function
does subtotal → discount → GST on the discounted amount, rounding each
step to paise, and it is covered by a test with hand-computed numbers
(₹490 − 10% = ₹441, + 18% GST = ₹520.38).

**Why is the bill maths in pure, DOM-free functions?**
So it can be tested without a browser. `app.js` exports
`findConflict`, `calcBill`, `buildCustomerStats`, and friends, and
`test_salonbook.js` runs 15 assertions against the real code with plain
Node — no test framework, no DOM stubs. The browser-only code is guarded
by `typeof document !== "undefined"`, which is what makes that possible.

**What was the trickiest bug caught during development?**
Two, both in wiring rather than logic. First, the "Bill this appointment"
action re-rendered the billing form after selecting the appointment,
which rebuilt the appointment dropdown and silently dropped the
selection — the bill would have saved as a walk-in and the appointment
would never have been marked Completed. The fix was to not re-render
after the selection (the change handler already updates the draft).
Second, the bill view referenced a status element that doesn't exist in
the markup, which would have thrown and broken bill display; it was
removed. Both are the kind of bug that only shows up when you trace the
actual click path, not when you read functions in isolation.

**What would I do differently at larger scale?**
Move money to integer paise, add JSON export/import first (backup before
features), then a small backend with per-salon accounts for multi-device
booking — and only then consider reminders or payments, since those are
the first features that genuinely need a server.
