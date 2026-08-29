import {
  optionalTestTargetSecret,
  TestTargetSecretReferenceSchema,
  type TestTargetSecretReference,
} from "../src/domain/secrets.js";

type PersonSecretField = "employeeName" | "emplId" | "timekeeperName";
type PersonSecretRow = Readonly<{
  field: PersonSecretField;
  reference: TestTargetSecretReference;
}>;

export interface TestTargetPersonSecretsSmokeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly loadCommittedRows?: () => Promise<readonly PersonSecretRow[]>;
  readonly writeLine?: (line: string) => void;
}

async function committedRows(): Promise<readonly PersonSecretRow[]> {
  const { FINALIZATION_WORKFLOW, TEST_TARGET_REGISTRY } = await import(
    "../src/control/test-target-registry.js"
  );
  const target = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === "finalization-canary");
  const arm = target?.workflows[FINALIZATION_WORKFLOW];
  if (arm === undefined) throw new Error("the committed finalization-canary has no finalization arm");
  return [
    { field: "employeeName", reference: TestTargetSecretReferenceSchema.parse(arm.secretInput.employeeName) },
    { field: "emplId", reference: TestTargetSecretReferenceSchema.parse(arm.secretInput.emplId) },
    { field: "timekeeperName", reference: TestTargetSecretReferenceSchema.parse(arm.secretInput.timekeeperName) },
  ];
}

function lineFor(
  row: PersonSecretRow,
  state: "present" | "refused",
): string {
  return `field=${row.field} reference=${row.reference.name} env=${row.reference.env} state=${state}`;
}

/**
 * Read-only pre-② preflight for the committed canary's three person values.
 * The workflow resolver is deliberately absent: its truthful pending leaves
 * block a run before secret access, while this command exists to validate the
 * ignored local values themselves. Output is closed to public metadata + state.
 */
export async function runTestTargetPersonSecretsSmoke(
  options: TestTargetPersonSecretsSmokeOptions = {},
): Promise<number> {
  const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  let rows: readonly PersonSecretRow[];
  try {
    rows = await (options.loadCommittedRows ?? committedRows)();
  } catch {
    throw new Error("committed person-secret registry unavailable");
  }

  let refused = false;
  for (const row of rows) {
    let state: "present" | "refused" = "refused";
    try {
      const reference = TestTargetSecretReferenceSchema.parse(row.reference);
      state = optionalTestTargetSecret(reference.name, options.env) === undefined ? "refused" : "present";
    } catch {
      // Refusal is the command's explicit, nonzero failure arm. It carries no
      // caught message because secret-source errors may never widen this output.
    }
    if (state === "refused") refused = true;
    writeLine(lineFor(row, state));
  }
  return refused ? 1 : 0;
}
