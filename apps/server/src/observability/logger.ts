import { redactDeep } from "./redact.ts";

type Level = "debug" | "info" | "warn" | "error";
let silent = process.env.NODE_ENV === "test";

export function setLogSilent(v: boolean): void {
  silent = v;
}

// Structured JSON to stdout. Every field passes through PII redaction.
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (silent) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redactDeep(fields) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}
