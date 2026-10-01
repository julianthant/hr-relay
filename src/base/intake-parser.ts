import type { ArtifactRef } from "../domain/artifacts.js";

/**
 * Ref data-intake-and-edit-data §2.2's re-derivation seam (D170).
 *
 * Rows and detected columns are a pure function of the immutable artifact plus
 * the sheet/header selection, so the kernel re-derives them instead of reading
 * a stored copy — but it cannot import a spreadsheet parser (that lives in
 * `src/stores/**`, which the kernel may not reach) and its authority transaction is
 * synchronous, so the parse is PREPARED by the caller and read back here by the
 * exact key the CURRENT session names. A key nobody prepared throws: the kernel
 * never binds a column against a guessed layout.
 */
export interface IntakeParser {
  parse(request: Readonly<{ artifact: ArtifactRef; sheet: string; headerRowIndex: number | null }>): unknown;
}
