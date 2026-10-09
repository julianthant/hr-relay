import type { ArtifactRef } from "../models/artifacts/artifacts.js";

// Keep spreadsheet parsing outside the kernel; unprepared session keys refuse.
export interface IntakeParser {
  parse(request: Readonly<{ artifact: ArtifactRef; sheet: string; headerRowIndex: number | null }>): unknown;
}
