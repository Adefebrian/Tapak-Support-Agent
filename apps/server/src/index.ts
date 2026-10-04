import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { createApp } from "./http/app.ts";
import { log } from "./observability/logger.ts";
import { makeDecision, makeLlm } from "./providers/factory.ts";
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
const app = createApp({ db, index, llm, decision });

// Static web client (built by apps/client/build.ts). SPA fallback to index.html.
app.get("*", async (c) => {
  const path = normalize(c.req.path).replace(/^(\.\.[/\\])+/, "");
  const file = Bun.file(join(config.publicDir, path === "/" ? "index.html" : path));
  if (path !== "/" && (await file.exists())) {
    const immutable = /\.[a-f0-9]{8,}\.(js|css)$/.test(path);
    return new Response(file, { headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" } });
  }
  const html = Bun.file(join(config.publicDir, "index.html"));
  if (!(await html.exists())) return c.text("client not built. Run: bun run build", 503);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
});

Bun.serve({ port: config.port, fetch: app.fetch });
log("info", "server_started", { port: config.port, kb_docs: docs.length, llm: `${llm.name}:${llm.model}`, jev: decision.name });
console.log(`Tapak Support Agent on http://localhost:${config.port}`);
