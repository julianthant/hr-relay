import { vi } from "vitest";

// Reset module graphs around test-only substitutions; do not rewrite sources or replace production gates.
export async function withAuthorityBuildVariant(
  variant: "current-29" | "ddl-derived-layouts",
  run: () => Promise<void>,
): Promise<void> {
  vi.resetModules();
  vi.doMock("../../../src/backend/storage/sqlite/migrations.js", async () => {
    const actual = await vi.importActual<typeof import("../../../src/backend/storage/sqlite/migrations.js")>(
      "../../../src/backend/storage/sqlite/migrations.js",
    );
    if (variant === "current-29") {
      // The database fixture remains real v30. Only this isolated build's
      // supported version becomes 29; #admitExistingSchema remains real.
      return { ...actual, CURRENT_AUTHORITY_SCHEMA_VERSION: 29 };
    }

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
    vi.doUnmock("../../../src/backend/storage/sqlite/migrations.js");
    vi.resetModules();
  }
}
