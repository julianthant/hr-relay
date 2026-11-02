import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import { WorkflowWorkbookCommandSchema, WorkflowWorkbookResultSchema } from "../../../models/workbooks/workflow-workbook.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { createWorkflowWorkbookService } from "../../workbooks/workflow-workbook-service.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-service.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";

export function createWorkbookLibraryAdapter(deps: Parameters<typeof createWorkflowWorkbookService>[0] & Readonly<{ runId: string }>): ProviderAdapter<"workbooks.library"> {
  const service = createWorkflowWorkbookService(deps);
  const adapter: ProviderAdapter<"workbooks.library"> = {
    capability: "workbooks.library",
    async invoke(request, options) {
      if (request.capability !== "workbooks.library") throw new Error("workbook-provider-capability-mismatch");
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
