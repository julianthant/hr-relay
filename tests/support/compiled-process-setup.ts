import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function prepareTestProcesses(directory: string): Promise<string> {
  if (process.env.RELAY_TEST_PROCESS_IMPORT !== undefined) return process.env.RELAY_TEST_PROCESS_IMPORT;
  const root = resolve(import.meta.dirname, "../..");
  const cache = join(directory, "compiled-processes");
  mkdirSync(cache, { mode: 0o700 });
  symlinkSync(join(root, "node_modules"), join(cache, "node_modules"), "junction");
  const files = globSync(["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "tests/support/**/*.ts"], { cwd: root })
    .filter(file => !file.endsWith(".d.ts") && !file.endsWith(".test.ts"));
  const snapshots = new Map(files.map(file => [file, readFileSync(join(root, file), "utf8")]));
  const result = await build({
    absWorkingDir: root, entryPoints: files, outbase: root, outdir: join(cache, "output"),
    bundle: false, platform: "node", format: "esm", target: "node26", write: false,
    plugins: [{ name: "test-process-snapshot", setup(builder) {
      builder.onLoad({ filter: /\.tsx?$/ }, ({ path }) => {
        const contents = snapshots.get(relative(root, path));
        if (contents === undefined) throw new Error(`test-process-precompile-source-unknown: ${path}`);
        return { contents, loader: path.endsWith(".tsx") ? "tsx" : "ts" };
      });
    } }],
  });
  const sources = new Map([...snapshots].map(([file, contents]) => [file.replace(/\.tsx?$/u, ".js"), { file, contents }]));
  for (const output of result.outputFiles) {
    const source = sources.get(relative(join(cache, "output"), output.path));
    if (source === undefined) throw new Error(`test-process-precompile-output-unknown: ${output.path}`);
    const { file, contents } = source;
    const hash = createHash("sha256").update(file.endsWith(".tsx") ? "tsx" : "ts")
      .update(contents).digest("hex");
    writeFileSync(join(cache, `${hash}.js`), output.contents, { mode: 0o600 });
    if (join(root, file) === fileURLToPath(new URL("./compiled-process-loader.ts", import.meta.url))) {
      writeFileSync(join(cache, "test-process-loader.mjs"), output.contents, { mode: 0o600 });
    }
  }
  const loader = pathToFileURL(join(cache, "test-process-loader.mjs")).href;
  process.env.RELAY_TEST_PROCESS_IMPORT = loader;
  return loader;
}
