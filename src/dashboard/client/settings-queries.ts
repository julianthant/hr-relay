import { EditableSettingsWireSchema,type EditableSettingsWire } from "../../domain/dashboard/settings-editor.js";
import { SettingsFactsWireSchema,type SettingsFactsWire } from "../../domain/dashboard/settings.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


export interface SettingsQueries {

  /**
   * D274 item 6 — Settings' System hosts + Workflow capabilities, read-only.
   *
   * There is deliberately no mutating counterpart on this interface, for the
   * same reason `workflowExplorer` has none: the settings WRITE family is
   * deferred (doc 04), so the surface cannot offer what the wire will not take.
   */
  settingsFacts(): Promise<SettingsFactsWire>;

  /** DCC3: the closed server-owned editable leaves with current revision and provenance. */
  editableSettings(): Promise<EditableSettingsWire>;
}

export function createSettingsQueries(transport: DashboardTransport): SettingsQueries { return Object.freeze({

    async settingsFacts(): Promise<SettingsFactsWire> {
      return parseOrThrow(
        SettingsFactsWireSchema,
        "GET /api/v1/settings/facts",
        await transport.requestJson("/api/v1/settings/facts"),
      );
    },

    async editableSettings(): Promise<EditableSettingsWire> {
      return parseOrThrow(
        EditableSettingsWireSchema,
        "GET /api/v1/settings/editable",
        await transport.requestJson("/api/v1/settings/editable"),
      );
    }
}); }
