import { z } from "zod";
import {
  declareDriver,
  declareDriverFor,
  defineBrowserStore,
} from "../../src/workflow-kit/task-registry.js";
import { defineUnwiredSessionProvider } from "../../src/workflow-kit/session.js";
import type { CommitTaskCtx, ReadTaskCtx } from "../../src/workflow-kit/task.js";
import { defineTask, taskFailer } from "../../src/workflow-kit/task.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../src/models/task/task-contract.js";
import { EidSchema, ObservationIdSchema, ScenarioIdSchema, taskId } from "../../src/rules/identity/ids.js";
import {
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../src/models/ui/ucpath-person-org.js";
import type { UcpathPersonOrgDriver } from "../../src/models/ui/ucpath-person-org.js";

// @ts-expect-error browser task contexts reject service-system drivers
export type InvalidBrowserTaskContext = ReadTaskCtx<{ readonly system: "extraction" }, readonly ["invalid"]>;

const input = z.strictObject({ eid: EidSchema });
const output = z.strictObject({ eid: EidSchema });
const contract = defineTaskContract({
  id: taskId("ucpath/search-person-org"),
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

const typedUcpathDriver = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");

export const typedReadTask = defineTask(typedUcpathDriver, contract, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ ctx }) {
    await ctx.driver.goto(UCPATH_PERSON_ORG_SEARCH_SCREEN);
    return { eid: await ctx.driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID) };
  },
});

// @ts-expect-error read task implementations cannot request transaction access
defineTask(typedUcpathDriver, contract, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input }) {
    return input;
  },
});

const crmDriver = declareDriver("crm", "unwired");
// @ts-expect-error a UCPath task cannot bind a CRM driver
defineTask(crmDriver, contract, typedReadTask.impl);

const systemOnlyUcpathDriver = declareDriver("ucpath", "unwired");
const ucpathSession = defineUnwiredSessionProvider("ucpath");
// @ts-expect-error a task bound to the concrete semantic driver cannot enter a different driver store
defineBrowserStore("ucpath", systemOnlyUcpathDriver, ucpathSession, { typedReadTask });

// @ts-expect-error browser tasks require an explicit typed driver binding
defineTask(contract, typedReadTask.impl);

const providerContract = defineTaskContract({
  id: taskId("ocr/read-provider-fixture"),
  title: "Read provider fixture",
  effect: "read",
  input: z.strictObject({}),
  output: z.strictObject({ value: z.string() }),
  errorCodes: ["provider-unavailable"] as const,
  providers: ["ocr.extract"] as const,
  subject: { kind: "none", reason: "provider type fixture" },
  scenarios: [ScenarioIdSchema.parse("ocr/provider-fixture-happy")],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "derived" },
  example: { value: "fixture" },
});

export const typedProviderTask = defineTask(providerContract, {
  sessions: [],
  async run({ ctx }) {
    void ctx.providers["ocr.extract"];
    // @ts-expect-error service tasks do not receive a browser driver
    void ctx.driver;
    // @ts-expect-error provider clients are narrowed to the declared capability
    void ctx.providers["ai.advisory"];
    return { value: "fixture" };
  },
});

// @ts-expect-error service tasks cannot bind a browser driver
defineTask(typedUcpathDriver, providerContract, typedProviderTask.impl);
