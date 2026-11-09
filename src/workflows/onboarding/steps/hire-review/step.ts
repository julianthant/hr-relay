import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingReadI9ProfilePlan } from "../../../../models/workflows/onboarding/read-i9-profile-plan.js";
import { OnboardingReadWritePlan, OnboardingWriteApprovalSchema, ONBOARDING_WRITE_REVIEW_GATE } from "../../../../models/workflows/onboarding/read-write-plan.js";
import { OnboardingResultSchema } from "../../../../models/workflows/onboarding/result.js";
import { I9CreateProfile } from "../../../../models/systems/i9/create-profile.js";
import { I9StageProfile } from "../../../../models/systems/i9/stage-profile.js";
import { I9CreateRemoteRecord } from "../../../../models/systems/i9/create-remote-record.js";
import { I9StageRemoteRecord } from "../../../../models/systems/i9/stage-remote-record.js";
import { I9ProfileTargetSchema, I9RemoteProofSchema } from "../../../../models/ui/i9-creation.js";
import { UcpathStageHire } from "../../../../models/systems/ucpath/stage-hire.js";
import { UcpathCreateHire } from "../../../../models/systems/ucpath/create-hire.js";
import { UcpathReadHireFindings } from "../../../../models/systems/ucpath/read-hire-findings.js";
import { UcpathReadHireReceipt } from "../../../../models/systems/ucpath/read-hire-receipt.js";
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
  review: {
    pages: [
      {
        id: "smart-hr-findings",
        title: "SS Smart HR transaction search",
        mode: "Read only",
        nodeIds: ["hire-findings", "hire-review"],
        lines: [
          { id: "read-findings", kind: "read", text: "Read complete UCPath transaction findings for the proposed hire.", nodeIds: ["hire-findings"] },
          { id: "approve-path", kind: "action", text: "Review the findings and approve the new or existing person hire path.", nodeIds: ["hire-review"] }
        ],
        fields: [
          {
            id: "scan-completeness",
            operatorField: "Scan completeness",
            source: {
              origin: "UCPath",
              detail: "Completeness of the UCPath findings scan.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Scan completeness" }
            }
          },
          {
            id: "observed-at",
            operatorField: "Observed at",
            source: {
              origin: "UCPath",
              detail: "When the findings were observed.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Observed at" }
            }
          },
          {
            id: "transaction",
            operatorField: "Transaction",
            source: {
              origin: "UCPath",
              detail: "Transaction number in a finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Transaction" }
            }
          },
          {
            id: "approval-status",
            operatorField: "Approval status",
            source: {
              origin: "UCPath",
              detail: "Status in a transaction finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Approval status" }
            }
          },
          {
            id: "ucpath-name",
            operatorField: "UCPath name",
            source: {
              origin: "UCPath",
              detail: "Name shown in a transaction finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "UCPath name" }
            }
          },
          {
            id: "employee-id",
            operatorField: "Employee ID",
            source: {
              origin: "UCPath",
              detail: "Employee ID shown in a transaction finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Employee ID" }
            }
          },
          {
            id: "effective-date",
            operatorField: "Effective date",
            source: {
              origin: "UCPath",
              detail: "Effective date shown in a transaction finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Effective date" }
            }
          },
          {
            id: "position",
            operatorField: "Position",
            source: {
              origin: "UCPath",
              detail: "Position shown in a transaction finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Position" }
            }
          },
          {
            id: "tracker-profile-id",
            operatorField: "Tracker Profile ID",
            source: {
              origin: "UCPath",
              detail: "Tracker profile ID shown in a transaction finding.",
              chain: [],
              read: { stepKey: "hire-review", page: "SS Smart HR transaction search", field: "Tracker Profile ID" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
});
const group = Object.freeze({ ...defineWorkflowStep({ key: "i9-creation", label: "Create or reuse the I-9 record" }), system: "i9" as const,
  review: {
    pages: [
      {
        id: "new-employee",
        title: "Create new I9: new employee",
        mode: "Fill form",
        nodeIds: ["i9-profile-save"],
        lines: [
          { id: "profile", kind: "action", text: "Fill and verify the reviewed employee profile and worksite.", nodeIds: ["i9-profile-save"] },
          { id: "save-profile", kind: "action", text: "In a live run, save the profile and verify its profile ID.", nodeIds: ["i9-profile-save"] }
        ],
        fields: []
      },
      {
        id: "remote-i9",
        title: "Remote - Section 1 Only",
        mode: "Fill form",
        nodeIds: ["i9-remote-create"],
        lines: [
          { id: "remote", kind: "action", text: "Select Remote - Section 1 Only and the reviewed start date.", nodeIds: ["i9-remote-create"] },
          { id: "create", kind: "action", text: "In a live run, create the I-9 and verify its exact profile and date.", nodeIds: ["i9-remote-create"] }
        ],
        fields: []
      }
    ],
    branchLabels: [
      { nodeId: "i9-route", outcome: "create", label: "Create an I-9 profile and remote record for a new hire" },
      { nodeId: "i9-route", outcome: "existing", label: "Use the confirmed existing person without creating an I-9 record" }
    ]
  } as const,
});
const hireGroup = Object.freeze({ ...defineWorkflowStep({ key: "ucpath-hire", label: "File and verify the UCPath hire" }), system: "ucpath" as const,
  review: {
    pages: [
      {
        id: "hire-setup",
        title: "Smart HR transaction setup",
        mode: "Fill form",
        nodeIds: ["hire-create", "concurrent-hire-create"],
        lines: [{ id: "setup", kind: "action", text: "Select the reviewed hire template, effective date and person.", nodeIds: ["hire-create", "concurrent-hire-create"] }],
        fields: []
      },
      {
        id: "personal-data",
        title: "Personal Data",
        mode: "Fill form",
        nodeIds: ["hire-create", "concurrent-hire-create"],
        lines: [
          {
            id: "personal",
            kind: "action",
            text: "For a new hire, fill and check legal and lived names, identifiers, contact details and the verified Tracker profile.",
            nodeIds: ["hire-create"]
          },
          { id: "existing-person", kind: "check", text: "For an existing person, confirm the independently verified identity.", nodeIds: ["concurrent-hire-create"] }
        ],
        fields: []
      },
      {
        id: "job-data",
        title: "Job Data",
        mode: "Fill form",
        nodeIds: ["hire-create", "concurrent-hire-create"],
        lines: [
          {
            id: "job",
            kind: "action",
            text: "Fill position, classification, expected end date and hourly pay details.",
            nodeIds: ["hire-create", "concurrent-hire-create"]
          },
          { id: "verify-job", kind: "check", text: "Read every staged job and pay value back.", nodeIds: ["hire-create", "concurrent-hire-create"] }
        ],
        fields: []
      },
      {
        id: "earnings-distribution",
        title: "Earns Dist",
        mode: "Read only",
        nodeIds: ["hire-create", "concurrent-hire-create"],
        lines: [{ id: "earnings", kind: "check", text: "Open earnings distribution and retain the wizard evidence.", nodeIds: ["hire-create", "concurrent-hire-create"] }],
        fields: []
      },
      {
        id: "employee-experience",
        title: "Employee Experience",
        mode: "Read only",
        nodeIds: ["hire-create"],
        lines: [{ id: "experience", kind: "check", text: "For a new hire, open Employee Experience and retain the wizard evidence.", nodeIds: ["hire-create"] }],
        fields: []
      },
      {
        id: "hire-submission",
        title: "Personal Data",
        mode: "Fill form",
        nodeIds: ["hire-create", "concurrent-hire-create"],
        lines: [
          {
            id: "comments",
            kind: "action",
            text: "Return to Personal Data, fill the comments and verify the resolved person.",
            nodeIds: ["hire-create", "concurrent-hire-create"]
          },
          { id: "submit", kind: "action", text: "In a live run, click Save and Submit for the reviewed hire.", nodeIds: ["hire-create", "concurrent-hire-create"] }
        ],
        fields: []
      },
      {
        id: "hire-receipt",
        title: "SS Smart HR transaction detail",
        mode: "Read only",
        nodeIds: ["hire-receipt", "concurrent-hire-receipt"],
        lines: [
          {
            id: "receipt",
            kind: "check",
            text: "Read the exact filed transaction number and current status again.",
            nodeIds: ["hire-receipt", "concurrent-hire-receipt"]
          }
        ],
        fields: []
      }
    ],
    branchLabels: []
  } as const,
});
const masterGroup = Object.freeze({ ...defineWorkflowStep({ key: "master-results", label: "Fill verified master results" }), system: "local" as const,
  review: {
    pages: [
      {
        id: "onboarding-roster",
        title: "Onboarding roster",
        mode: "Read only",
        nodeIds: ["master-results", "concurrent-master-results"],
        lines: [
          {
            id: "fill-results",
            kind: "action",
            text: "Fill verified hire results through the roster version captured for this run.",
            nodeIds: ["master-results", "concurrent-master-results"]
          },
          {
            id: "confirm-results",
            kind: "check",
            text: "Retain the result-cell receipt or the reason the roster needs review.",
            nodeIds: ["master-results", "concurrent-master-results"]
          }
        ],
        fields: []
      }
    ],
    branchLabels: []
  } as const,
});
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
