// PII redaction applied before anything is written to logs, traces, or the messages table.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Indonesian and international phone shapes: +62 812-1111-0001, 0812 1111 0001, 081211110001.
// Must start with "+" or "0" and must not be glued to letters, so carrier tracking numbers such as
// JNE7700100001 are not mistaken for phones (defect D-01).
const PHONE = /(?<![A-Za-z0-9])(?:\+\d{1,3}[\s-]?\d{2,4}|0\d{2,4})[\s-]?\d{3,4}[\s-]?\d{3,5}\b/g;
// Street addresses: "Jl." / "Jalan" followed by a name and a number.
const ADDRESS = /\b(?:Jl\.?|Jalan)\s+[A-Za-z .'-]{2,40}\s+\d{1,4}[A-Za-z]?(?:,\s*[A-Za-z .]{2,40})*/g;
// Order IDs are not PII and must stay readable in traces.
const ORDER_ID = /\bTPK-\d{5}\b/g;

export function redact(text: string): string {
  const keep: string[] = [];
  const masked = text.replace(ORDER_ID, (m) => {
    keep.push(m);
    return `\uE000${keep.length - 1}\uE000`;
  });
  return masked
    .replace(EMAIL, "[email]")
    .replace(ADDRESS, "[address]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m))
    .replace(/\uE000(\d+)\uE000/g, (_, i) => keep[Number(i)] ?? "");
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}

export function containsPii(text: string): boolean {
  return redact(text) !== text;
}
