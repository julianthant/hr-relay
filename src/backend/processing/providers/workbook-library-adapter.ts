import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import { WorkflowWorkbookCommandSchema, WorkflowWorkbookResultSchema } from "../../../models/processing/workbooks/read-result.js";
import { WorkbookReferenceReadRequestSchema, WorkbookReferenceReadResponseSchema } from "../../../models/processing/workbooks/read-reference.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { createWorkflowWorkbookService } from "../../workbooks/workflow-workbook-service.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";

export function createWorkbookLibraryAdapter(deps: Parameters<typeof createWorkflowWorkbookService>[0] & Readonly<{ runId: string }>): ProviderAdapter<"workbooks.library"> {
  const service = createWorkflowWorkbookService(deps);
  const adapter: ProviderAdapter<"workbooks.library"> = {
    capability: "workbooks.library",
    async invoke(request, options) {
      if (request.capability !== "workbooks.library") throw new Error("workbook-provider-capability-mismatch");
      if (request.payload.schemaHash === deriveSchemaHash(WorkbookReferenceReadRequestSchema, "output")) {
        const command = schemaBoundValueSchema(WorkbookReferenceReadRequestSchema, deriveSchemaHash(WorkbookReferenceReadRequestSchema, "output")).parse(request.payload).value;
        let result;
        try { result = service.readReference(deps.runId, command, options.signal); }
        catch (cause) {
          if (!(cause instanceof WorkbookLibraryError)) throw cause;
          result = WorkbookReferenceReadResponseSchema.parse({ state: "refused", code: cause.code, message: cause.message });
        }
        return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(WorkbookReferenceReadResponseSchema, "output"), value: result } },
          evidence: { summary: "Retained run workbook reference read", capturedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), providerRequestId: options.requestId } };
      }
      const command = schemaBoundValueSchema(WorkflowWorkbookCommandSchema, deriveSchemaHash(WorkflowWorkbookCommandSchema, "output")).parse(request.payload).value;
      let result;
      try { result = await service.publish(deps.runId, command, options.signal); }
      catch (cause) {
        if (!(cause instanceof WorkbookLibraryError)) throw cause;
        result = WorkflowWorkbookResultSchema.parse({ state: "refused", code: cause.code, message: cause.message });
      }
      return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(WorkflowWorkbookResultSchema, "output"), value: result } },
        evidence: { summary: "Local workbook library publication", capturedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), providerRequestId: options.requestId } };
    },
  };
  return Object.freeze(adapter);
}
