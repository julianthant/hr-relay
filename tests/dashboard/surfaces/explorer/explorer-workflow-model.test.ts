import { servedFixtureSources as previewFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { describe as describe_m0,describe as describe_m1,expect as expect_m0,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { allFields as allFields_m0,allFields as allFields_m1 } from "../../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { buildWorkflowMock as buildWorkflowMock_m0,buildWorkflowMock as buildWorkflowMock_m1,initialWorkflowChoices as initialWorkflowChoices_m0,initialWorkflowChoices as initialWorkflowChoices_m1,updateWorkflowChoice as updateWorkflowChoice_m0,updateWorkflowChoice as updateWorkflowChoice_m1,workflowChoices as workflowChoices_m0,workflowContractSource as workflowContractSource_m0,workflowContractSource as workflowContractSource_m1 } from "../../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { MOCK_WORKFLOWS as MOCK_WORKFLOWS_m0 } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { buildWorkflowCatalog as buildWorkflowCatalog_m0 } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";


{

describe_m0("complete workflow presentation mocks", () => {
  it_m0("covers every rail workflow and renders every declared variant without missing contract values", () => {
    expect_m0(new Set(buildWorkflowCatalog_m0([], true, previewFixtureSources([])).map(item => item.id))).toEqual(new Set(MOCK_WORKFLOWS_m0.filter(item => !["ocr", "i9-lookup"].includes(item.id)).map(item => item.id)));
    for (const flow of MOCK_WORKFLOWS_m0) {
      const values = initialWorkflowChoices_m0(flow.id);
      for (const scenario of [values, ...workflowChoices_m0(flow.id).flatMap(choice => choice.options.map(([value]) => updateWorkflowChoice_m0(flow.id, values, choice.key, value)))]) {
        const result = buildWorkflowMock_m0(flow.id, scenario);
        expect_m0(result.steps.length).toBeGreaterThan(1);
        for (const step of result.steps) for (const field of allFields_m0(step.parts)) {
          expect_m0(field.value.length).toBeGreaterThan(0);
          if (field.mode === "fill") expect_m0(workflowContractSource_m0(flow.id, scenario, field, step.number)).toBeDefined();
        }
      }
    }
  });
  it_m0("stops Oath Upload, missing OnBase identity and unavailable I-9 at the correct dependency", () => {
    for (const [id, key, value, title] of [["oath-upload", "signers", "failed", "Wait signatures"], ["onbase", "keyset", "missing", "Fill keywords"], ["i9-lookup", "profile", "unavailable", "Lookup"]] as const) {
      const flow = buildWorkflowMock_m0(id, updateWorkflowChoice_m0(id, initialWorkflowChoices_m0(id), key, value));
      expect_m0(flow.steps.find(step => step.number === flow.stopAfter)!.title).toBe(title);
    }
    const ocr = buildWorkflowMock_m0("ocr", initialWorkflowChoices_m0("ocr"));
    expect_m0(ocr.steps.map(step => step.title)).toContain("Your review");
    const waiting = buildWorkflowMock_m0("ocr", updateWorkflowChoice_m0("ocr", initialWorkflowChoices_m0("ocr"), "review", "waiting"));
    expect_m0(waiting.steps.find(step => step.number === waiting.stopAfter)!.title).toBe("Your review");
    expect_m0(() => updateWorkflowChoice_m0("ocr", initialWorkflowChoices_m0("ocr"), "form", "invented")).toThrow("EXPLORER_CHOICE_INVALID");
  });
  it_m0("expands a host's OCR delegation into its read and match steps without duplicate titles", () => {
    for (const id of ["i9-check-start", "emergency-contact", "onbase", "oath-upload"] as const) {
      const titles = buildWorkflowMock_m0(id, initialWorkflowChoices_m0(id)).steps.map(step => step.title);
      expect_m0(titles).toContain("Read forms"); expect_m0(titles).not.toContain("OCR extraction");
      expect_m0(new Set(titles).size).toBe(titles.length);
    }
    const i9 = buildWorkflowMock_m0("i9-check-start", initialWorkflowChoices_m0("i9-check-start"));
    expect_m0(i9.steps.map(step => step.title)).toContain("Roster match");
    const missing = buildWorkflowMock_m0("i9-check-start", updateWorkflowChoice_m0("i9-check-start", initialWorkflowChoices_m0("i9-check-start"), "pair", "missing"));
    expect_m0(missing.steps.find(step => step.number === missing.stopAfter)!.title).toBe("Read forms");
  });
});
}

{


describe_m1("source-backed workflow operation detail", () => {
  it_m1("resolves Explorer's detailed field provenance and excludes evidence for unavailable outcomes", () => {
    for (const id of ["work-study", "onbase", "oath-upload", "old-kronos-reports", "ocr"] as const) {
      const choices = initialWorkflowChoices_m1(id), mock = buildWorkflowMock_m1(id, choices);
      const detail = mock.steps.flatMap(step => allFields_m1(step.parts).filter(field => field.source?.startsWith("operation:")).map(field => [field, step.number] as const));
      expect_m1(detail.length, id).toBeGreaterThan(0);
      for (const [field, step] of detail) expect_m1(workflowContractSource_m1(id, choices, field, step)?.origin).toBeTruthy();
    }
    const absent = buildWorkflowMock_m1("i9-lookup", updateWorkflowChoice_m1("i9-lookup", initialWorkflowChoices_m1("i9-lookup"), "profile", "absent"));
    expect_m1(absent.steps.flatMap(step => allFields_m1(step.parts)).some(field => field.value === "Section 2 complete")).toBe(false);
    const mismatch = buildWorkflowMock_m1("old-kronos-reports", updateWorkflowChoice_m1("old-kronos-reports", initialWorkflowChoices_m1("old-kronos-reports"), "pdf", "mismatch"));
    expect_m1(mismatch.steps.flatMap(step => allFields_m1(step.parts)).some(field => field.label === "Identity match" && field.value === "Confirmed")).toBe(false);
  });
});
}
