/**
 * Doc 13 §7.1 — the stored a11y snapshot is an EXPECTATION, not a log.
 *
 * "A screenshot without the matching a11y snapshot is incomplete." The lane
 * used to honour half of that: the `.png` went through Playwright's baseline
 * comparison, while the `.a11y.yml` and `.meta.json` beside it were rewritten
 * unconditionally on every run. An accessibility-only regression therefore
 * rewrote its own expectation and the lane stayed green — 56 references
 * rewritten, zero screenshots changed, all tests passing. A check that cannot
 * fail is worse than no check, because it reads as coverage.
 *
 * So references are COMPARED here, byte for byte, and a mismatch fails with a
 * diff naming the reference, its viewport, theme, fixture id and variant.
 * Refreshing them is a deliberate act: `npm run test:parity:update`, which sets
 * PARITY_UPDATE=1 — the same switch the config hands to Playwright's own
 * `updateSnapshots`, so the pixel and the semantic halves of a pair can never
 * be refreshed independently.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The one documented way to re-freeze the reference set. */
export const PARITY_UPDATE_COMMAND = "npm run test:parity:update";

export interface CaptureMetadata {
  /** the state being captured, e.g. "queue-all-statuses" */
  readonly stateId: string;
  readonly viewport: string;
  readonly theme: string;
  /** which adapter produced the data — "fixture" or "seeded" (doc 13 §7.2) */
  readonly adapter: string;
  readonly fixtureId: string;
  readonly descriptorHash: string;
  readonly appVersion: string;
  readonly capturedAt: string;
  /** keyboard-only / reduced-motion variants (doc 13 §7.1) */
  readonly variant: string;
}

export function captureName(input: Readonly<{
  stateId: string;
  viewport: string;
  theme: string;
  variant?: string;
}>): string {
  const variant = input.variant === undefined || input.variant === "default" ? "" : `--${input.variant}`;
  return `${input.stateId}--${input.theme}--${input.viewport}${variant}`;
}

/**
 * Update mode, read from ONE place.
 *
 * An unrecognised value throws rather than being read as "off": a typo'd
 * `PARITY_UPDATE=yes` that silently asserted instead of refreshing would send
 * an operator chasing a diff they had already decided to accept.
 */
export function parityUpdateRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PARITY_UPDATE;
  if (raw === undefined || raw.trim() === "" || raw === "0") return false;
  if (raw === "1") return true;
  throw new Error(`PARITY_UPDATE must be "1" (refresh) or unset/"0" (assert); got ${JSON.stringify(raw)}`);
}

/* ── rendering ───────────────────────────────────────────────────────────── */

/** The exact stored form of an a11y reference: provenance header + tree. */
export function renderA11yReference(tree: string, metadata: CaptureMetadata): string {
  const name = captureName(metadata);
  return [
    `# ${name}`,
    `# adapter: ${metadata.adapter}`,
    `# fixture: ${metadata.fixtureId}`,
    `# descriptorHash: ${metadata.descriptorHash}`,
    `# appVersion: ${metadata.appVersion}`,
    `# viewport: ${metadata.viewport}  theme: ${metadata.theme}  variant: ${metadata.variant}`,
    `# capturedAt: ${metadata.capturedAt}`,
    "",
    tree,
    "",
  ].join("\n");
}

export function renderMetadataReference(metadata: CaptureMetadata): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

/* ── comparison ──────────────────────────────────────────────────────────── */

const MAX_REPORTED_DIFFERENCES = 6;

function describeDifferences(reference: string, actual: string): string[] {
  const expectedLines = reference.split("\n");
  const actualLines = actual.split("\n");
  const lines: string[] = [];
  let reported = 0;
  for (let index = 0; index < Math.max(expectedLines.length, actualLines.length); index += 1) {
    if (expectedLines[index] === actualLines[index]) continue;
    reported += 1;
    if (reported > MAX_REPORTED_DIFFERENCES) {
      lines.push("  … further differences suppressed");
      break;
    }
    lines.push(`  line ${String(index + 1)}:`);
    lines.push(`    reference: ${expectedLines[index] ?? "<end of file>"}`);
    lines.push(`    actual:    ${actualLines[index] ?? "<end of file>"}`);
  }
  return lines;
}

function identity(metadata: CaptureMetadata): string {
  return `fixture: ${metadata.fixtureId}  theme: ${metadata.theme}  viewport: ${metadata.viewport}  variant: ${metadata.variant}  adapter: ${metadata.adapter}`;
}

export interface ReferenceComparison {
  readonly path: string;
  readonly kind: string;
  readonly metadata: CaptureMetadata;
  readonly actual: string;
}

/**
 * Asserts one stored reference file against freshly captured content, or —
 * only under an explicit update request — rewrites it.
 */
export function assertOrUpdateReferenceFile(
  input: ReferenceComparison & { readonly update: boolean },
): void {
  if (input.update) {
    mkdirSync(dirname(input.path), { recursive: true });
    writeFileSync(input.path, input.actual);
    return;
  }

  const name = captureName(input.metadata);
  if (!existsSync(input.path)) {
    throw new Error(
      [
        `no stored ${input.kind} reference for ${name}`,
        `  ${identity(input.metadata)}`,
        `  expected file: ${input.path}`,
        `Mint it deliberately with: ${PARITY_UPDATE_COMMAND}`,
      ].join("\n"),
    );
  }

  const stored = readFileSync(input.path, "utf8");
  if (stored === input.actual) return;

  throw new Error(
    [
      `${input.kind} reference drift: ${name}`,
      `  ${identity(input.metadata)}`,
      `  reference: ${input.path}`,
      ...describeDifferences(stored, input.actual),
      "The stored reference is the reviewed expectation, not a record of current",
      `behaviour. If this change is intended, refresh it deliberately: ${PARITY_UPDATE_COMMAND}`,
    ].join("\n"),
  );
}

/**
 * The whole semantic half of a capture pair: the a11y tree and the provenance
 * record, both asserted (or both refreshed) together.
 */
export function assertOrUpdateParityReference(input: Readonly<{
  referencesDir: string;
  tree: string;
  metadata: CaptureMetadata;
  update?: boolean;
}>): void {
  const update = input.update ?? parityUpdateRequested();
  const name = captureName(input.metadata);
  assertOrUpdateReferenceFile({
    path: join(input.referencesDir, `${name}.a11y.yml`),
    kind: "a11y",
    metadata: input.metadata,
    actual: renderA11yReference(input.tree, input.metadata),
    update,
  });
  assertOrUpdateReferenceFile({
    path: join(input.referencesDir, `${name}.meta.json`),
    kind: "metadata",
    metadata: input.metadata,
    actual: renderMetadataReference(input.metadata),
    update,
  });
}
