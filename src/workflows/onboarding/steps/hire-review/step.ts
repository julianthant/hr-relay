import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingReadI9ProfilePlan } from "../../../../models/workflows/onboarding/read-i9-profile-plan.js";
import { OnboardingReadWritePlan, OnboardingWriteApprovalSchema, ONBOARDING_WRITE_REVIEW_GATE } from "../../../../models/workflows/onboarding/read-write-plan.js";
import { OnboardingResultSchema } from "../../../../models/workflows/onboarding/result.js";
import { I9CreateProfile } from "../../../../models/systems/i9/create-profile.js";
import { I9StageProfile } from "../../../../models/systems/i9/stage-profile.js";
import { I9CreateRemoteRecord } from "../../../../models/systems/i9/create-remote-record.js";
import { I9StageRemoteRecord } from "../../../../models/systems/i9/stage-remote-record.js";
import { I9ProfileTargetSchema, I9RemoteProofSchema } from "../../../../models/ui/i9-creation.js";
import { UcpathStageHire, UcpathCreateHire, UcpathReadHireFindings, UcpathReadHireReceipt } from "../../../../models/systems/ucpath/hire-tasks.js";
import { ReadWorkbookResult } from "../../../../models/processing/workbooks/read-result.js";
import { DRY_RUN_I9_PROFILE_ID, DryRunSampleSchema, type DryRunScope } from "../../../../models/workflow/dry-run.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { onboardingMasterResults } from "../../../../rules/onboarding/master-results.js";
import { buildCrmData } from "../crm-data/step.js";
import { buildUcpathSearch } from "../ucpath-search/step.js";
import { buildI9Search } from "../i9-search/step.js";

const review = Object.freeze({ ...defineWorkflowStep({ key: "hire-review", label: "Review UCPath hire findings" }), system: "ucpath" as const,
  operatorFields: [
    { label: "Scan completeness", sources: [{ nodeId: "hire-findings", kind: "output" as const, fieldPath: "state" }] },
    { label: "Observed at", sources: [{ nodeId: "hire-findings", kind: "output" as const, fieldPath: "observedAt" }] },
    ...[["transactionId", "Transaction"], ["approvalStatus", "Approval status"], ["displayedName", "UCPath name"],
      ["emplId", "Employee ID"], ["effectiveDate", "Effective date"], ["positionNumber", "Position"], ["profileId", "Tracker Profile ID"]].map(([fieldPath, label]) => ({
      label, sources: [{ nodeId: "hire-findings", kind: "output" as const, fieldPath: `rows.${fieldPath}` }],
    })),
  ],
});
const group = Object.freeze({ ...defineWorkflowStep({ key: "i9-creation", label: "Create or reuse the I-9 record" }), system: "i9" as const });
const hireGroup = Object.freeze({ ...defineWorkflowStep({ key: "ucpath-hire", label: "File and verify the UCPath hire" }), system: "ucpath" as const });
const masterGroup = Object.freeze({ ...defineWorkflowStep({ key: "master-results", label: "Fill verified master results" }), system: "local" as const });
const reviewEntries = defineStepEntries(review), entries = defineStepEntries(group), hireEntries = defineStepEntries(hireGroup), masterEntries = defineStepEntries(masterGroup);

function previewProfile(dryRun: DryRunScope | undefined) {
  const source = dryRun?.transactions.find(step => step.nodeId === "i9-profile-save");
  if (source?.preview.outcome.state === "would-prepare") return { profileId: DRY_RUN_I9_PROFILE_ID,
    samples: [DryRunSampleSchema.parse({ label: "dry-run sample", sourceNodeId: "i9-profile-save", field: "I-9 profile ID", value: DRY_RUN_I9_PROFILE_ID })] };
  const probe = source?.preview.probe;
  if (probe?.state === "present" || probe?.state === "durable-intent") return { profileId: I9CreateProfile.output.parse(probe.output.value).receipt.profileId, samples: [] };
  throw new Error("onboarding-profile-preview-unavailable");
}

export function buildHireReview(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>,
  ucpath: ReturnType<typeof buildUcpathSearch>, i9: ReturnType<typeof buildI9Search>) {
  const findings = author.task(reviewEntries.task("hire-findings", UcpathReadHireFindings, { replay: "always-rerun" }), [crm.plan, ucpath.subject, i9.lookup], ({ outputs }) => ({
    employee: outputs["hire-plan"].employee, expectedName: `${outputs["hire-plan"].employee.firstName} ${outputs["hire-plan"].employee.lastName}`,
  }));
  const approval = author.gate({ step: review, id: ONBOARDING_WRITE_REVIEW_GATE, label: "Review transactions and approve the hire path",
    result: OnboardingWriteApprovalSchema, statusKey: "awaitingHireReview" }, [crm.plan, ucpath.matches, ucpath.subject, i9.lookup, findings]);
  return { findings, approval, steps: [[review, [findings, approval]]] as const };
}

export function buildHireWrites(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>,
  ucpath: ReturnType<typeof buildUcpathSearch>, i9: ReturnType<typeof buildI9Search>, reviewed: ReturnType<typeof buildHireReview>) {
  const { findings, approval } = reviewed;
  const plan = author.task(entries.task("write-plan", OnboardingReadWritePlan, { replay: "always-rerun" }), [crm.plan, ucpath.matches, ucpath.subject, i9.lookup, findings, approval], ({ input, outputs }) => ({
    mode: input.mode, plan: outputs["hire-plan"], match: outputs["ucpath-source"], subject: outputs["hire-subject"], lookup: outputs["i9-lookup"],
    findings: outputs["hire-findings"], approval: outputs[ONBOARDING_WRITE_REVIEW_GATE],
  }));
  const route = author.branch({ step: group, id: "i9-route", label: "Choose the reviewed I-9 path",
    cases: { create: ["i9-profile-save", "i9-remote-create", "hire-create", "hire-receipt", "master-results"],
      existing: ["i9-profile-plan", "concurrent-hire-create", "concurrent-hire-receipt", "concurrent-master-results"] } }, [plan],
  ({ outputs }) => outputs["write-plan"].hire.mode === "new-hire" ? "create" : "existing");
  const notRequired = author.task(entries.task("i9-profile-plan", OnboardingReadI9ProfilePlan, { replay: "always-rerun" }), [crm.plan, i9.lookup, plan], ({ outputs }) => ({
    plan: outputs["hire-plan"], lookup: outputs["i9-lookup"],
  }));
  const profile = author.transaction(entries.transaction("i9-profile-save", { label: "Save I-9 profile", prepare: I9StageProfile, commit: I9CreateProfile,
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000 }), [plan, approval], {
    prepareBind: ({ outputs }) => I9ProfileTargetSchema.parse(outputs["write-plan"].i9),
    commitBind: ({ outputs }) => I9ProfileTargetSchema.parse(outputs["write-plan"].i9),
  });
  const remote = author.transaction(entries.transaction("i9-remote-create", { label: "Create remote I-9 record", prepare: I9StageRemoteRecord, commit: I9CreateRemoteRecord,
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000 }), [plan, profile], {
    prepareBind: ({ outputs }) => ({ ...I9ProfileTargetSchema.parse(outputs["write-plan"].i9), profileId: outputs["i9-profile-save"].output.receipt.profileId, startDate: outputs["write-plan"].hire.employee.effectiveDate }),
    commitBind: ({ outputs }) => ({ ...I9ProfileTargetSchema.parse(outputs["write-plan"].i9), profileId: outputs["i9-profile-save"].output.receipt.profileId, startDate: outputs["write-plan"].hire.employee.effectiveDate }),
    previewBind: ({ outputs, dryRun }) => {
      const source = previewProfile(dryRun), target = { ...I9ProfileTargetSchema.parse(outputs["write-plan"].i9), profileId: source.profileId, startDate: outputs["write-plan"].hire.employee.effectiveDate };
      return { prepare: target, commit: target, samples: source.samples };
    },
  });
  const hire = author.transaction(hireEntries.transaction("hire-create", { label: "Submit the reviewed hire", prepare: UcpathStageHire, commit: UcpathCreateHire,
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000 }), [plan, approval, profile, remote], {
    prepareBind: ({ outputs }) => ({ ...outputs["write-plan"].hire, comments: outputs["write-plan"].comments,
      profileId: outputs["i9-remote-create"].output.receipt.profileId }),
    commitBind: ({ outputs }) => ({ ...outputs["write-plan"].hire, comments: outputs["write-plan"].comments,
      profileId: outputs["i9-remote-create"].output.receipt.profileId }),
    previewBind: ({ outputs, dryRun }) => {
      const source = previewProfile(dryRun), target = { ...outputs["write-plan"].hire, comments: outputs["write-plan"].comments, profileId: source.profileId };
      return { prepare: target, commit: target, samples: source.samples.map(sample => ({ ...sample, field: "Tracker Profile ID" })) };
    },
  });
  const receipt = author.task(hireEntries.task("hire-receipt", UcpathReadHireReceipt, { replay: "always-rerun" }), [plan, hire], ({ outputs }) => ({
    query: outputs["write-plan"].hire, transactionId: outputs["hire-create"].output.receipt.transactionId,
  }));
  const master = author.task(masterEntries.task("master-results", ReadWorkbookResult, { replay: "always-rerun" }), [plan, receipt, remote], ({ outputs }) =>
    onboardingMasterResults(outputs["write-plan"], outputs["hire-receipt"], outputs["i9-remote-create"].output.receipt));
  const concurrentHire = author.transaction(hireEntries.transaction("concurrent-hire-create", { label: "Submit the reviewed concurrent hire", prepare: UcpathStageHire, commit: UcpathCreateHire,
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000 }), [plan, approval, notRequired], {
    prepareBind: ({ outputs }) => ({ ...outputs["write-plan"].hire, comments: outputs["write-plan"].comments, profileId: null }),
    commitBind: ({ outputs }) => ({ ...outputs["write-plan"].hire, comments: outputs["write-plan"].comments, profileId: null }),
  });
  const concurrentReceipt = author.task(hireEntries.task("concurrent-hire-receipt", UcpathReadHireReceipt, { replay: "always-rerun" }), [plan, concurrentHire], ({ outputs }) => ({
    query: outputs["write-plan"].hire, transactionId: outputs["concurrent-hire-create"].output.receipt.transactionId,
  }));
  const concurrentMaster = author.task(masterEntries.task("concurrent-master-results", ReadWorkbookResult, { replay: "always-rerun" }), [plan, concurrentReceipt], ({ outputs }) =>
    onboardingMasterResults(outputs["write-plan"], outputs["concurrent-hire-receipt"], null));
  return { steps: [[group, [plan, route, notRequired, profile, remote]],
    [hireGroup, [hire, receipt, concurrentHire, concurrentReceipt]], [masterGroup, [master, concurrentMaster]]] as const,
  result: author.result(OnboardingResultSchema, [crm.plan, plan, approval, hire, receipt, remote, master, concurrentHire, concurrentReceipt, concurrentMaster], ({ outputs }) => {
    const existing = outputs["write-plan"].hire.mode === "rehire";
    const filled = existing ? outputs["concurrent-master-results"] : outputs["master-results"];
    const filed = existing ? outputs["concurrent-hire-create"] : outputs["hire-create"];
    const proof = existing ? outputs["concurrent-hire-receipt"] : outputs["hire-receipt"];
    return {
      state: filled.state === "recorded" && filled.receiptState === "applied" ? "filed" as const : "master-review-required" as const,
      plan: outputs["hire-plan"], subject: outputs["write-plan"].subject,
      i9: existing ? { state: "not-required" as const }
        : { state: "verified" as const, ...I9RemoteProofSchema.parse(outputs["i9-remote-create"].output.receipt) },
      hireWrite: { state: "verified" as const, disposition: filed.disposition, receipt: proof }, rosterAccess: filled,
    };
  }) };
}

export const onboardingHireWritesDefinition = defineStep({
  group: review, build: buildHireWrites,
  nodePurposes: [
    { nodeId: "hire-findings", purpose: "Read complete UCPath transaction findings before approving any external write." },
    { nodeId: ONBOARDING_WRITE_REVIEW_GATE, purpose: "Have the operator review findings and choose a new hire or an independently confirmed existing EID." },
    { nodeId: "write-plan", purpose: "Refuse incomplete or conflicting evidence and bind the chosen path to this roster row." },
    { nodeId: "i9-route", purpose: "Run I-9 writes only for the reviewed new-hire path." },
    { nodeId: "i9-profile-plan", purpose: "Retain the explicit I-9 not-required state for a confirmed existing person." },
    { nodeId: "i9-profile-save", purpose: "Fill and independently verify one I-9 profile save through its own fence." },
    { nodeId: "i9-remote-create", purpose: "Create or reuse the exact profile's remote I-9 record for the hire date." },
    { nodeId: "hire-create", purpose: "Stage the entire reviewed wizard and file one independently verified hire transaction." },
    { nodeId: "hire-receipt", purpose: "Read the exact filed T-number and current status again before filling master cells." },
    { nodeId: "concurrent-hire-create", purpose: "File the reviewed existing person's concurrent hire without an I-9 creation or Tracker profile fill." },
    { nodeId: "concurrent-hire-receipt", purpose: "Read the concurrent hire's exact T-number and current approval status again." },
    { nodeId: "concurrent-master-results", purpose: "Fill only verified concurrent-hire results through the captured master reference." },
    { nodeId: "master-results", purpose: "Write verified result cells through the run-bound master reference and retain ownership/refusal receipts." },
  ],
  proof: { id: "onboarding-hire-writes", order: 18,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({ ...inheritStepProof(parent), code: "onhw", label: "Onboarding writes", summary: parent.summary,
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author), ucpath = buildUcpathSearch(author, crm), i9 = buildI9Search(author, crm, ucpath);
        const reviewed = buildHireReview(author, crm, ucpath, i9);
        const writes = buildHireWrites(author, crm, ucpath, i9, reviewed);
        return { steps: [...crm.steps, ...ucpath.steps, ...i9.steps, ...reviewed.steps, ...writes.steps], result: writes.result };
      },
    }),
  },
});
