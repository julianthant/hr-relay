import { createOperatorXlsxExportService, type OperatorXlsxExportServiceDependencies } from "../exports/operator-xlsx-export-service.js";
/** G's composed export boundary; the service verifies bytes before evidence is committed. */
export function composeGeneratedExports(dependencies:OperatorXlsxExportServiceDependencies){
 return createOperatorXlsxExportService(dependencies);
}
