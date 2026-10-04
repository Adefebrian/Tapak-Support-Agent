// Bun.build for the web client (JAL rule: no Vite). Output goes to apps/server/public, served by Hono,
// and is the same bundle Tauri wraps for desktop and Android.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { LOGO_URI } from "./src/components/Brand.tsx";

const out = resolve(import.meta.dir, "../server/public");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/main.tsx")],
  outdir: out,
  minify: true,
  sourcemap: "linked",
  naming: { entry: "[name].[hash].[ext]", chunk: "[name].[hash].[ext]", asset: "[name].[hash].[ext]" },
  define: { "process.env.NODE_ENV": '"production"' },
});

if (!result.success) {
  for (const l of result.logs) console.error(l);
  process.exit(1);
}

const js = result.outputs.find((o) => o.kind === "entry-point")!;
const css = result.outputs.filter((o) => o.path.endsWith(".css"));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#ffffff" />
<title>Tapak Support</title>
<link rel="icon" href="${LOGO_URI}" />
${css.map((c) => `<link rel="stylesheet" href="/${basename(c.path)}" />`).join("\n")}
</head>
<body>
<div id="root"></div>
<script type="module" src="/${basename(js.path)}"></script>
</body>
</html>
`;
writeFileSync(resolve(out, "index.html"), html);
console.log(`client built: ${basename(js.path)} ${css.map((c) => basename(c.path)).join(" ")}`);
