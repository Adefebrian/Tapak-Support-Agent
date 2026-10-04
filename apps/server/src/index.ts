import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { createApp } from "./http/app.ts";
import { log } from "./observability/logger.ts";
import { makeDecision, makeLlm } from "./providers/factory.ts";
import { sweepExpired } from "./providers/runtime.ts";
import { Bm25Index } from "./retrieval/bm25.ts";
import { chunkDocs, loadKb } from "./retrieval/kb.ts";

if (!existsSync(config.dbPath)) {
  console.error(`database not found at ${config.dbPath}. Run: bun run setup`);
  process.exit(1);
}

const db = openDb();
const docs = loadKb(config.kbDir);
const index = new Bm25Index(chunkDocs(docs));
const llm = makeLlm();
const decision = makeDecision();
const app = createApp({ db, index, llm, decision, kb: docs });

// Static web client (built by apps/client/build.ts). SPA fallback to index.html.
app.get("*", async (c) => {
  const path = c.req.path;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return c.text("bad request", 400);
  }
  const target = resolve(config.publicDir, `.${decoded}`);
  // Never serve anything outside the public directory, whatever the encoding of the path.
  const inside = target.startsWith(config.publicDir + sep);
  const file = Bun.file(target);
  if (path !== "/" && inside && (await file.exists())) {
    const immutable = /\.[a-z0-9]{8}\.(js|css)$/.test(path);
    return new Response(file, {
      headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
    });
  }
  const html = Bun.file(resolve(config.publicDir, "index.html"));
  if (!(await html.exists())) return c.text("client not built. Run: bun run build", 503);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
});

// Live-mode keys expire after an hour; drop them from memory promptly.
setInterval(sweepExpired, 5 * 60 * 1000).unref();

Bun.serve({ port: config.port, fetch: app.fetch });
log("info", "server_started", {
  port: config.port,
  kb_docs: docs.length,
  llm: `${llm.name}:${llm.model}`,
  jev: decision.name,
});
console.log(`Tapak Support Agent on http://localhost:${config.port}`);
