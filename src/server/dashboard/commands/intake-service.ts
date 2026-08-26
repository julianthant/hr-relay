/**
 * The intake session service (ref data-intake-and-edit-data §2.2, D170) — the ROUTE half of the
 * upload → map → validate flow.
 *
 * **The route creates the session; commands only mutate it.** That is capture's
 * precedent made explicit: there is deliberately no open arm in the intake
 * command family, because creation carries BYTES, and bytes do not belong in a
 * command envelope that is journaled, replayed and audited. So the upload
 * publishes the file content-addressed, runs discovery once, and mints the
 * `intake_sessions` row; every later decision arrives as a command.
 *
 * **A re-upload of the same bytes joins its open session.** The digest is the
 * identity, so uploading the same export twice is one session with the
 * operator's mapping still on it — forking a second one would silently
 * abandon that work and let two sessions enqueue the same rows.
 *
 * **`prepare` warms what a synchronous authority transaction cannot await.**
 * The kernel re-derives rows and columns from the immutable artifact on every
 * intake command, and reading an artifact is I/O. This service resolves the
 * exact selection the arm will ask for — through the SAME
 * `resolveInspectSelection` the kernel uses, so the two cannot drift — and
 * prepares it before the command runs.
 */
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { IntakeProjectionResolver } from "../../../core/command-kernel.js";
import type { Clock } from "../../../domain/clock.js";
import { CommandRequestSchema } from "../../../domain/commands.js";
import { deriveItemId, type IdFactory } from "../../../domain/identifiers.js";
import {
  ItemIdSchema,
  IsoInstantSchema,
  WorkflowIdSchema,
  type ActorId,
} from "../../../domain/ids.js";
import {
  IntakeSessionSchema,
  type IntakeSession,
} from "../../../domain/intake/session.js";
import { currentRerunState } from "../../../domain/intake/enqueue.js";
import {
  IntakeManifestTerminalProjectionSchema,
  rerunDiff,
  type IntakePlanManifest,
} from "../../../domain/intake/manifest.js";
import {
  resolveInspectSelection,
  type IntakeParse,
  type IntakeParseRefusalCode,
} from "../../../domain/intake/parse.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import { suggestBindings } from "../../../domain/intake/suggestions.js";
import { validateIntakeRows } from "../../../domain/intake/validate.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../domain/intake/wire.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import type { PreparedIntakeParser } from "../../intake/intake-parser.js";
import { TargetNotFoundError } from "../../failures.js";

/**
 * The upload cap. A roster export is tens of kilobytes to a few megabytes;
 * 25 MiB is generous for any real spreadsheet while keeping one request from
 * buffering an arbitrary file into this process.
 */
export const INTAKE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * What the grid edge can actually read. The zip magic still overrides a lying
 * media type downstream — this list is the declared contract, not the proof.
 *
 * It stays EXPORTED beside `INTAKE_UPLOAD_MAX_BYTES` with no importer in this
 * tree on purpose (Track D row D2 kept it where it un-exported eleven other
 * dead exports): the Dropzone's accept list and size cap are client literals
 * today, and serving both from here is a NAMED open wire task
 * (ref dashboard-surfaces §9.7.1, the `FE the intake Dropzone` row in
 * `docs/roadmap/roadmap.md`). An unlanded consumer is not dead code.
 */
export const INTAKE_UPLOAD_MEDIA_TYPES = Object.freeze([
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
] as const);

const IntakeUploadRequestSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  mediaType: z.enum(INTAKE_UPLOAD_MEDIA_TYPES),
  /**
   * Required, because the D159 manifest requires `source.originalName` and this
   * is the one moment the system sees it: a content-addressed artifact has a
   * digest, not a name (D171). Every real uploader has one — a dropzone reads
   * `file.name` — so demanding it here is what stops enqueue inventing one.
   */
  fileName: z.string().min(1).max(255),
  byteLength: z.number().int().positive().max(
    INTAKE_UPLOAD_MAX_BYTES,
    `an intake upload may not exceed ${String(INTAKE_UPLOAD_MAX_BYTES)} bytes`,
  ),
});

export type IntakeUploadOutcome =
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

    // The dispositions are RE-DERIVED against the retained `readAt`, never
    // stored: ref data-intake-and-edit-data §5.0's pipeline is a pure function of its inputs, so a
    // stored copy could only drift while this cannot.
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

    /**
     * Ref data-intake-and-edit-data §7 vector #11 (D171): these exact bytes may have run before. The
     * committed manifest is the only comparison authority for an enqueued
     * session. An open session uses the latest earlier manifest for this
     * (digest, workflow) pair, excluding its own reservation and anything
     * created after the session.
     */
    const rerun = ((): unknown => {
      const sessionCreatedAtMs = Date.parse(session.createdAt);
      const prior = committedManifest ?? dependencies.authorityRead
        .findIntakeManifestsBySource(session.artifact.sha256)
        .filter((candidate) =>
          candidate.workflow === session.workflow
          && candidate.manifestId !== session.reservedManifestId
          && Date.parse(candidate.createdAt) <= sessionCreatedAtMs)
        .reduce<IntakePlanManifest | undefined>((latest, candidate) =>
          latest === undefined || Date.parse(candidate.createdAt) >= Date.parse(latest.createdAt)
            ? candidate
            : latest, undefined);
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

    return IntakeSessionWireSchema.parse({
      wireVersion: 1,
      intakeSessionId: session.intakeSessionId,
      workflow: session.workflow,
      artifact: session.artifact,
      ...(session.sourceName === undefined ? {} : { sourceName: session.sourceName }),
      state: session.state,
      expectedVersion: session.version,
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
      });
      requireProjection(request.workflow);
      requireDescriptor(request.workflow);

      const artifact = await dependencies.artifacts.put(input.bytes, { mediaType: request.mediaType });
      const parse = await dependencies.parser.prepare({ artifact });
      if (parse.state === "refused") {
        // The bytes are published and immutable — that is harmless and
        // content-addressed — but no session is minted over a file nobody can
        // read, and the operator gets the parser's own words.
        return Object.freeze({ state: "refused" as const, code: parse.code, message: parse.message });
      }

      const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
      const outcome = dependencies.authority.withAuthorityTransaction((repositories) => {
        const open = repositories.intakeSessions
          .findActiveBySource(artifact.sha256)
          .find((candidate) => candidate.workflow === request.workflow);
        if (open !== undefined) return { state: "joined" as const, session: open };
        const record = IntakeSessionSchema.parse({
          intakeSessionId: dependencies.ids.uuid(),
          reservedManifestId: dependencies.ids.uuid(),
          actorId: dependencies.actorId,
          workflow: request.workflow,
          artifact,
          sourceName: request.fileName,
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
      // Not an intake command — a real, expected outcome for every other
      // family. The kernel remains the one authority that parses and refuses a
      // malformed request; this only warms a seam.
      if (!parsed.success || parsed.data.family !== "intake") return;
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
