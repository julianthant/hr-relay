import { EditableSettingsWireSchema,type EditableSettingsWire } from "../../../models/dashboard/settings-editor.js";
import { SettingsFactsWireSchema,type SettingsFactsWire } from "../../../models/dashboard/settings.js";
import { DashboardClientError } from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";
import { StorageRelocationPlanViewSchema, type StorageRelocationPlanView } from "../../../rules/commands/commands.js";
import { NativePathPickerRequestSchema, NativePathPickerResponseSchema,
  type NativePathPickerRequest, type NativePathPickerResponse } from "../../../models/dashboard/native-path-picker.js";
import { httpError, schemaError } from "../errors.js";


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
  storageRelocationPlans(): Promise<StorageRelocationPlanView>;
  pickSettingsPath(request: NativePathPickerRequest): Promise<NativePathPickerResponse>;
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
      try { return EditableSettingsWireSchema.parse(await transport.requestJson("/api/v1/settings/editable")); }
      catch { throw new DashboardClientError({ kind: "schema", code: "SETTINGS_READ_UNAVAILABLE", message: "GET /api/v1/settings/editable: settings could not be read or verified" }); }
    },
    async storageRelocationPlans(): Promise<StorageRelocationPlanView> {
      try { return StorageRelocationPlanViewSchema.parse(await transport.requestJson("/api/v1/settings/storage-relocation")); }
      catch (error) {
        if (error instanceof DashboardClientError && error.kind === "http") throw error;
        throw new DashboardClientError({ kind: "schema", code: "STORAGE_RELOCATION_READ_UNAVAILABLE", message: "GET /api/v1/settings/storage-relocation: plan view could not be verified", cause: error });
      }
    },
    async pickSettingsPath(request: NativePathPickerRequest): Promise<NativePathPickerResponse> {
      const parsedRequest = NativePathPickerRequestSchema.parse(request);
      const response = await transport.requestJsonResponse("/api/v1/settings/path-picker", {
        method: "POST", body: JSON.stringify(parsedRequest),
      });
      const parsedResponse = NativePathPickerResponseSchema.safeParse(response.body);
      if (!parsedResponse.success) throw schemaError("POST /api/v1/settings/path-picker", parsedResponse.error);
      const result = parsedResponse.data;
      if (result.field !== parsedRequest.field) throw schemaError("POST /api/v1/settings/path-picker", "selected field differs from request");
      if ((result.state === "unavailable" && response.status !== (result.reason === "busy" ? 409 : 503))
        || (result.state !== "unavailable" && response.status !== 200)) throw httpError(response.status, response.body);
      return result;
    },
}); }
