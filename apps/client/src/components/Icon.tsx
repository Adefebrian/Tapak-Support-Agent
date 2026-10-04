// Minimal stroke icon set, 20px grid. Inline so the client has no icon dependency.
const PATHS: Record<string, string> = {
  shield: "M10 2.5 3.5 5v5c0 4 2.8 6.9 6.5 7.9 3.7-1 6.5-3.9 6.5-7.9V5L10 2.5Z",
  scale: "M10 3v14M5 17h10M3.5 7h13M6 7l-2.5 5a2.5 2.5 0 0 0 5 0L6 7Zm8 0-2.5 5a2.5 2.5 0 0 0 5 0L14 7Z",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm4.5-1.5L17 17",
  spark: "M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M5 5l2.5 2.5M12.5 12.5 15 15M15 5l-2.5 2.5M7.5 12.5 5 15",
  wrench:
    "M12.5 3.5a3.5 3.5 0 0 0-3.3 4.7L3.5 13.9a1.4 1.4 0 0 0 2 2l5.7-5.7a3.5 3.5 0 0 0 4.7-3.3l-2.1 2.1-2-.5-.5-2 2.2-2Z",
  check: "M4 10.5 8 14.5 16 5.5",
  send: "M3 10 17 3l-4 14-3-6-7-1Z",
  reply: "M8 5 3 10l5 5M3.5 10H12a5 5 0 0 1 5 5v1",
  user: "M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 7.5c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5",
  inbox: "M3 11h4l1.5 2.5h3L13 11h4M3 11l2-7h10l2 7v5H3v-5Z",
  settings:
    "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
  refresh: "M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3",
  plus: "M10 4v12M4 10h12",
  alert: "M10 3 2.5 16.5h15L10 3Zm0 5v4m0 2.5v.5",
  x: "M5 5l10 10M15 5 5 15",
};

export function Icon({
  name,
  size = 18,
  className,
}: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
