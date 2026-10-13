# Warehouse Control Tower

A dashboard for one fulfillment center, with an AI assistant that answers questions from the app's own data.

**Modules:** Overview, Inbound, Outbound, Inventory (storage areas), AFS, Productivity.

**Metrics included**
- Outbound: caps vs actual shipped, caps attainment %, backlog, missed cutoffs, by day and shift
- Inbound: ASNs, expected vs received, receipt accuracy, late arrivals, dock-to-stock hours, supplier scorecard, open ASNs
- Productivity: TPH (units per labor hour) per process, IPP (items per package), units per pick, hourly TPH
- Inventory: on hand, bin and CBM utilisation per storage zone, stock by category
- AFS: available for sale vs reserved / damaged / QC hold, zero-AFS SKUs, SKUs under 3 days of cover

**AI assistant:** the chat panel sends your question to Claude with tools that call the same metric functions as the dashboard (plus a raw-table filter), so answers are built from app data rather than guessed.

## Run

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # needed for the chat panel only
npm start                             # http://localhost:3000
```

## Using your real data

All data is generated in `src/data.js` (seeded demo data, 14 days). Replace those arrays with reads from your WMS/OMS/TMS or a database, keeping the same columns, and the dashboard and assistant work unchanged.

| File | Purpose |
|---|---|
| `src/data.js` | Data tables (swap for real sources) |
| `src/metrics.js` | KPI calculations shared by the dashboard and the assistant |
| `src/agent.js` | Claude tool-use loop and tool definitions |
| `server.js` | Express API + static files |
| `public/index.html` | Dashboard UI and chat |
