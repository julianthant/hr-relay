import { z } from "zod";
import { OperatorXlsxExportRequestSchema } from "./xlsx-export.js";
export const SearchMetadataExportRequestSchema=z.strictObject({
  format:z.enum(["csv","diagnostic"]),selection:OperatorXlsxExportRequestSchema.shape.selection,
}).refine(request=>request.selection.kind==="search",{message:"metadata exports require a reviewed search selection"});
export type SearchMetadataExportRequest=z.infer<typeof SearchMetadataExportRequestSchema>;
