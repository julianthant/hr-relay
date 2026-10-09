import { IntakeSessionWireSchema,type IntakeSessionWire } from "../../../models/intake/wire.js";
import {
WIRE_ERROR_BODY,
httpError,
schemaError
} from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


/**
 * What an intake upload did — the one place the response STATUS is the answer.
 *
 * `POST /api/v1/intake/files` returns the same session wire whether it minted a
 * session (`201`) or joined the open one those exact bytes already have
 * (`200`), and the difference is the whole message to the operator: "we read
 * your file" against "you already had this file open, with your mapping still
 * on it". A refusal (`422`) carries the parser's own code and words, which are
 * rendered verbatim rather than translated.
 *
 * Any other status is a fault, not an outcome: it throws through `httpError`
 * like every other route, because a surface that quietly treated an unexpected
 * status as "refused" would report a server bug as an operator problem.
 */
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

  /** Ref data-intake-and-edit-data §2.2 step 1 — the bytes go up, a durable session comes back (2i-E3). */
  uploadIntakeFile(request: IntakeUploadRequest): Promise<IntakeUploadResult>;

  /** The durable session joined with its re-derived parse view and hints. */
  intakeSession(intakeSessionId: string): Promise<IntakeSessionWire>;
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

    async intakeSession(intakeSessionId: string): Promise<IntakeSessionWire> {
      const path = `/api/v1/intake/${encodeURIComponent(intakeSessionId)}`;
      return parseOrThrow(IntakeSessionWireSchema, `GET ${path}`, await transport.requestJson(path));
    }
}); }
