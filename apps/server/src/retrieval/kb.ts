import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type KbDoc = {
  id: string;
  title: string;
  updated_at: string;
  status: "current" | "superseded";
  body: string;
};
export type Chunk = { chunkId: string; docId: string; title: string; text: string; superseded: boolean };

function parseFrontmatter(raw: string, file: string): KbDoc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`kb file ${file} has no frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.id || !meta.title || !meta.updated_at)
    throw new Error(`kb file ${file} missing id/title/updated_at`);
  return {
    id: meta.id,
    title: meta.title,
    updated_at: meta.updated_at,
    status: meta.status === "superseded" ? "superseded" : "current",
    body: m[2]!.trim(),
  };
}

export function loadKb(dir: string): KbDoc[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const docs = files.map((f) => parseFrontmatter(readFileSync(join(dir, f), "utf8"), f));
  const ids = new Set<string>();
  for (const d of docs) {
    if (ids.has(d.id)) throw new Error(`duplicate kb id ${d.id}`);
    ids.add(d.id);
  }
  return docs;
}

// Document-level chunks: every KB page is short, and paragraph chunks let a stray "To start a return"
// paragraph outrank the paragraph holding the actual rule (defect D-02). Long docs split by section.
const MAX_WORDS = 250;

export function chunkDocs(docs: KbDoc[]): Chunk[] {
  const out: Chunk[] = [];
  for (const d of docs) {
    const body = d.body.replace(/^#\s.*\n+/, "").trim();
    const sections = body.split(/\n(?=##\s)/);
    const pieces = body.split(/\s+/).length <= MAX_WORDS ? [body] : sections;
    pieces.forEach((p, i) => {
      out.push({
        chunkId: `${d.id}#${i}`,
        docId: d.id,
        title: d.title,
        text: `${d.title}. ${p.trim()}`,
        superseded: d.status === "superseded",
      });
    });
  }
  return out;
}
