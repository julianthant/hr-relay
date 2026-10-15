import ts from "typescript";





export function createRetainedDashboardMockFixtures() {
  const RETAINED_MOCK_SITES: Readonly<Record<string, readonly string[]>> = {
    "src/dashboard/surfaces/sessions/sessions-fixture.ts": [
      "[\"separations\",[\"StringLiteral:\",\"LiteralType:\",\"UnionType:\",\"Parameter:workflow\",\"FunctionDeclaration:sampleTimeline\"],\"\\\"separations\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"LiteralType:\",\"UnionType:\",\"Parameter:workflow\",\"FunctionDeclaration:sampleTimeline\"],\"\\\"person-lookup\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"PropertyAccessExpression:map\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:sampleTimeline\"],\"workflow===\\\"separations\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"separations\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"sampleTimeline(\\\"separations\\\",11)\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"sampleTimeline(\\\"person-lookup\\\",3)\"]",
      "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"separations\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"sampleTimeline(\\\"separations\\\",0)\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"person-lookup\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:workers\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"CaseClause:\",\"CaseBlock:\",\"SwitchStatement:\",\"Block:\",\"FunctionDeclaration:sessionsSample\"],\"sampleTimeline(\\\"separations\\\",14,\\\"waiting\\\")\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:workers\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"CaseClause:\",\"CaseBlock:\",\"SwitchStatement:\",\"Block:\",\"FunctionDeclaration:sessionsSample\"],\"sampleTimeline(\\\"person-lookup\\\",3,\\\"failed\\\")\"]",
      "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:workers\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"CaseClause:\",\"CaseBlock:\",\"SwitchStatement:\",\"Block:\",\"FunctionDeclaration:sessionsSample\"],\"sampleTimeline(\\\"separations\\\",11,\\\"paused\\\")\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-manual-model.ts": [
      "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:formStepIsLocked\"],\"id===\\\"separations\\\"\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
      "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"separations\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{sampleOutcomes:[{label:\\\"Active\\\",tone:\\\"success\\\",lookupMode:\\\"search\\\"},{label:\\\"Inactive\\\",tone:\\\"neutral\\\",lookupMode:\\\"search\\\"},{label:\\\"CRMonly\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Multiplematches\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Notfound\\\",tone:\\\"neutral\\\",lookupMode:\\\"search\\\"},{label:\\\"Undetermined\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Found\\\",tone:\\\"success\\\",lookupMode:\\\"match\\\"},{label:\\\"NotfoundinUCPath\\\",tone:\\\"neutral\\\",lookupMode:\\\"match\\\"},],runnable:true,methods:[\\\"typed\\\"],inputLabel:\\\"EmployeeIDsornames\\\",placeholder:\\\"10000001;Lee,Jordan\\\",example:\\\"10000001\\\",dryRun:false,roster:false,steps:[step(\\\"searching\\\",\\\"Searchforperson\\\",\\\"UCPath\\\",\\\"SearchPersonOrgSummarybyEmployeeIDorname;MatchusesHR-Taskspersonmatching.\\\"),step(\\\"cross-verification\\\",\\\"Cross-checkidentity\\\",\\\"CRM\\\",\\\"Cross-checkthenamematchagainstCRMwhenCRMcheckisenabled.\\\"),step(\\\"active-status\\\",\\\"Reademploymentstatus\\\",\\\"UCPath\\\",\\\"Readdepartment,HRstatusandemploymentdates.\\\"),step(\\\"crm-dates\\\",\\\"ReadCRMdates\\\",\\\"CRM\\\",\\\"Readfirstdayofserviceandoathdateonlywhenrequestedbyaparentworkflow.\\\"),],result:[[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]]}\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"CallExpression:\",\"PropertyAccessExpression:map\",\"CallExpression:\",\"PropertyAccessExpression:filter\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockInputEntries\"],\"id===\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"person-lookup\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"separations\\\"\"]",
      "[\"separations\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"onboarding\\\",\\\"separations\\\",\\\"crm-doc-download\\\"]\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"person-lookup\\\"\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:label\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:description\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:placeholder\",\"JsxAttributes:\",\"JsxSelfClosingElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
      "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{searching:[fill(\\\"Searchcriteria\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Campus\\\",\\\"SDCMP\\\"]]),click(\\\"SearchPersonOrganizationalSummary\\\"),read(\\\"UCPathperson\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"Jobtitle\\\",\\\"Studentassistant\\\"],[\\\"Jobrecord\\\",\\\"0\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]])],\\\"cross-verification\\\":[click(\\\"FindtheonboardingrecordinCRM\\\"),read(\\\"Identitycross-check\\\",[[\\\"UCPathname\\\",\\\"$name\\\"],[\\\"CRMname\\\",\\\"$name\\\"],[\\\"Campusemail\\\",\\\"$email\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Match\\\",\\\"Confirmed\\\"]])],\\\"active-status\\\":[click(\\\"OpenWorkforceJobSummary\\\"),read(\\\"Employmentstatus\\\",[[\\\"HRstatus\\\",\\\"Active\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Enddate\\\",\\\"\u2014\\\"],[\\\"Terminationreason\\\",\\\"\u2014\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]])],\\\"crm-dates\\\":[read(\\\"Caller-requestedCRMdates\\\",[[\\\"Employmentdate\\\",\\\"08/03/2026\\\"],[\\\"Oathdate\\\",\\\"08/03/2026\\\"]])],}\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
      "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:employeeId\",\"ObjectLiteralExpression:\",\"VariableDeclaration:values\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.workflowId!==\\\"separations\\\"\"]",
      "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"person-lookup\\\"\"]"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
      "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"separations\\\"\"]"
    ]
  };

  function retainedLiteralSite(node: ts.StringLiteralLike, source: ts.SourceFile): string {
    const chain: string[] = [];
    let parent: ts.Node | undefined = node;
    while (parent !== undefined && !ts.isSourceFile(parent)) {
      const name = "name" in parent && parent.name !== undefined ? (parent.name as ts.Node).getText(source) : "";
      chain.push(`${ts.SyntaxKind[parent.kind]}:${name}`);
      parent = parent.parent;
    }
    return JSON.stringify([node.text, chain, ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node.parent, source).replace(/\s+/gu, "")]);
  }

  const RETAINED_MOCK_LITERALS: Readonly<Record<string, readonly string[]>> = {
    "src/dashboard/surfaces/sessions/sessions-fixture.ts": [
      "separations",
      "person-lookup",
      "separations",
      "separations",
      "separations",
      "person-lookup",
      "person-lookup",
      "separations",
      "separations",
      "person-lookup",
      "separations",
      "person-lookup",
      "separations"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-manual-model.ts": [
      "separations"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
      "separations",
      "person-lookup",
      "person-lookup"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
      "person-lookup",
      "person-lookup",
      "separations",
      "separations",
      "person-lookup",
      "person-lookup"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
      "person-lookup",
      "person-lookup",
      "person-lookup",
      "person-lookup"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
      "person-lookup"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
      "separations",
      "person-lookup"
    ],
    "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
      "separations"
    ]
  };
  return { RETAINED_MOCK_SITES, retainedLiteralSite, RETAINED_MOCK_LITERALS };
}
