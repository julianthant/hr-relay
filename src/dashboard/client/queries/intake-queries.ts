import { IntakeCommandResultWireSchema, type IntakeCommandResultWire } from "../../../models/dashboard/workbooks.js";
import { IntakeSessionWireSchema,type IntakeSessionWire } from "../../../models/intake/wire.js";
import {
WIRE_ERROR_BODY,
httpError,
schemaError
} from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


/** What an intake upload did — the one place the response STATUS is the answer. */
export type IntakeUploadResult =
  | Readonly<{ state: "created" | "joined"; session: IntakeSessionWire }>
  | Readonly<{ state: "refused"; code: string; message: string }>;


export interface IntakeUploadRequest {
  readonly workflowId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: ArrayBuffer;
}


export interface IntakeQueries {

  /** Ref data-intake-and-edit-data step 1 — the bytes go up, a durable session comes back. */
  uploadIntakeFile(request: IntakeUploadRequest): Promise<IntakeUploadResult>;

  /** The durable session joined with its re-derived parse view and hints. */
  intakeSession(intakeSessionId: string): Promise<IntakeSessionWire>;
  intakeCommandResult(intakeSessionId: string, commandId: string): Promise<IntakeCommandResultWire>;
}

export function createIntakeQueries(transport: DashboardTransport): IntakeQueries { return Object.freeze({

    async uploadIntakeFile(request: IntakeUploadRequest): Promise<IntakeUploadResult> {
      const path = `/api/v1/intake/files?workflow=${encodeURIComponent(request.workflowId)}`
        + `&filename=${encodeURIComponent(request.fileName)}`;
      const response = await transport.requestJsonResponse(path, {
        method: "POST",
        body: request.bytes,
        // The route reads the media type off this header and the size cap off
        // the body, so both travel as themselves rather than as JSON fields.
        headers: { "content-type": request.mediaType },
      });
      if (response.status === 422) {
        const refusal = WIRE_ERROR_BODY.safeParse(response.body);
        if (!refusal.success) throw schemaError(`POST ${path}`, refusal.error);
        return Object.freeze({ state: "refused" as const, code: refusal.data.code, message: refusal.data.message });
      }
      // Anything outside {201, 200, 422} is a fault. Falling through to
      // "refused" would report a server defect as the operator's bad file.
      if (response.status !== 201 && response.status !== 200) {
        throw httpError(response.status, response.body);
      }
      return Object.freeze({
        state: response.status === 201 ? ("created" as const) : ("joined" as const),
        session: parseOrThrow(IntakeSessionWireSchema, `POST ${path}`, response.body),
      });
    },

    async intakeCommandResult(intakeSessionId: string, commandId: string): Promise<IntakeCommandResultWire> {
      const path = `/api/v1/intake/${encodeURIComponent(intakeSessionId)}/commands/${encodeURIComponent(commandId)}`;
      const record = parseOrThrow(IntakeCommandResultWireSchema, `GET ${path}`, await transport.requestJson(path));
      if (record.state === "recorded" && (record.request.target.intakeSessionId !== intakeSessionId || record.request.commandId !== commandId)) throw schemaError(path, "intake command result identity mismatch");
      return record;
    },

    async intakeSession(intakeSessionId: string): Promise<IntakeSessionWire> {
      const path = `/api/v1/intake/${encodeURIComponent(intakeSessionId)}`;
      const session = parseOrThrow(IntakeSessionWireSchema, `GET ${path}`, await transport.requestJson(path));
      if (session.intakeSessionId !== intakeSessionId) throw schemaError(path, "intake session identity mismatch");
      return session;
    }
}); }
