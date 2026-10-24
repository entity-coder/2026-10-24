/* Node smoke tests for SalonBook's pure logic (app.js exports).
 * Run: node test_salonbook.js — no dependencies, no browser needed. */
"use strict";
const assert = require("assert");
const m = require("./app.js");

let n = 0;
function check(name, fn) { fn(); n++; console.log("ok - " + name); }

// Time helpers
check("minutes/time round-trip", () => {
  assert.strictEqual(m.minutesFromTime("09:30"), 570);
  assert.strictEqual(m.timeFromMinutes(570), "09:30");
  assert.strictEqual(m.timeFromMinutes(570 + 30), "10:00");
});

// Overlap: back-to-back is fine, true overlap is not
check("back-to-back bookings do not overlap", () => {
  assert.strictEqual(m.intervalsOverlap(540, 570, 570, 600), false);
});
check("overlapping bookings overlap", () => {
  assert.strictEqual(m.intervalsOverlap(540, 600, 570, 630), true);
  assert.strictEqual(m.intervalsOverlap(570, 630, 540, 600), true);
});

// Conflict detection
const appts = [
  { id: "a1", date: "2026-10-24", time: "10:00", duration: 30, staffId: "st1", status: "Booked" },
  { id: "a2", date: "2026-10-24", time: "11:00", duration: 60, staffId: "st1", status: "Cancelled" },
];
check("same staff overlapping slot conflicts", () => {
  const clash = m.findConflict(appts, { date: "2026-10-24", time: "10:15", duration: 30, staffId: "st1" });
  assert.strictEqual(clash.id, "a1");
});
check("cancelled booking never blocks a slot", () => {
  assert.strictEqual(m.findConflict(appts, { date: "2026-10-24", time: "11:15", duration: 30, staffId: "st1" }), null);
});
check("different staff, same time is fine", () => {
  assert.strictEqual(m.findConflict(appts, { date: "2026-10-24", time: "10:15", duration: 30, staffId: "st2" }), null);
});
check("different day, same time is fine", () => {
  assert.strictEqual(m.findConflict(appts, { date: "2026-10-25", time: "10:15", duration: 30, staffId: "st1" }), null);
});
check("own id is ignored (edit-safe)", () => {
  assert.strictEqual(m.findConflict(appts, { id: "a1", date: "2026-10-24", time: "10:00", duration: 30, staffId: "st1" }), null);
});

// Bill maths: discount first, then GST on the discounted subtotal
check("bill totals: discount then GST", () => {
  const t = m.calcBill([{ price: 250, qty: 1 }, { price: 120, qty: 2 }], 10, 18);
  assert.strictEqual(t.subtotal, 490);
  assert.strictEqual(t.discount, 49);
  assert.strictEqual(t.taxable, 441);
  assert.strictEqual(t.gst, 79.38);
  assert.strictEqual(t.total, 520.38);
});
check("bill totals: no discount, no GST", () => {
  const t = m.calcBill([{ price: 100, qty: 3 }], 0, 0);
  assert.deepStrictEqual(t, { subtotal: 300, discount: 0, taxable: 300, gst: 0, total: 300 });
});
check("bill totals: discount and GST clamped to sane ranges", () => {
  const t = m.calcBill([{ price: 100, qty: 1 }], 150, 99);
  assert.strictEqual(t.discount, 100);
  assert.strictEqual(t.total, 0);
});

// Bill numbering
check("bill numbers increment from the max, not the count", () => {
  assert.strictEqual(m.nextBillNo([]), "SB-0001");
  assert.strictEqual(m.nextBillNo([{ no: "SB-0001" }, { no: "SB-0009" }]), "SB-0010");
});

// Staff-filtered services
check("service with empty staff list is offered by everyone", () => {
  const services = [
    { id: "s1", staffIds: [] },
    { id: "s2", staffIds: ["st2"] },
  ];
  assert.deepStrictEqual(m.servicesForStaff(services, "st1").map(s => s.id), ["s1"]);
  assert.deepStrictEqual(m.servicesForStaff(services, "st2").map(s => s.id), ["s1", "s2"]);
});

// Customer stats
check("customer stats: phone groups, cancelled excluded, spent counts bills only", () => {
  const stats = m.buildCustomerStats(
    [
      { customer: "Meera", phone: "999", status: "Booked", date: "2026-10-24" },
      { customer: "Meera S", phone: "999", status: "Cancelled", date: "2026-10-23" },
      { customer: "Arjun", phone: "", status: "Completed", date: "2026-10-22" },
    ],
    [{ customer: "Meera", phone: "999", total: 500, date: "2026-10-24" }]
  );
  const meera = stats.find(s => s.phone === "999");
  assert.strictEqual(meera.appts, 1);
  assert.strictEqual(meera.bills, 1);
  assert.strictEqual(meera.spent, 500);
  assert.strictEqual(meera.last, "2026-10-24");
  assert.strictEqual(stats.find(s => s.name === "Arjun").spent, 0);
});

// Seed data sanity
check("seed state has services and staff", () => {
  const s = m.seedState();
  assert.ok(s.services.length >= 4 && s.staff.length >= 2);
  assert.strictEqual(s.settings.gst, 18);
});

console.log("\n" + n + " checks passed.");
