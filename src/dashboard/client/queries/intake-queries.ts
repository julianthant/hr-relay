import { IntakeCommandResultWireSchema, type IntakeCommandResultWire } from "../../../models/dashboard/workbooks.js";
import { IntakeSessionWireSchema,type IntakeSessionWire } from "../../../models/intake/wire.js";
import { schemaError } from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


export interface IntakeQueries {

  /** The durable session joined with its re-derived parse view and hints. */
  intakeSession(intakeSessionId: string): Promise<IntakeSessionWire>;
  intakeCommandResult(intakeSessionId: string, commandId: string): Promise<IntakeCommandResultWire>;
}

export function createIntakeQueries(transport: DashboardTransport): IntakeQueries { return Object.freeze({

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
