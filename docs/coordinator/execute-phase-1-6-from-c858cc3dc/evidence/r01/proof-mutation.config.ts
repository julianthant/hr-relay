// R01 evidence-only negative-control runner. Loaded only by an explicit
// --config invocation; transforms exist only in Vite's in-memory test graph.
import baseline from "../../../../../vitest.config.ts";

export function proofMutationConfig(mutation: string) {
const allowed = new Set([
  "m9-settings-open", "m9-settings-read", "m9-resolver", "m9-lock-release",
  "m21-live-ddl", "m21-extra-table", "m21-control-neutralized",
]);
if (!allowed.has(mutation)) throw new Error("Configuration must name one registered R01 proof control");

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`control ${mutation}: expected exactly one anchor ${before}`);
  return source.replace(before, after);
}

return {
  ...baseline,
  plugins: [{
    name: "r01-explicit-proof-negative-control",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      const path = id.split("?")[0];
      let changed: string | undefined;
      if (path.endsWith("/src/server/dashboard/compose.ts")) {
        const anchor = "  const database = (() => {";
        if (mutation === "m9-settings-open") changed = replaceOnce(source, anchor,
          '  closeSync(openSync(join(stateRoot, "settings.json"), "r"));\n' + anchor);
        if (mutation === "m9-settings-read") changed = replaceOnce(source, anchor,
          '  readFileSync(join(stateRoot, "settings.json"), "utf8");\n' + anchor);
        if (mutation === "m9-resolver") changed = replaceOnce(source, anchor,
          "  resolveConfigWithProvenance(env, {}, clock);\n" + anchor);
        if (mutation === "m9-lock-release") changed = replaceOnce(source,
          "} catch (openError) {\n      try {\n        processLock.release();",
          "} catch (openError) {\n      try {\n        /* negative control: omit release */");
      }
      if (mutation === "m21-live-ddl" && path.endsWith("/src/infra/sqlite/migrations.ts")) {
        const start = source.indexOf("export const INTEGRATED_AUTHORITY_TABLES_BY_VERSION = deepFreeze({");
        const end = source.indexOf("export const SQLITE_MIGRATIONS", start);
        if (start < 0 || end < 0) throw new Error("live-DDL control requires both migration anchors");
        changed = source.slice(0, start) + `export const INTEGRATED_AUTHORITY_TABLES_BY_VERSION = {
          27: Object.keys(SQLITE_TABLE_DDL).sort(),
          28: Object.keys(SQLITE_TABLE_DDL).filter(name => !name.startsWith("capture_")).sort(),
          29: Object.keys(SQLITE_TABLE_DDL).filter(name => !name.startsWith("capture_")).sort(),
        };\n\n` + source.slice(end);
      }
      if (mutation === "m21-extra-table" && path.endsWith("/src/infra/sqlite/authority-database.ts")) {
        changed = replaceOnce(source, "if (isExactIntegrated) return userVersion;",
          "if (isExactIntegrated || userVersion === 29) return userVersion;");
        const validator = changed.indexOf("\n  #validateReadOnlyNoMigrateDatabase(");
        if (validator < 0) throw new Error("extra-table control requires read-only validator anchor");
        changed = changed.slice(0, validator) + replaceOnce(changed.slice(validator),
          "if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {",
          "if (schemaVersion !== 29 && (names.length !== expected.length || expected.some((name, index) => names[index] !== name))) {");
      }
      if (mutation === "m21-control-neutralized" && path.endsWith("/tests/unit/fixtures/authority-build-variant.ts")) {
        changed = replaceOnce(source, "const all = Object.keys(actual.SQLITE_TABLE_DDL).sort();",
          "return actual;\n    const all = Object.keys(actual.SQLITE_TABLE_DDL).sort();");
      }
      if (changed === undefined) return undefined;
      console.error(`R01 proof control applied: ${mutation}: ${path}`);
      return { code: changed, map: null };
    },
  }],
};
}
