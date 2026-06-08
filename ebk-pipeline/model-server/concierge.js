/**
 * Concierge AI server — runs on the DGX. OFF THE CRITICAL PATH.
 * The lead pipeline works fully without this. This is Phase 2 of the business:
 * parsing caller replies (YES/NO), drafting follow-ups, enriching leads.
 *
 * It talks to a LOCAL model (Ollama or vLLM) — NO Claude API, no LLM bill.
 * Set MODEL_BASE_URL to your local server, e.g. http://localhost:11434 (Ollama).
 *
 * Start: node model-server/concierge.js
 */
import http from "node:http";

const PORT = Number(process.env.CONCIERGE_PORT || 8090);
const MODEL_BASE = process.env.MODEL_BASE_URL || "http://localhost:11434";
const MODEL_NAME = process.env.MODEL_NAME || "llama3.1:8b";

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
  catch { return {}; }
}

// Generic local-model call (Ollama /api/generate shape; adapt for vLLM if needed).
async function ask(prompt) {
  const res = await fetch(`${MODEL_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL_NAME, prompt, stream: false }),
  });
  if (!res.ok) throw new Error("local model error " + res.status);
  const data = await res.json();
  return data.response ?? "";
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      // probe the local model
      let modelUp = false;
      try { await fetch(`${MODEL_BASE}/api/tags`); modelUp = true; } catch {}
      return json(res, 200, { ok: true, model_base: MODEL_BASE, model: MODEL_NAME, model_up: modelUp });
    }

    // Parse a caller's free-text reply into a structured outcome.
    if (req.method === "POST" && req.url === "/parse-reply") {
      const { reply } = await body(req);
      const prompt =
        "You are a sales-ops assistant. Read this caller note and reply with ONLY a JSON " +
        'object: {"outcome": one of [yes_paid,yes_pending,callback,not_interested,no_answer,wrong_number], ' +
        '"follow_up": ISO date or null, "summary": one short sentence}. Note: ' + JSON.stringify(reply || "");
      const out = await ask(prompt);
      let parsed; try { parsed = JSON.parse(out.replace(/```json|```/g, "").trim()); }
      catch { parsed = { outcome: "no_answer", follow_up: null, summary: out.slice(0, 140) }; }
      return json(res, 200, parsed);
    }

    // Draft a follow-up text for a lead.
    if (req.method === "POST" && req.url === "/draft-followup") {
      const { name, context } = await body(req);
      const prompt =
        `Write a short, friendly follow-up text to ${name || "the owner"} about building their ` +
        `$500 website. One or two sentences, casual, no emojis. Context: ${context || "left a voicemail"}.`;
      return json(res, 200, { draft: (await ask(prompt)).trim() });
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e.message) });
  }
});

server.listen(PORT, () => {
  console.log(`[concierge] listening on :${PORT}  | model: ${MODEL_NAME} @ ${MODEL_BASE}`);
  console.log("[concierge] off critical path — pipeline runs without this.");
});
