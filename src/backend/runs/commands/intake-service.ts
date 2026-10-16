import { WorkbookLibraryError } from "../../workbooks/workbook-library-service.js";

import { z } from "zod";
import { CsvError } from "csv-parse/sync";
import { InvalidInputError, InvalidSpreadsheetError } from "read-excel-file/node";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { IntakeProjectionResolver } from "./command-kernel.js";
import type { Clock } from "../../../rules/time/clock.js";
import { CommandRequestSchema } from "../../../rules/commands/commands.js";
import { deriveItemId, type IdFactory } from "../../../rules/identity/identifiers.js";
import {
  ItemIdSchema,
  IsoInstantSchema,
  WorkflowIdSchema,
  type ActorId,
} from "../../../rules/identity/ids.js";
import {
  IntakeSessionSchema,
  WorkbookIntakeSourceSchema,
  type IntakeSession,
} from "../../../models/intake/session.js";
import { currentRerunState, deriveIntakeEnqueuePlan } from "../../../models/intake/enqueue.js";
import {
  IntakeManifestTerminalProjectionSchema,
  rerunDiff,
  type IntakePlanManifest,
} from "../../../models/intake/manifest.js";
import {
  resolveInspectSelection,
  type IntakeParse,
  type IntakeParseRefusalCode,
} from "../../../models/intake/parse.js";
import { intakeReviewBinding, resolveIntakeComparison } from "../../../models/intake/review.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { suggestBindings } from "../../../models/intake/suggestions.js";
import { validateIntakeRows } from "../../../models/intake/validate.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../models/intake/wire.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { PreparedIntakeParser } from "../../processing/spreadsheet/intake-parser.js";
import { TargetNotFoundError } from "./refusals.js";


export const INTAKE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;


const INTAKE_UPLOAD_MEDIA_TYPES = Object.freeze([
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
] as const);

const IntakeUploadRequestSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  mediaType: z.enum(INTAKE_UPLOAD_MEDIA_TYPES),
  // Capture the original filename at upload; content addressing cannot recover it.
  fileName: z.string().min(1).max(255),
  workbookSource: WorkbookIntakeSourceSchema.optional(),
  byteLength: z.number().int().positive().max(
    INTAKE_UPLOAD_MAX_BYTES,
    `an intake upload may not exceed ${String(INTAKE_UPLOAD_MAX_BYTES)} bytes`,
  ),
});

type IntakeUploadOutcome =
  | Readonly<{ state: "created" | "joined"; session: IntakeSessionWire }>
  | Readonly<{ state: "refused"; code: IntakeParseRefusalCode; message: string }>;

export interface IntakeServiceDependencies {
  readonly authority: Readonly<{
    withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  }>;
  readonly authorityRead: Readonly<{
    getIntakeSession(intakeSessionId: string): IntakeSession | undefined;
    getIntakeManifest(manifestId: string): IntakePlanManifest | undefined;
    findIntakeManifestsBySource(sourceSha256: string): readonly IntakePlanManifest[];
  }>;
  readonly artifacts: ContentAddressedArtifactWriter;
  readonly parser: PreparedIntakeParser;
  readonly projections: IntakeProjectionResolver;
  readonly descriptors: Readonly<{ resolve(workflowId: string): AnyWorkflowDescriptor | undefined }>;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly actorId: ActorId;
}

export interface IntakeService {
  upload(input: Readonly<{
    workflow: string;
    mediaType: string;
    fileName: string;
    bytes: Uint8Array;
    workbookSource?: z.infer<typeof WorkbookIntakeSourceSchema>;
  }>): Promise<IntakeUploadOutcome>;
  read(intakeSessionId: string): Promise<IntakeSessionWire>;
  prepare(command: unknown): Promise<void>;
}

/** The media type without its parameters — `text/csv; charset=utf-8` is a CSV. */
function baseMediaType(header: string): string {
  const [type] = header.split(";");
  return (type ?? "").trim().toLowerCase();
}

function requireParsed(parse: IntakeParse, what: string) {
  if (parse.state === "refused") {
    throw new Error(`${what} cannot be read (${parse.code}): ${parse.message}`);
  }
  return parse;
}

export function createIntakeService(dependencies: IntakeServiceDependencies): IntakeService {
  const requireProjection = (workflow: string) => {
    const projection = dependencies.projections.resolve(workflow);
    if (projection === undefined) {
      throw new TargetNotFoundError(
        `workflow ${workflow} is not registered for spreadsheet intake; it declares no intake projection`,
      );
    }
    return projection;
  };

  const requireDescriptor = (workflow: string): AnyWorkflowDescriptor => {
    const descriptor = dependencies.descriptors.resolve(workflow);
    if (descriptor === undefined) throw new TargetNotFoundError(`workflow ${workflow} is not registered`);
    return descriptor;
  };

  const buildWire = async (session: IntakeSession): Promise<IntakeSessionWire> => {
    const projection = requireProjection(session.workflow);
    const descriptor = requireDescriptor(session.workflow);
    const parse = requireParsed(
      await dependencies.parser.prepare({
        artifact: session.artifact,
        sheet: session.sheet,
        headerRowIndex: session.headerRowIndex,
      }),
      `intake session ${session.intakeSessionId}`,
    );
    const layout = parse.layout;
    const readAt = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
    const planning = workflowPlanning(descriptor);
    const deriveCurrentItemId = (parsedInput: Parameters<typeof planning.matchKey>[0]) =>
      ItemIdSchema.parse(deriveItemId(session.workflow, planning.matchKey(parsedInput)));
    const suggestions = layout === null
      ? []
      : suggestBindings({
        workflow: session.workflow,
        detected: layout.columns,
        projection,
        readAt,
      });


    const validation = session.validation.state === "none" || layout === null
      ? { state: "none" as const }
      : (() => {
        const outcome = validateIntakeRows({
          workflow: session.workflow,
          sourceSha256: session.artifact.sha256,
          projection,
          detected: layout.columns,
          bindings: session.bindings,
          rows: layout.rows,
          constants: session.constants,
          corrections: session.corrections,
          excludedRows: session.exclusions.map((entry) => entry.sourceRow),
          readAt: session.validation.readAt,
          deriveItemId: deriveCurrentItemId,
        });
        return {
          state: "validated" as const,
          validatedAt: session.validation.validatedAt,
          readAt: session.validation.readAt,
          validRows: outcome.valid.length,
          unresolvedRows: [...outcome.currentRejects].filter(([row, rejects]) => rejects.length > 0 && !outcome.excluded.includes(row)).map(([row]) => row).sort((a, b) => a - b),
          rejected: outcome.rejected,
          excluded: outcome.excluded,
        };
      })();

    const committedManifest = (() => {
      if (session.intakeManifestId === undefined) return undefined;
      const committed = dependencies.authorityRead.getIntakeManifest(session.intakeManifestId);
      if (committed === undefined) {
        throw new Error(
          `enqueued intake session ${session.intakeSessionId} names missing manifest ${session.intakeManifestId}`,
        );
      }
      return committed;
    })();
    const terminalManifest = committedManifest === undefined
      ? undefined
      : IntakeManifestTerminalProjectionSchema.parse({
        manifestId: committedManifest.manifestId,
        mappingFingerprint: committedManifest.mappingFingerprint,
        mappingSnapshotHash: committedManifest.mappingSnapshotHash,
        intakeProjectionFingerprint: committedManifest.intakeProjectionFingerprint,
        workflowContractFingerprint: committedManifest.workflowContractFingerprint,
        canonicalInputSchemaHash: committedManifest.canonicalInputSchemaHash,
        createdAt: committedManifest.createdAt,
        totals: committedManifest.totals,
        sourceRowDispositions: committedManifest.sourceRowDispositions,
        validRows: committedManifest.validRows,
      });


    const rerun = ((): unknown => {
      const prior = committedManifest ?? resolveIntakeComparison(session, {
        get: dependencies.authorityRead.getIntakeManifest,
        findBySource: dependencies.authorityRead.findIntakeManifestsBySource,
      });
      if (prior === undefined) return undefined;
      if (layout === null) {
        throw new Error(
          `intake session ${session.intakeSessionId} cannot compare prior manifest ${prior.manifestId}: `
          + "the current intake layout is missing",
        );
      }
      return {
        intakeManifestId: prior.manifestId,
        createdAt: prior.createdAt,
        totals: prior.totals,
        diff: rerunDiff(prior, currentRerunState({
          session,
          layout,
          projection,
          readAt: session.validation.state === "validated" ? session.validation.readAt : session.updatedAt,
          workflowContractFingerprint: descriptor.contractFingerprint,
          canonicalInputSchemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
          deriveItemId: deriveCurrentItemId,
        })),
      };
    })();

    const reviewBinding = (() => {
      if (session.state !== "validated" || session.validation.state !== "validated" || layout === null
        || session.sourceName === undefined || session.reservedManifestId === undefined) return undefined;
      const assigned = new Set([...session.bindings.map(row => row.targetFieldId), ...session.constants.map(row => row.targetFieldId)]);
      if (projection.targets.some(target => target.required && !assigned.has(target.targetFieldId))) return undefined;
      const plan = deriveIntakeEnqueuePlan({
        session: { ...session, sourceName: session.sourceName, readAt: session.validation.readAt },
        layout, projection, manifestId: session.reservedManifestId, createdAt: session.updatedAt,
        workflowContractFingerprint: descriptor.contractFingerprint,
        canonicalInputSchemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), deriveItemId: deriveCurrentItemId,
      });
      return plan.readiness.ready ? intakeReviewBinding(session, plan.manifest, resolveIntakeComparison(session, {
        get: dependencies.authorityRead.getIntakeManifest, findBySource: dependencies.authorityRead.findIntakeManifestsBySource,
      })) : undefined;
    })();

    return IntakeSessionWireSchema.parse({
      wireVersion: 1,
      intakeSessionId: session.intakeSessionId,
      workflow: session.workflow,
      artifact: session.artifact,
      ...(session.sourceName === undefined ? {} : { sourceName: session.sourceName }),
      ...(session.workbookSource === undefined ? {} : { workbookSource: session.workbookSource }),
      state: session.state,
      expectedVersion: session.version,
      ...(reviewBinding === undefined ? {} : { reviewBinding }),
      ...(session.comparisonManifestId === undefined ? {} : { comparisonManifestId: session.comparisonManifestId }),
      ...(session.reservedManifestId === undefined ? {} : { reservedManifestId: session.reservedManifestId }),
      ...(session.intakeManifestId === undefined ? {} : { intakeManifestId: session.intakeManifestId }),
      ...(terminalManifest === undefined ? {} : { manifest: terminalManifest }),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sheets: parse.sheets,
      sheet: parse.sheet,
      headerCandidates: parse.candidates,
      headerDiscoveryReason: parse.discoveryReason,
      headerRowIndex: layout === null ? null : layout.headerRowIndex,
      headerFingerprint: layout === null ? null : layout.headerFingerprint,
      columns: layout === null ? [] : layout.columns,
      rowCount: layout === null ? 0 : layout.rows.length,
      targets: projection.targets,
      bindings: session.bindings,
      constants: session.constants,
      corrections: session.corrections,
      exclusions: session.exclusions,
      suggestions,
      validation,
      ...(rerun === undefined ? {} : { rerun }),
    });
  };

  const service: IntakeService = {
    async upload(input) {
      const request = IntakeUploadRequestSchema.parse({
        workflow: input.workflow,
        mediaType: baseMediaType(input.mediaType),
        fileName: input.fileName,
        byteLength: input.bytes.byteLength,
        ...(input.workbookSource === undefined ? {} : { workbookSource: input.workbookSource }),
      });
      requireProjection(request.workflow);
      requireDescriptor(request.workflow);

      if (request.mediaType !== "text/csv" && !(input.bytes[0] === 0x50 && input.bytes[1] === 0x4b)) {
        return Object.freeze({ state: "refused" as const, code: "unreadable-file" as const, message: "The uploaded workbook has no XLSX archive signature." });
      }
      const artifact = await dependencies.artifacts.put(input.bytes, { mediaType: request.mediaType });
      let parse: IntakeParse;
      try {
        parse = await dependencies.parser.prepare({ artifact });
      } catch (error) {
        // Only documented file-format failures become operator refusals; I/O and programming defects propagate.
        const malformedCsv = error instanceof CsvError && ["CSV_INVALID_CLOSING_QUOTE", "CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE", "CSV_QUOTE_NOT_CLOSED", "CSV_RECORD_INCONSISTENT_FIELDS_LENGTH", "INVALID_OPENING_QUOTE"].includes(error.code);
        if (!malformedCsv && !(error instanceof InvalidInputError) && !(error instanceof InvalidSpreadsheetError)) throw error;
        return Object.freeze({ state: "refused" as const, code: "unreadable-file" as const, message: "The spreadsheet is incomplete or malformed. Export a complete CSV or XLSX file and try again." });
      }
      if (parse.state === "refused") {

        return Object.freeze({ state: "refused" as const, code: parse.code, message: parse.message });
      }

      const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
      const outcome = dependencies.authority.withAuthorityTransaction((repositories) => {
        const open = repositories.intakeSessions
          .findActiveBySource(artifact.sha256)
          .find((candidate) => candidate.workflow === request.workflow);
        if (open !== undefined) {
          if (open.workbookSource?.libraryId !== request.workbookSource?.libraryId || open.workbookSource?.version !== request.workbookSource?.version) throw new WorkbookLibraryError("WORKBOOK_INTAKE_SOURCE_CONFLICT");
          return { state: "joined" as const, session: open };
        }
        const record = IntakeSessionSchema.parse({
          intakeSessionId: dependencies.ids.uuid(),
          reservedManifestId: dependencies.ids.uuid(),
          actorId: dependencies.actorId,
          workflow: request.workflow,
          artifact,
          sourceName: request.fileName,
          ...(request.workbookSource === undefined ? {} : { workbookSource: request.workbookSource }),
          sheet: parse.sheet,
          headerRowIndex: parse.layout === null ? null : parse.layout.headerRowIndex,
          bindings: [],
          constants: [],
          corrections: [],
          exclusions: [],
          state: "mapping",
          validation: { state: "none" },
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        return { state: "created" as const, session: repositories.intakeSessions.create(record) };
      });

      return Object.freeze({ state: outcome.state, session: await buildWire(outcome.session) });
    },

    async read(intakeSessionId) {
      const session = dependencies.authorityRead.getIntakeSession(intakeSessionId);
      if (session === undefined) throw new TargetNotFoundError(`intake session ${intakeSessionId} does not exist`);
      return buildWire(session);
    },

    async prepare(command) {
      const parsed = CommandRequestSchema.safeParse(command);

      if (!parsed.success || parsed.data.family !== "intake") return;
      // Existing commands are resolved by kernel identity/replay before source reads or new effects.
      if (dependencies.authority.withAuthorityTransaction(repositories => repositories.commands.get(parsed.data.commandId)) !== undefined) return;
      const session = dependencies.authorityRead.getIntakeSession(parsed.data.target.intakeSessionId);
      if (session === undefined) return;
      const selection = parsed.data.type === "inspect-intake"
        ? resolveInspectSelection(session, parsed.data.payload)
        : { sheet: session.sheet, headerRowIndex: session.headerRowIndex };
      await dependencies.parser.prepare({
        artifact: session.artifact,
        sheet: selection.sheet,
        headerRowIndex: selection.headerRowIndex,
      });
    },
  };
  return Object.freeze(service);
}
