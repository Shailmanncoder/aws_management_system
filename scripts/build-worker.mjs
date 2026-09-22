// Bundles the background worker into dist/worker.mjs. Dependencies stay external (installed in
// the image); `server-only` is aliased to an empty module because the worker is server code.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: ["src/worker/index.ts"],
  outfile: "dist/worker.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
  alias: { "server-only": fileURLToPath(new URL("./server-only-stub.mjs", import.meta.url)) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
