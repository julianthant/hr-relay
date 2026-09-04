import { vi } from "vitest";

/**
 * D332 M9/M21 test-only build substitutions. No source file is rewritten and
 * no production gate is replaced. Reset the module graph on both sides so
 * the substituted build constants cannot escape the awaited callback.
 */
export async function withAuthorityBuildVariant(
  variant: "current-29" | "ddl-derived-layouts",
  run: () => Promise<void>,
): Promise<void> {
  vi.resetModules();
  vi.doMock("../../../src/infra/sqlite/migrations.js", async () => {
    const actual = await vi.importActual<typeof import("../../../src/infra/sqlite/migrations.js")>(
      "../../../src/infra/sqlite/migrations.js",
    );
    if (variant === "current-29") {
      // The database fixture remains real v30. Only this isolated build's
      // supported version becomes 29; #admitExistingSchema remains real.
      return { ...actual, CURRENT_AUTHORITY_SCHEMA_VERSION: 29 };
    }
    // Deliberately restore the unsafe derivation from today's DDL. The
    // positive admission oracle must reject this build for every old layout.
    const all = Object.keys(actual.SQLITE_TABLE_DDL).sort();
    const retired = new Set(["capture_sessions", "capture_photo_order", "capture_finalization_outboxes"]);
    const afterRetirement = all.filter((name) => !retired.has(name));
    return {
      ...actual,
      INTEGRATED_AUTHORITY_TABLES_BY_VERSION: { 27: all, 28: afterRetirement, 29: afterRetirement },
    };
  });
  try {
    await run();
  } finally {
    vi.doUnmock("../../../src/infra/sqlite/migrations.js");
    vi.resetModules();
  }
}
