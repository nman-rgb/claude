// Seeded demo data for one fulfillment center. Replace the generators in this
// file with reads from your WMS / OMS / TMS to run the app on real data.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = rng(42);
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.round(between(a, b));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

export const DAYS = 14;
const today = new Date();
today.setHours(0, 0, 0, 0);
export const dates = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() - (DAYS - 1 - i));
  return d.toISOString().slice(0, 10);
});

export const PROCESSES = ["receiving", "putaway", "picking", "packing", "sorting", "dispatch"];
const SHIFTS = ["A", "B", "C"];
const SUPPLIERS = ["Alpha Traders", "Gulf Electronics", "Desert Home", "Prime Beauty", "Oasis Fashion", "Falcon Toys"];
const CARRIERS = ["Own Fleet", "Aramex", "SMSA", "DHL", "Naqel"];
const CATEGORIES = ["Electronics", "Home", "Beauty", "Fashion", "Toys", "Grocery"];

// Storage zones: capacity in bin locations and in cubic meters.
export const zones = [
  { zone: "A-Shelving", type: "Shelving", bins: 12000, cbm: 2400 },
  { zone: "B-Pallet Racking", type: "Pallet", bins: 3200, cbm: 9600 },
  { zone: "C-Bulk Floor", type: "Bulk", bins: 400, cbm: 6000 },
  { zone: "D-High Value Cage", type: "Secure", bins: 900, cbm: 180 },
  { zone: "E-Mezzanine", type: "Shelving", bins: 8000, cbm: 1600 },
];

// SKU-level inventory with AFS (available for sale) breakdown.
export const inventory = Array.from({ length: 400 }, (_, i) => {
  const z = pick(zones);
  const onHand = int(0, 600);
  const reserved = Math.min(onHand, int(0, onHand * 0.3));
  const damaged = int(0, onHand * 0.04);
  const qcHold = int(0, onHand * 0.05);
  const afs = Math.max(0, onHand - reserved - damaged - qcHold);
  return {
    sku: `SKU-${String(10000 + i)}`,
    category: pick(CATEGORIES),
    zone: z.zone,
    bin: `${z.zone[0]}-${int(1, 40)}-${int(1, 12)}-${int(1, 6)}`,
    on_hand: onHand,
    reserved,
    damaged,
    qc_hold: qcHold,
    afs,
    cbm_per_unit: +between(0.001, z.type === "Shelving" ? 0.01 : 0.06).toFixed(4),
    avg_daily_sales: +between(0, 40).toFixed(1),
    last_movement: pick(dates),
  };
});

// Inbound shipments (ASNs).
export const inbound = [];
let asn = 50000;
for (const date of dates) {
  for (let k = 0, n = int(18, 30); k < n; k++) {
    const expected = int(200, 3000);
    const late = rand() < 0.15;
    const status = date === dates[DAYS - 1] && rand() < 0.4 ? pick(["scheduled", "at_dock", "receiving"]) : "closed";
    const received = status === "closed" ? Math.round(expected * between(0.9, 1.03)) : status === "receiving" ? Math.round(expected * between(0.2, 0.7)) : 0;
    inbound.push({
      asn: `ASN-${asn++}`,
      date,
      supplier: pick(SUPPLIERS),
      dock: `D${int(1, 8)}`,
      expected_units: expected,
      received_units: received,
      variance_units: status === "closed" ? received - expected : null,
      status,
      arrived_late: late,
      dock_to_stock_hrs: status === "closed" ? +between(late ? 10 : 4, late ? 30 : 18).toFixed(1) : null,
    });
  }
}

// Outbound capacity plan vs actual, per day and shift.
export const outbound = [];
for (const date of dates) {
  for (const shift of SHIFTS) {
    const caps = shift === "C" ? 9000 : 14000;
    const orders = int(caps * 0.8, caps * 1.15) / 1.6;
    const shipped = Math.round(Math.min(orders * 1.6, caps * between(0.82, 1.04)));
    outbound.push({
      date,
      shift,
      caps_units: caps,
      orders_received: Math.round(orders),
      units_shipped: shipped,
      shipments: Math.round(shipped / between(1.4, 1.9)),
      backlog_units: Math.max(0, Math.round(orders * 1.6 - shipped)),
      missed_cutoff_orders: int(0, 120),
      carrier_mix: Object.fromEntries(CARRIERS.map((c) => [c, int(5, 35)])),
    });
  }
}

// Hourly productivity by process: units processed and labor hours.
export const productivity = [];
const baseRate = { receiving: 140, putaway: 95, picking: 110, packing: 85, sorting: 300, dispatch: 260 };
for (const date of dates) {
  for (let hour = 0; hour < 24; hour++) {
    for (const process of PROCESSES) {
      const heads = int(4, 22);
      const laborHours = heads;
      const units = Math.round(laborHours * baseRate[process] * between(0.75, 1.15));
      const row = { date, hour, process, headcount: heads, labor_hours: laborHours, units };
      if (process === "picking") {
        row.picks = Math.round(units / between(1.1, 1.6));
      }
      if (process === "packing") {
        row.packages = Math.round(units / between(1.4, 1.9));
      }
      productivity.push(row);
    }
  }
}

export const tables = { inventory, inbound, outbound, productivity, zones };
