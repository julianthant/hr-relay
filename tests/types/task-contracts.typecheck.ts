import { z } from "zod";
import type { CommitTaskCtx, ReadTaskCtx } from "../../src/base/task.js";
import { taskFailer } from "../../src/base/task.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../src/domain/contracts/base.js";
import { EidSchema, ObservationIdSchema, ScenarioIdSchema, TaskIdSchema } from "../../src/domain/ids.js";
import type { UcpathPersonOrgDriver } from "../../src/domain/ui/ucpath-person-org.js";

// @ts-expect-error browser task contexts reject service-system drivers
export type InvalidBrowserTaskContext = ReadTaskCtx<{ readonly system: "extraction" }, readonly ["invalid"]>;

const input = z.strictObject({ eid: EidSchema });
const output = z.strictObject({ eid: EidSchema });
const contract = defineTaskContract({
  id: TaskIdSchema.parse("ucpath/search-person-org"),
  title: "Search Person Org",
  effect: "read",
  input,
  output,
  errorCodes: ["eid-not-found"] as const,
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
    observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  scenarios: [ScenarioIdSchema.parse("ucpath/person-org-happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { eid: "10800000" },
});

const fail = taskFailer(contract);
export function typecheckTaskContexts(
  readCtx: ReadTaskCtx<UcpathPersonOrgDriver, typeof contract.errorCodes>,
  commitCtx: CommitTaskCtx<UcpathPersonOrgDriver, typeof contract.errorCodes>,
): void {
  fail("eid-not-found", "expected type fixture");
  // @ts-expect-error undeclared task error codes must not compile
  fail("invented-code", "must fail typecheck");
  void readCtx.driver;
  void commitCtx.mutation;
  // @ts-expect-error read contexts cannot acquire mutation capability
  void readCtx.mutation;
}

// @ts-expect-error z.any cannot be a canonical task output schema
defineTaskContract({ ...contract, output: z.any(), example: "unsafe" });

// @ts-expect-error z.unknown cannot be a canonical task output schema
defineTaskContract({ ...contract, output: z.unknown(), example: "unsafe" });
