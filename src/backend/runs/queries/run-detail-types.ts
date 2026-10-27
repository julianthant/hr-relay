import type { createFailureResolutionQuery } from "./failure-resolution.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { OperatorFieldDisplay } from "../../../models/workflow/presentation.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { ProofShape } from "../../../models/validation/proof-shape.js";
import type { RunQueueProjection } from "../projections/run-queue-projection.js";
import type { DiagnosticBundleQueryDeps } from "./diagnostic-bundle.js";
import type { ItemAttemptHistoryRequest, ItemAttemptHistoryResponse } from "../../../models/dashboard/item-attempt-history.js";


export interface RunDetailTrustDeps {
  readonly failureResolution?: ReturnType<typeof createFailureResolutionQuery>;
  /** Derive-and-persist the run's receipt; see `ensureRunEvidenceReceipt`. */
  ensureReceipt(runId: string): RunEvidenceReceipt;
  getFailure(failureId: string): FailureRecord | undefined;
  countFailuresByFingerprint(fingerprint: string): number;
}



export interface RunDetailGateNodeView {
  readonly nodeId: string;
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly resultSchemaHash: string;
}

// Write proof forms use the commit contract schema, not the transaction output schema.
export interface RunDetailWriteContractView {
  /** The commit task the intent's `taskId` names. */
  readonly commitTaskId: string;
  readonly completionKind: "receipt" | "save-verify" | "upload-verify";
  readonly proofSchemaHash: string;
  readonly proof: ProofShape;
}


export interface RunDetailDataOriginView {
  readonly nodeId: string;
  readonly step: string;
  /** The producing task contract; node id alone is not an observed-log address. */
  readonly taskId: string;
  /** The transaction beat that invokes the task; ordinary nodes are `task`. */
  readonly role?: "task" | "probe" | "prepare" | "commit" | "verify";
  readonly dir: "read" | "write";
  readonly system?: string;
  readonly freshness?: readonly Readonly<{
    fieldPath: string;
    maxAge: number | "unbounded";
    override: "forbidden" | "audited";
  }>[];
  /** Commit nodes this node's facts can statically reach (ref workflow-model ). */
  readonly operatorFields?: readonly Readonly<{ label: string; kind: "input" | "output"; fieldPath: string; declaration?: string; display?: OperatorFieldDisplay }>[];
  readonly feeds: readonly Readonly<{ nodeId: string; label: string }>[];
}

// Context data comes from declared origins, not a second descriptor details contract.
export interface RunDetailDescriptorView {
  readonly version?: number;
  readonly contractFingerprint?: string;
  /** Ref dashboard-surfaces: where the RUN resolves the subject's name, if it ever does. */
  readonly subjectProjection?: Readonly<{ nodeId: string; fieldPath: string }>;
  readonly titleProjection?: AnyWorkflowDescriptor["titleProjection"];

  readonly timeline?: readonly Readonly<{
    system?: string;
    key?: string;
    label: string;
    nodes: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  /** Absent for a descriptor with no gate node; empty is the same answer. */
  readonly gateNodes?: readonly RunDetailGateNodeView[];

  readonly writeContracts?: readonly RunDetailWriteContractView[];
  // Optional for read-only fixtures; production supplies node origin facts from the module.
  readonly dataOrigins?: readonly RunDetailDataOriginView[];
  readonly capabilities?: Readonly<{
    editData?:
      | boolean
      | Readonly<{
        fields: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[];
      }>;
  }>;
}

export type CanonicalRunReader = Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot">;

export interface RunDetailQueryDeps {
  readonly authorityIdentity?: Readonly<{ installationId: string; profileId: string }>;
  readonly ownsWorker?: (lease: import("../../../models/run/worker.js").WorkerLeaseRecord) => boolean;
  /** Bounded, versioned same-item history read, composed only with lifecycle authority. */
  readonly itemAttemptHistory?: Readonly<{
    read(runId: string, request: ItemAttemptHistoryRequest): ItemAttemptHistoryResponse;
  }>;
  /** Sole lifecycle read port; separate from the complete Context/Rerun backing bundle. */
  readonly runReader?: CanonicalRunReader;
  /** Explicit canonical backing for consumers that require retained authority reads. */
  readonly canonical?: {
    readonly reader: Pick<RunRecordService, "read" | "list">;
    readonly database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot">;
    readonly descriptors: {
      resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
    };
  };
  readonly timeline: import("../../../models/events/timeline.js").TimelineRepository;
  readonly stateRoot: string;
  readonly projection: RunQueueProjection;
  readonly authority: {
    getRun(runId: string): RunRecord | undefined;
    /** Ref workflow-model's "latest compatible attempt wins" read, for edit values. */
    latestCheckpoint(
      workflowId: string,
      itemId: string,
      nodeId: string,
    ): RunCheckpointRecord | undefined;

    listCheckpoints(workflowId: string, itemId: string): readonly RunCheckpointRecord[];

    getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;

    listGateResults(runId: string): readonly GateResultRecord[];
  };
  /** Resolves the CURRENT registered descriptor for a workflow. */
  readonly descriptors: {
    resolve(workflowId: string): RunDetailDescriptorView | undefined;
  };
  /** Absent until a composition wires the 2g trust services. */
  readonly trust?: RunDetailTrustDeps;
  /** exact diagnostic authority plus its content-addressed byte verifier. */
  readonly captures?: DiagnosticBundleQueryDeps & Readonly<{
    authority: DiagnosticBundleQueryDeps["authority"]
      & Pick<AuthorityRepositories["diagnosticBundles"], "listByRun">;
  }>;
}
