import express from "express";
import * as m from "./src/metrics.js";
import { ask } from "./src/agent.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use("/vendor", express.static("node_modules/chart.js/dist"));

const q = (req) => ({ from: req.query.from, to: req.query.to });
app.get("/api/overview", (req, res) => res.json(m.overview(q(req))));
app.get("/api/outbound", (req, res) => res.json(m.outboundSummary(q(req))));
app.get("/api/inbound", (req, res) => res.json(m.inboundSummary(q(req))));
app.get("/api/productivity", (req, res) => res.json(m.productivitySummary(q(req))));
app.get("/api/inventory", (req, res) => res.json(m.inventorySummary()));
app.get("/api/afs", (req, res) => res.json(m.afsSummary()));

app.post("/api/chat", async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "messages required" });
  try {
    res.json(await ask(messages));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.status === 401 || /authentication method/.test(err.message) ? "Claude API key missing or invalid. Set ANTHROPIC_API_KEY." : String(err.message || err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Control tower running on http://localhost:${port}`));
