import {
NativePathPickerRequestSchema,NativePathPickerResponseSchema,
type NativePathPickerRequest,type NativePathPickerResponse
} from "../../../models/dashboard/native-path-picker.js";
import { EditableSettingsWireSchema,type EditableSettingsWire } from "../../../models/dashboard/settings-editor.js";
import { SettingsFactsWireSchema,type SettingsFactsWire } from "../../../models/dashboard/settings.js";
import { DashboardClientError,httpError,schemaError } from "../errors.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";


export interface SettingsQueries {

  /** Settings' System hosts + Workflow capabilities, read-only. */
  settingsFacts(): Promise<SettingsFactsWire>;

  /** The closed server-owned editable leaves with current revision and provenance. */
  editableSettings(): Promise<EditableSettingsWire>;
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
      catch (cause) { throw new DashboardClientError({ kind: "schema", code: "SETTINGS_READ_UNAVAILABLE", message: "GET /api/v1/settings/editable: settings could not be read or verified", cause }); }
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
