import Anthropic from "@anthropic-ai/sdk";
import * as m from "./metrics.js";
import { dates } from "./data.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const dateRange = {
  from: { type: "string", description: "Start date YYYY-MM-DD (inclusive). Omit for the earliest date." },
  to: { type: "string", description: "End date YYYY-MM-DD (inclusive). Omit for the latest date." },
};

const tools = [
  { name: "get_overview", description: "Headline KPIs across all functions for a date range.", input_schema: { type: "object", properties: dateRange } },
  { name: "get_outbound", description: "Outbound capacity (caps) vs actual units shipped, attainment %, backlog and missed cutoffs, by day and shift.", input_schema: { type: "object", properties: dateRange } },
  { name: "get_inbound", description: "Inbound ASNs: expected vs received units, receipt accuracy, late arrivals, dock-to-stock hours, open ASNs, supplier performance.", input_schema: { type: "object", properties: dateRange } },
  { name: "get_productivity", description: "TPH (units per labor hour) per process (receiving, putaway, picking, packing, sorting, dispatch), IPP (items per package), units per pick, daily trend and hourly TPH for the last day.", input_schema: { type: "object", properties: dateRange } },
  { name: "get_inventory", description: "Current inventory: units on hand, storage zone bin and cubic utilisation, stock by category.", input_schema: { type: "object", properties: {} } },
  { name: "get_afs", description: "Available-for-sale (AFS) stock vs reserved, damaged and QC hold units; SKUs with zero AFS or under 3 days of cover.", input_schema: { type: "object", properties: {} } },
  {
    name: "query_table",
    description:
      "Filter and sort raw rows when the summaries are not enough. Tables and columns: " +
      "inventory(sku, category, zone, bin, on_hand, reserved, damaged, qc_hold, afs, cbm_per_unit, avg_daily_sales, last_movement); " +
      "inbound(asn, date, supplier, dock, expected_units, received_units, variance_units, status, arrived_late, dock_to_stock_hrs); " +
      "outbound(date, shift, caps_units, orders_received, units_shipped, shipments, backlog_units, missed_cutoff_orders, carrier_mix); " +
      "productivity(date, hour, process, headcount, labor_hours, units, picks, packages); zones(zone, type, bins, cbm).",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", enum: ["inventory", "inbound", "outbound", "productivity", "zones"] },
        filters: { type: "object", description: 'Exact matches like {"zone":"A-Shelving"} or ranges like {"afs":{"max":10}}.' },
        sort_by: { type: "string" },
        descending: { type: "boolean" },
        limit: { type: "integer", description: "Max rows returned (default 50, max 200)." },
      },
      required: ["table"],
    },
  },
];

const handlers = {
  get_overview: m.overview,
  get_outbound: m.outboundSummary,
  get_inbound: m.inboundSummary,
  get_productivity: m.productivitySummary,
  get_inventory: m.inventorySummary,
  get_afs: m.afsSummary,
  query_table: m.queryTable,
};

const system = `You are the assistant inside a warehouse control tower app. Answer questions about the warehouse using the tools, which read the app's live data. Never invent numbers; if the data doesn't cover a question, say so.

Data covers ${dates[0]} to ${dates.at(-1)}; "today" is ${dates.at(-1)}.
Definitions: caps = planned outbound capacity in units; caps attainment = units shipped / caps. TPH = units processed per labor hour. IPP = items per package (packed units / packages). AFS = available for sale = on hand - reserved - damaged - QC hold. Days of cover = AFS / average daily sales.

Lead with the answer, then the supporting numbers. Use short tables or bullets when comparing. Point out anything that looks off (low attainment, falling TPH, low cover) and suggest a next action when it helps.`;

// messages: [{ role: "user" | "assistant", content: string }]
export async function ask(messages) {
  const convo = messages.map((x) => ({ role: x.role, content: x.content }));
  const toolCalls = [];

  for (let turn = 0; turn < 10; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools,
      messages: convo,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return { answer: "I can't help with that request.", toolCalls };
    }
    convo.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    const uses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      const answer = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: answer || "(no answer)", toolCalls };
    }

    const results = uses.map((u) => {
      toolCalls.push({ name: u.name, input: u.input });
      try {
        const fn = handlers[u.name];
        if (!fn) throw new Error(`Unknown tool ${u.name}`);
        return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(fn(u.input || {})) };
      } catch (err) {
        return { type: "tool_result", tool_use_id: u.id, content: String(err.message || err), is_error: true };
      }
    });
    convo.push({ role: "user", content: results });
  }
  return { answer: "I ran out of steps before finishing. Try a narrower question.", toolCalls };
}
