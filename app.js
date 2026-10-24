/* SalonBook — appointment booking + billing for a salon.
 * Static app: all data lives in localStorage under "salonbook-v1".
 * Nothing is sent anywhere. The pure functions at the top have no DOM
 * dependency, so they can be unit-tested from Node (see test_salonbook.js).
 */
"use strict";

/* ---------- pure helpers (DOM-free, tested) ---------- */

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function minutesFromTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function timeFromMinutes(total) {
  const h = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return h + ":" + m;
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

/* Do two half-open intervals [start, end) overlap? Back-to-back bookings
 * (one ends exactly when the next starts) do NOT overlap. */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/* Find a clashing booking for the same staff member on the same day.
 * Cancelled appointments never block a slot. Returns the clash or null. */
function findConflict(appointments, candidate) {
  const cStart = minutesFromTime(candidate.time);
  const cEnd = cStart + candidate.duration;
  for (const a of appointments) {
    if (a.id === candidate.id) continue;
    if (a.status === "Cancelled") continue;
    if (a.date !== candidate.date || a.staffId !== candidate.staffId) continue;
    const aStart = minutesFromTime(a.time);
    if (intervalsOverlap(cStart, cEnd, aStart, aStart + a.duration)) return a;
  }
  return null;
}

/* Bill maths. Discount applies first, GST applies to the discounted
 * subtotal — the usual salon billing order. Amounts rounded to paise. */
function calcBill(items, discountPct, gstPct) {
  const subtotal = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
  const disc = Math.min(100, Math.max(0, discountPct || 0));
  const discount = round2(subtotal * disc / 100);
  const taxable = round2(subtotal - discount);
  const gstRate = Math.min(28, Math.max(0, gstPct || 0));
  const gst = round2(taxable * gstRate / 100);
  return { subtotal, discount, taxable, gst, total: round2(taxable + gst) };
}

function nextBillNo(bills) {
  let max = 0;
  for (const b of bills) {
    const n = parseInt(String(b.no).replace("SB-", ""), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return "SB-" + String(max + 1).padStart(4, "0");
}

/* Services a staff member offers: an empty staffIds list means "everyone". */
function servicesForStaff(services, staffId) {
  return services.filter(s => s.staffIds.length === 0 || s.staffIds.includes(staffId));
}

/* Group appointments + bills into per-customer history. Keyed by phone when
 * present (a customer may change name spelling), otherwise by lowercased name.
 * "Spent" counts bills only, so an unbilled booking never inflates revenue. */
function buildCustomerStats(appointments, bills) {
  const map = new Map();
  const keyFor = (name, phone) =>
    phone ? "phone:" + phone : "name:" + name.trim().toLowerCase();
  for (const a of appointments) {
    if (a.status === "Cancelled") continue;
    const k = keyFor(a.customer, a.phone);
    const row = map.get(k) || { name: a.customer, phone: a.phone || "", appts: 0, bills: 0, spent: 0, last: "" };
    row.appts += 1;
    if (!row.phone && a.phone) row.phone = a.phone;
    if (a.date > row.last) row.last = a.date;
    map.set(k, row);
  }
  for (const b of bills) {
    const k = keyFor(b.customer, b.phone);
    const row = map.get(k) || { name: b.customer, phone: b.phone || "", appts: 0, bills: 0, spent: 0, last: "" };
    row.bills += 1;
    row.spent = round2(row.spent + b.total);
    if (!row.phone && b.phone) row.phone = b.phone;
    if (b.date > row.last) row.last = b.date;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
}

function seedState() {
  const staff = [
    { id: "st1", name: "Aarav", role: "Senior stylist" },
    { id: "st2", name: "Priya", role: "Colour specialist" },
    { id: "st3", name: "Rohan", role: "Barber" },
  ];
  return {
    settings: { salonName: "SalonBook Studio", gst: 18 },
    // staffIds: [] means "offered by everyone".
    services: [
      { id: "sv1", name: "Haircut", duration: 30, price: 250, staffIds: [] },
      { id: "sv2", name: "Beard Trim", duration: 20, price: 120, staffIds: [] },
      { id: "sv3", name: "Hair Colour", duration: 90, price: 1200, staffIds: [] },
      { id: "sv4", name: "Facial", duration: 60, price: 800, staffIds: [] },
      { id: "sv5", name: "Head Massage", duration: 30, price: 300, staffIds: [] },
      { id: "sv6", name: "Hair Spa", duration: 45, price: 700, staffIds: [] },
    ],
    staff,
    appointments: [],
    bills: [],
  };
}

/* ---------- browser app (guarded so Node can require this file) ---------- */

if (typeof document !== "undefined") {
  const KEY = "salonbook-v1";
  let state = load();
  let draftItems = []; // bill items being built; saved only on "Save bill"

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.services) && Array.isArray(parsed.staff)) return parsed;
      }
    } catch (e) { /* corrupted storage: fall through to seed data */ }
    return seedState();
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(n) { return "₹" + Number(n).toFixed(2).replace(/\.00$/, ""); }
  function staffById(id) { return state.staff.find(s => s.id === id); }
  function serviceById(id) { return state.services.find(s => s.id === id); }

  /* ----- tab switching ----- */
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
  function showTab(name) {
    document.querySelector('.tab-btn[data-tab="' + name + '"]').click();
  }

  /* ----- dashboard ----- */
  function renderDashboard() {
    const today = todayISO();
    const todaysAppts = state.appointments.filter(a => a.date === today && a.status !== "Cancelled");
    const todaysBills = state.bills.filter(b => b.date === today);
    document.getElementById("dash-appts").textContent = todaysAppts.length;
    document.getElementById("dash-revenue").textContent =
      money(todaysBills.reduce((s, b) => s + b.total, 0));
    document.getElementById("dash-customers").textContent =
      buildCustomerStats(state.appointments, state.bills).length;
    document.getElementById("dash-services").textContent = state.services.length;

    document.getElementById("dash-staff").innerHTML = state.staff.map(st => {
      const mine = todaysAppts.filter(a => a.staffId === st.id);
      return "<tr><td>" + esc(st.name) + "</td><td>" + mine.length + "</td><td>" +
        mine.filter(a => a.status === "Completed").length + "</td></tr>";
    }).join("") || '<tr><td colspan="3">No staff yet — add staff under Services &amp; Staff.</td></tr>';

    document.getElementById("dash-today-list").innerHTML = todaysAppts.length
      ? todaysAppts.slice().sort((a, b) => a.time.localeCompare(b.time)).map(apptRow).join("")
      : "<p class=\"hint\">Nothing booked for today yet.</p>";

    const recent = state.bills.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    document.getElementById("dash-recent-bills").innerHTML = recent.length
      ? recent.map(b => '<div class="row"><span class="grow"><strong>' + esc(b.no) + "</strong> — " +
          esc(b.customer) + " · " + esc(b.date) + '</span><span>' + money(b.total) + "</span></div>").join("")
      : "<p class=\"hint\">No bills yet.</p>";

    document.getElementById("setting-salon-name").value = state.settings.salonName;
    document.getElementById("setting-gst").value = state.settings.gst;
  }

  /* ----- services & staff ----- */
  function renderServices() {
    document.getElementById("svc-staff-checks").innerHTML = state.staff.map(st =>
      '<label><input type="checkbox" value="' + esc(st.id) + '" checked> ' + esc(st.name) + "</label>"
    ).join("") || '<span class="hint">Add staff first, or leave the service open to everyone.</span>';

    document.getElementById("service-list").innerHTML = state.services.map(s => {
      const who = s.staffIds.length === 0 ? "All staff"
        : s.staffIds.map(id => (staffById(id) || {}).name).filter(Boolean).join(", ") || "All staff";
      return "<tr><td>" + esc(s.name) + "</td><td>" + s.duration + " min</td><td>" + money(s.price) +
        "</td><td>" + esc(who) + '</td><td><button type="button" class="secondary danger" data-action="svc-del" data-id="' +
        s.id + '">Delete</button></td></tr>';
    }).join("") || '<tr><td colspan="5">No services yet.</td></tr>';

    document.getElementById("staff-list").innerHTML = state.staff.map(st =>
      "<tr><td>" + esc(st.name) + "</td><td>" + esc(st.role) + '</td><td><button type="button" class="secondary danger" data-action="staff-del" data-id="' +
      st.id + '">Delete</button></td></tr>'
    ).join("") || '<tr><td colspan="3">No staff yet.</td></tr>';
  }

  /* ----- appointments ----- */
  function apptRow(a) {
    const cls = a.status === "Completed" ? "completed" : a.status === "Cancelled" ? "cancelled" : "booked";
    let actions = "";
    if (a.status === "Booked") {
      actions = '<button type="button" data-action="appt-complete" data-id="' + a.id + '">Complete</button> ' +
        '<button type="button" class="secondary" data-action="appt-bill" data-id="' + a.id + '">Bill</button> ' +
        '<button type="button" class="secondary danger" data-action="appt-cancel" data-id="' + a.id + '">Cancel</button>';
    }
    return '<div class="row"><span class="grow"><strong>' + esc(a.time) + " · " + esc(a.serviceName) +
      "</strong> — " + esc(a.customer) + (a.phone ? " (" + esc(a.phone) + ")" : "") +
      " with " + esc(a.staffName) + " · " + a.duration + " min" +
      (a.notes ? "<br><span class=\"hint\">" + esc(a.notes) + "</span>" : "") +
      '</span><span class="badge ' + cls + '">' + a.status + "</span>" + actions + "</div>";
  }

  function fillStaffSelects() {
    const opts = state.staff.map(st => '<option value="' + st.id + '">' + esc(st.name) + "</option>").join("");
    document.getElementById("appt-staff").innerHTML = opts;
    const daySel = document.getElementById("day-staff");
    const keep = daySel.value;
    daySel.innerHTML = '<option value="all">All staff</option>' + opts;
    daySel.value = state.staff.some(s => s.id === keep) ? keep : "all";
    refreshServiceSelect();
  }

  function refreshServiceSelect() {
    const staffId = document.getElementById("appt-staff").value;
    const list = staffId ? servicesForStaff(state.services, staffId) : state.services;
    document.getElementById("appt-service").innerHTML = list.map(s =>
      '<option value="' + s.id + '">' + esc(s.name) + " — " + money(s.price) + ", " + s.duration + " min</option>"
    ).join("");
    updateDurationHint();
  }

  function updateDurationHint() {
    const svc = serviceById(document.getElementById("appt-service").value);
    const time = document.getElementById("appt-time").value;
    document.getElementById("appt-duration-hint").textContent = svc
      ? "Duration: " + svc.duration + " min" + (time ? " — ends at " + timeFromMinutes(minutesFromTime(time) + svc.duration) : "")
      : "";
  }

  function renderDayView() {
    const date = document.getElementById("day-date").value || todayISO();
    const staffFilter = document.getElementById("day-staff").value;
    const list = state.appointments.filter(a =>
      a.date === date && (staffFilter === "all" || a.staffId === staffFilter)
    ).sort((a, b) => a.time.localeCompare(b.time));
    document.getElementById("day-list").innerHTML = list.length
      ? list.map(apptRow).join("")
      : "<p class=\"hint\">No appointments on this day for this selection.</p>";
  }

  /* ----- billing ----- */
  function renderBillForm() {
    document.getElementById("bill-service").innerHTML = state.services.map(s =>
      '<option value="' + s.id + '">' + esc(s.name) + " — " + money(s.price) + "</option>"
    ).join("");
    document.getElementById("bill-appt").innerHTML =
      '<option value="">Walk-in (no appointment)</option>' + state.appointments
        .filter(a => a.status === "Booked")
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .map(a => '<option value="' + a.id + '">' + esc(a.date) + " " + esc(a.time) + " · " +
          esc(a.customer) + " · " + esc(a.serviceName) + " (" + esc(a.staffName) + ")</option>").join("");
    document.getElementById("bill-gst").value = state.settings.gst;
    renderDraft();
  }

  function renderDraft() {
    document.getElementById("bill-items").innerHTML = draftItems.map((it, i) =>
      "<tr><td>" + esc(it.name) + " <span class=\"hint\">(" + it.kind + ")</span></td><td>" + money(it.price) +
      '</td><td><button type="button" class="secondary" data-action="item-dec" data-id="' + i + '">−</button> ' + it.qty +
      ' <button type="button" class="secondary" data-action="item-inc" data-id="' + i + '">+</button></td><td>' +
      money(round2(it.price * it.qty)) + '</td><td><button type="button" class="secondary danger" data-action="item-del" data-id="' +
      i + '">Remove</button></td></tr>'
    ).join("") || '<tr><td colspan="5">No items yet — add a service or a product above.</td></tr>';
    const t = calcBill(draftItems,
      parseFloat(document.getElementById("bill-discount").value) || 0,
      parseFloat(document.getElementById("bill-gst").value) || 0);
    document.getElementById("bill-totals").innerHTML =
      "Subtotal " + money(t.subtotal) + " · Discount " + money(t.discount) +
      " · GST " + money(t.gst) + " · <strong>Total " + money(t.total) + "</strong>";
  }

  function renderBillList() {
    const list = state.bills.slice().sort((a, b) => (b.date + b.no).localeCompare(a.date + a.no));
    document.getElementById("bill-list").innerHTML = list.length
      ? list.map(b => '<div class="row"><span class="grow"><strong>' + esc(b.no) + "</strong> — " +
          esc(b.customer) + " · " + esc(b.date) + " · " + esc(b.payment) + "</span><span>" + money(b.total) +
          '</span><button type="button" class="secondary" data-action="bill-view" data-id="' + b.no + '">View / Print</button></div>').join("")
      : "<p class=\"hint\">No bills yet.</p>";
  }

  function showBill(bill) {
    const rows = bill.items.map(it =>
      "<tr><td>" + esc(it.name) + "</td><td>" + money(it.price) + "</td><td>" + it.qty +
      "</td><td>" + money(round2(it.price * it.qty)) + "</td></tr>").join("");
    document.getElementById("bill-print-area").innerHTML =
      "<h2>" + esc(state.settings.salonName) + "</h2><p>Bill " + esc(bill.no) + " · " + esc(bill.date) +
      " · Payment: " + esc(bill.payment) + "<br>Customer: " + esc(bill.customer) +
      (bill.phone ? " · " + esc(bill.phone) : "") + "</p>" +
      '<table class="table"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Amount</th></tr></thead><tbody>' +
      rows + "</tbody></table><p>Subtotal " + money(bill.subtotal) + "<br>Discount " + money(bill.discount) +
      "<br>GST " + money(bill.gst) + "<br><strong>Total " + money(bill.total) + "</strong></p><p>Thank you for visiting!</p>";
    document.getElementById("bill-form-wrap").hidden = true;
    document.getElementById("bill-view").hidden = false;
  }

  function renderCustomers() {
    document.getElementById("customer-list").innerHTML = buildCustomerStats(state.appointments, state.bills).map(c =>
      "<tr><td>" + esc(c.name) + "</td><td>" + esc(c.phone || "—") + "</td><td>" + c.appts +
      "</td><td>" + c.bills + "</td><td>" + money(c.spent) + "</td><td>" + (c.last || "—") + "</td></tr>"
    ).join("") || '<tr><td colspan="6">No customers yet.</td></tr>';
  }

  function renderAll() {
    renderDashboard(); renderServices(); fillStaffSelects(); renderDayView();
    renderBillForm(); renderBillList(); renderCustomers();
  }

  /* ----- forms ----- */
  document.getElementById("settings-form").addEventListener("submit", e => {
    e.preventDefault();
    state.settings.salonName = document.getElementById("setting-salon-name").value.trim() || "SalonBook Studio";
    state.settings.gst = Math.min(28, Math.max(0, parseFloat(document.getElementById("setting-gst").value) || 0));
    save(); renderAll();
  });

  document.getElementById("service-form").addEventListener("submit", e => {
    e.preventDefault();
    const checked = [...document.querySelectorAll("#svc-staff-checks input:checked")].map(c => c.value);
    // All ticked == everyone, so store [] (the "everyone" marker) instead of a long list.
    const staffIds = checked.length === state.staff.length ? [] : checked;
    state.services.push({
      id: uid("sv"), name: document.getElementById("svc-name").value.trim(),
      duration: parseInt(document.getElementById("svc-duration").value, 10),
      price: parseFloat(document.getElementById("svc-price").value) || 0, staffIds,
    });
    save(); e.target.reset(); renderAll();
  });

  document.getElementById("staff-form").addEventListener("submit", e => {
    e.preventDefault();
    state.staff.push({ id: uid("st"), name: document.getElementById("staff-name").value.trim(),
      role: document.getElementById("staff-role").value.trim() });
    save(); e.target.reset(); renderAll();
  });

  document.getElementById("appt-form").addEventListener("submit", e => {
    e.preventDefault();
    const err = document.getElementById("appt-error");
    const svc = serviceById(document.getElementById("appt-service").value);
    const st = staffById(document.getElementById("appt-staff").value);
    if (!svc || !st) { err.textContent = "Pick a staff member and a service first."; err.hidden = false; return; }
    // Snapshots: if a service/staff is later renamed or deleted, old bookings stay readable.
    const candidate = { id: uid("ap"), date: document.getElementById("appt-date").value,
      time: document.getElementById("appt-time").value, staffId: st.id, staffName: st.name,
      serviceId: svc.id, serviceName: svc.name, duration: svc.duration,
      customer: document.getElementById("appt-customer").value.trim(),
      phone: document.getElementById("appt-phone").value.trim(),
      notes: document.getElementById("appt-notes").value.trim(), status: "Booked" };
    const clash = findConflict(state.appointments, candidate);
    if (clash) {
      err.textContent = "That slot clashes with " + clash.customer + "'s " + clash.serviceName +
        " (" + clash.time + ", " + clash.duration + " min) for " + clash.staffName + ". Pick another time or staff member.";
      err.hidden = false; return;
    }
    err.hidden = true;
    state.appointments.push(candidate);
    save(); e.target.reset();
    document.getElementById("appt-date").value = todayISO();
    document.getElementById("day-date").value = candidate.date;
    renderAll();
  });

  document.getElementById("appt-staff").addEventListener("change", refreshServiceSelect);
  document.getElementById("appt-service").addEventListener("change", updateDurationHint);
  document.getElementById("appt-time").addEventListener("change", updateDurationHint);
  document.getElementById("day-date").addEventListener("change", renderDayView);
  document.getElementById("day-staff").addEventListener("change", renderDayView);
  document.getElementById("bill-discount").addEventListener("input", renderDraft);
  document.getElementById("bill-gst").addEventListener("input", renderDraft);
  document.getElementById("bill-form").addEventListener("submit", e => e.preventDefault());

  document.getElementById("bill-add-service").addEventListener("click", () => {
    const svc = serviceById(document.getElementById("bill-service").value);
    if (!svc) return;
    const existing = draftItems.find(it => it.kind === "service" && it.name === svc.name);
    if (existing) existing.qty += 1; else draftItems.push({ kind: "service", name: svc.name, price: svc.price, qty: 1 });
    renderDraft();
  });

  document.getElementById("bill-add-product").addEventListener("click", () => {
    const name = document.getElementById("bill-product-name").value.trim();
    const price = parseFloat(document.getElementById("bill-product-price").value);
    if (!name || !(price >= 0)) return;
    draftItems.push({ kind: "product", name, price, qty: 1 });
    document.getElementById("bill-product-name").value = "";
    document.getElementById("bill-product-price").value = "";
    renderDraft();
  });

  document.getElementById("bill-appt").addEventListener("change", e => {
    const appt = state.appointments.find(a => a.id === e.target.value);
    if (!appt) return;
    document.getElementById("bill-customer").value = appt.customer;
    document.getElementById("bill-phone").value = appt.phone;
    // Replace any previously prefilled service item with this appointment's service.
    draftItems = draftItems.filter(it => it.kind !== "service");
    const svc = serviceById(appt.serviceId);
    draftItems.push({ kind: "service", name: appt.serviceName, price: svc ? svc.price : 0, qty: 1, staffId: appt.staffId });
    renderDraft();
  });

  document.getElementById("bill-save").addEventListener("click", () => {
    const err = document.getElementById("bill-error");
    const customer = document.getElementById("bill-customer").value.trim();
    if (!customer) { err.textContent = "Enter a customer name."; err.hidden = false; return; }
    if (!draftItems.length) { err.textContent = "Add at least one service or product."; err.hidden = false; return; }
    err.hidden = true;
    const t = calcBill(draftItems,
      parseFloat(document.getElementById("bill-discount").value) || 0,
      parseFloat(document.getElementById("bill-gst").value) || 0);
    const apptId = document.getElementById("bill-appt").value;
    const bill = { no: nextBillNo(state.bills), date: todayISO(), customer,
      phone: document.getElementById("bill-phone").value.trim(),
      items: draftItems.map(it => ({ ...it })), ...t,
      discountPct: parseFloat(document.getElementById("bill-discount").value) || 0,
      gstPct: parseFloat(document.getElementById("bill-gst").value) || 0,
      payment: document.getElementById("bill-payment").value, appointmentId: apptId || null };
    state.bills.push(bill);
    if (apptId) {
      const appt = state.appointments.find(a => a.id === apptId);
      if (appt) appt.status = "Completed";
    }
    save();
    draftItems = [];
    document.getElementById("bill-customer").value = "";
    document.getElementById("bill-phone").value = "";
    document.getElementById("bill-discount").value = 0;
    renderAll();
    showBill(bill);
  });

  document.getElementById("bill-print").addEventListener("click", () => window.print());
  document.getElementById("bill-close-view").addEventListener("click", () => {
    document.getElementById("bill-view").hidden = true;
    document.getElementById("bill-form-wrap").hidden = false;
  });

  /* ----- delegated row actions ----- */
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action, id = btn.dataset.id;
    if (action === "svc-del") {
      if (confirm("Delete this service? Past appointments keep its name.")) {
        state.services = state.services.filter(s => s.id !== id);
      }
    } else if (action === "staff-del") {
      if (confirm("Delete this staff member? Their past appointments keep the name.")) {
        state.staff = state.staff.filter(s => s.id !== id);
        state.services.forEach(s => { s.staffIds = s.staffIds.filter(x => x !== id); });
      }
    } else if (action === "appt-complete") {
      const a = state.appointments.find(x => x.id === id);
      if (a) a.status = "Completed";
    } else if (action === "appt-cancel") {
      const a = state.appointments.find(x => x.id === id);
      if (a) a.status = "Cancelled";
    } else if (action === "appt-bill") {
      // NOTE: do not re-render the bill form here — rebuilding the
      // appointment <select> would wipe the selection just made, and the
      // bill would save as a walk-in instead of completing the appointment.
      showTab("billing");
      document.getElementById("bill-appt").value = id;
      document.getElementById("bill-appt").dispatchEvent(new Event("change"));
      return; // the change handler already re-rendered the draft
    } else if (action === "bill-view") {
      const b = state.bills.find(x => x.no === id);
      if (b) showBill(b);
      return;
    } else if (action === "item-del") {
      draftItems.splice(parseInt(id, 10), 1); renderDraft(); return;
    } else if (action === "item-inc") {
      draftItems[parseInt(id, 10)].qty += 1; renderDraft(); return;
    } else if (action === "item-dec") {
      const it = draftItems[parseInt(id, 10)];
      it.qty = Math.max(1, it.qty - 1); renderDraft(); return;
    } else {
      return;
    }
    save(); renderAll();
  });

  /* ----- boot ----- */
  document.getElementById("appt-date").value = todayISO();
  document.getElementById("day-date").value = todayISO();
  document.getElementById("bill-gst").value = state.settings.gst;
  renderAll();
}

/* Node export for tests (browser ignores this branch). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    round2, minutesFromTime, timeFromMinutes, intervalsOverlap,
    findConflict, calcBill, nextBillNo, servicesForStaff,
    buildCustomerStats, seedState,
  };
}
