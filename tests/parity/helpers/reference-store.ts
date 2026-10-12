
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
  /** which adapter produced the data — "fixture" or "seeded" (ref frontend-backend-integration ) */
  readonly adapter: string;
  readonly fixtureId: string;
  readonly descriptorHash: string;
  readonly appVersion: string;
  readonly capturedAt: string;
  /** keyboard-only / reduced-motion variants (ref frontend-backend-integration ) */
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
