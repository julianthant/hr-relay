import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { transformSync as transform } from "esbuild";

const cache = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const requiring = context.conditions.includes("require");
    const requested = !requiring && isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier;
    if ((requested.startsWith(".") || requested.startsWith("file:") || isAbsolute(requested)) && requested.endsWith(".js")) {
      const url = isAbsolute(requested) ? pathToFileURL(requested) : new URL(requested, context.parentURL);
      if (!existsSync(url)) {
        for (const extension of [".ts", ".tsx"]) {
          const source = new URL(url.href.replace(/\.js$/u, extension));
          if (existsSync(source)) return nextResolve(requiring ? fileURLToPath(source) : source.href, context);
        }
      }
    }
    return nextResolve(requested, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !/\.tsx?$/u.test(new URL(url).pathname)) return nextLoad(url, context);
    const source = readFileSync(new URL(url), "utf8");
    const loader = new URL(url).pathname.endsWith(".tsx") ? "tsx" : "ts";
    const hash = createHash("sha256").update(loader).update(source).digest("hex");
    const compiled = join(cache, `${hash}.js`);
    if (!existsSync(compiled)) {
      // Test-created sources join the same content cache without reusing stale scratch bytes.
      const { transformSync } = require("esbuild") as { transformSync: typeof transform };
      const output = transformSync(source, { loader, format: "esm", target: "node26", jsx: "automatic" });
      const pending = `${compiled}.${process.pid}`;
      writeFileSync(pending, output.code, { mode: 0o600 });
      renameSync(pending, compiled);
    }
    return { format: "module", source: readFileSync(compiled, "utf8"), shortCircuit: true };
  },
});
