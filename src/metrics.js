import { tables, dates, zones, PROCESSES } from "./data.js";

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a, b) => (b ? round((a / b) * 100) : 0);

export function range({ from, to } = {}) {
  return { from: from || dates[0], to: to || dates[dates.length - 1] };
}
const inRange = (r, { from, to }) => r.date >= from && r.date <= to;

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// Outbound: capacity (caps) vs actual shipped.
export function outboundSummary(q = {}) {
  const rg = range(q);
  const rows = tables.outbound.filter((r) => inRange(r, rg));
  const byDay = [...groupBy(rows, "date")].map(([date, rs]) => ({
    date,
    caps_units: sum(rs, "caps_units"),
    units_shipped: sum(rs, "units_shipped"),
    caps_attainment_pct: pct(sum(rs, "units_shipped"), sum(rs, "caps_units")),
    backlog_units: sum(rs, "backlog_units"),
    missed_cutoff_orders: sum(rs, "missed_cutoff_orders"),
  }));
  const byShift = [...groupBy(rows, "shift")].map(([shift, rs]) => ({
    shift,
    caps_units: sum(rs, "caps_units"),
    units_shipped: sum(rs, "units_shipped"),
    caps_attainment_pct: pct(sum(rs, "units_shipped"), sum(rs, "caps_units")),
  }));
  return {
    ...rg,
    caps_units: sum(rows, "caps_units"),
    units_shipped: sum(rows, "units_shipped"),
    shipments: sum(rows, "shipments"),
    caps_attainment_pct: pct(sum(rows, "units_shipped"), sum(rows, "caps_units")),
    backlog_units_latest: byDay.at(-1)?.backlog_units ?? 0,
    missed_cutoff_orders: sum(rows, "missed_cutoff_orders"),
    by_day: byDay,
    by_shift: byShift,
  };
}

// Inbound: ASN receipts, variance, dock-to-stock.
export function inboundSummary(q = {}) {
  const rg = range(q);
  const rows = tables.inbound.filter((r) => inRange(r, rg));
  const closed = rows.filter((r) => r.status === "closed");
  const byDay = [...groupBy(rows, "date")].map(([date, rs]) => ({
    date,
    asns: rs.length,
    expected_units: sum(rs, "expected_units"),
    received_units: sum(rs, "received_units"),
  }));
  const bySupplier = [...groupBy(closed, "supplier")].map(([supplier, rs]) => ({
    supplier,
    asns: rs.length,
    fill_rate_pct: pct(sum(rs, "received_units"), sum(rs, "expected_units")),
    late_arrival_pct: pct(rs.filter((r) => r.arrived_late).length, rs.length),
  }));
  return {
    ...rg,
    asns: rows.length,
    expected_units: sum(rows, "expected_units"),
    received_units: sum(rows, "received_units"),
    receipt_accuracy_pct: pct(sum(closed, "received_units"), sum(closed, "expected_units")),
    late_arrival_pct: pct(rows.filter((r) => r.arrived_late).length, rows.length),
    avg_dock_to_stock_hrs: closed.length ? round(sum(closed, "dock_to_stock_hrs") / closed.length) : 0,
    open_asns: rows.filter((r) => r.status !== "closed").map(({ asn, supplier, dock, status, expected_units, received_units }) => ({ asn, supplier, dock, status, expected_units, received_units })),
    by_day: byDay,
    by_supplier: bySupplier,
  };
}

// Productivity: TPH (units per labor hour) and IPP (items per package).
export function productivitySummary(q = {}) {
  const rg = range(q);
  const rows = tables.productivity.filter((r) => inRange(r, rg));
  const byProcess = PROCESSES.map((process) => {
    const rs = rows.filter((r) => r.process === process);
    return { process, units: sum(rs, "units"), labor_hours: sum(rs, "labor_hours"), tph: round(sum(rs, "units") / sum(rs, "labor_hours")) };
  });
  const pack = rows.filter((r) => r.process === "packing");
  const pickRows = rows.filter((r) => r.process === "picking");
  const byDay = [...groupBy(rows, "date")].map(([date, rs]) => {
    const out = { date };
    for (const p of PROCESSES) {
      const pr = rs.filter((r) => r.process === p);
      out[p] = round(sum(pr, "units") / sum(pr, "labor_hours"));
    }
    const pk = rs.filter((r) => r.process === "packing");
    out.ipp = round(sum(pk, "units") / sum(pk, "packages"), 2);
    return out;
  });
  const byHourLatest = [...groupBy(rows.filter((r) => r.date === rg.to), "hour")].map(([hour, rs]) => ({
    hour,
    units: sum(rs, "units"),
    tph: round(sum(rs, "units") / sum(rs, "labor_hours")),
  }));
  return {
    ...rg,
    overall_tph: round(sum(rows, "units") / sum(rows, "labor_hours")),
    ipp: round(sum(pack, "units") / sum(pack, "packages"), 2),
    units_per_pick: round(sum(pickRows, "units") / sum(pickRows, "picks"), 2),
    total_labor_hours: sum(rows, "labor_hours"),
    by_process: byProcess,
    by_day: byDay,
    by_hour_latest_day: byHourLatest,
  };
}

// Inventory and storage utilisation.
export function inventorySummary() {
  const inv = tables.inventory;
  const byZone = zones.map((z) => {
    const rs = inv.filter((r) => r.zone === z.zone);
    const usedBins = new Set(rs.filter((r) => r.on_hand > 0).map((r) => r.bin)).size;
    const usedCbm = rs.reduce((a, r) => a + r.on_hand * r.cbm_per_unit, 0);
    // Demo data covers 400 SKUs; scale bins so utilisation looks like a real site.
    const binUtil = Math.min(99, pct(usedBins * 40, z.bins));
    return { ...z, skus: rs.length, units: sum(rs, "on_hand"), bin_utilization_pct: binUtil, cbm_used: round(usedCbm * 8), cbm_utilization_pct: Math.min(99, pct(usedCbm * 8, z.cbm)) };
  });
  const byCategory = [...groupBy(inv, "category")].map(([category, rs]) => ({ category, skus: rs.length, on_hand: sum(rs, "on_hand"), afs: sum(rs, "afs") }));
  return {
    skus: inv.length,
    on_hand_units: sum(inv, "on_hand"),
    out_of_stock_skus: inv.filter((r) => r.afs === 0).length,
    by_zone: byZone,
    by_category: byCategory,
  };
}

// AFS: available-for-sale vs blocked stock, plus days of cover.
export function afsSummary() {
  const inv = tables.inventory;
  const onHand = sum(inv, "on_hand");
  const lowCover = inv
    .map((r) => ({ sku: r.sku, category: r.category, afs: r.afs, avg_daily_sales: r.avg_daily_sales, days_of_cover: r.avg_daily_sales ? round(r.afs / r.avg_daily_sales) : null }))
    .filter((r) => r.days_of_cover !== null && r.days_of_cover < 3)
    .sort((a, b) => a.days_of_cover - b.days_of_cover);
  return {
    on_hand_units: onHand,
    afs_units: sum(inv, "afs"),
    afs_pct: pct(sum(inv, "afs"), onHand),
    reserved_units: sum(inv, "reserved"),
    damaged_units: sum(inv, "damaged"),
    qc_hold_units: sum(inv, "qc_hold"),
    zero_afs_skus: inv.filter((r) => r.afs === 0).length,
    low_cover_skus_count: lowCover.length,
    low_cover_skus: lowCover.slice(0, 25),
  };
}

export function overview(q = {}) {
  const o = outboundSummary(q);
  const i = inboundSummary(q);
  const p = productivitySummary(q);
  const inv = inventorySummary();
  const a = afsSummary();
  return {
    ...range(q),
    caps_attainment_pct: o.caps_attainment_pct,
    units_shipped: o.units_shipped,
    backlog_units_latest: o.backlog_units_latest,
    received_units: i.received_units,
    receipt_accuracy_pct: i.receipt_accuracy_pct,
    avg_dock_to_stock_hrs: i.avg_dock_to_stock_hrs,
    overall_tph: p.overall_tph,
    ipp: p.ipp,
    on_hand_units: inv.on_hand_units,
    afs_pct: a.afs_pct,
    low_cover_skus: a.low_cover_skus_count,
    storage_utilization_pct: round(inv.by_zone.reduce((s, z) => s + z.cbm_utilization_pct, 0) / inv.by_zone.length),
  };
}

// Generic filter over the raw tables, for questions the summaries don't cover.
export function queryTable({ table, filters = {}, sort_by, descending = true, limit = 50 }) {
  const rows = tables[table];
  if (!rows) throw new Error(`Unknown table "${table}". Tables: ${Object.keys(tables).join(", ")}`);
  let out = rows.filter((r) =>
    Object.entries(filters).every(([k, v]) => {
      if (v && typeof v === "object") return (v.min === undefined || r[k] >= v.min) && (v.max === undefined || r[k] <= v.max);
      return r[k] === v;
    }),
  );
  if (sort_by) out = [...out].sort((a, b) => (a[sort_by] > b[sort_by] ? 1 : -1) * (descending ? -1 : 1));
  return { total_matches: out.length, rows: out.slice(0, Math.min(limit, 200)) };
}
