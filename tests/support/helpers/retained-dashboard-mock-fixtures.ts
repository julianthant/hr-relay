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
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:formStepIsLocked\"],\"id===\\\"separations\\\"\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:formStepIsLocked\"],\"id===\\\"i9-check\\\"\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:manualReadFields\"],\"[\\\"ocr\\\",\\\"i9-lookup\\\"]\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
    "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"separations\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"person-lookup\\\"\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"i9-lookup\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"onbase\\\"\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"i9-check\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{typedInput:{modeField:\\\"mode\\\",modeLabel:\\\"Lookupmode\\\",initialMode:\\\"search\\\",description:\\\"Eachentrystartsonerun.\\\",modes:[{value:\\\"search\\\",label:\\\"Search\\\",inputLabel:\\\"EmployeeIDsornames\\\",hint:\\\"Separatepeoplewithasemicolonoranewline.\\\",placeholder:\\\"10000001;Lee,Jordan\\\",defaults:[{field:\\\"crmCheck\\\",value:{kind:\\\"boolean\\\",value:true}},{field:\\\"keepNonHdh\\\",value:{kind:\\\"boolean\\\",value:false}},{field:\\\"includeCrmDates\\\",value:{kind:\\\"boolean\\\",value:false}}],parser:{kind:\\\"entries\\\",spec:{split:{kind:\\\"delimited\\\",delimiters:[\\\";\\\",\\\"\\\\n\\\"]},rules:[{when:{kind:\\\"pattern\\\",pattern:\\\"eid\\\"},emit:\\\"emplId\\\"},{when:{kind:\\\"otherwise\\\"},emit:\\\"name\\\"}]}},display:{kind:\\\"first-present\\\",fields:[\\\"emplId\\\",\\\"name\\\"]},identityFields:[\\\"emplId\\\",\\\"name\\\"],},{value:\\\"match\\\",label:\\\"Match\\\",inputLabel:\\\"Name,DOBandSSN\\\",hint:\\\"Last,First,DOB,SSN.UsexforanunavailableDOBorSSN,butnotboth.Separatepeoplewithsemicolons.\\\",placeholder:\\\"Lee,Jordan,01/01/2000,x\\\",defaults:[{field:\\\"crmCheck\\\",value:{kind:\\\"boolean\\\",value:false}},{field:\\\"includeCrmDates\\\",value:{kind:\\\"boolean\\\",value:false}}],parser:{kind:\\\"name-tuple\\\",delimiter:\\\";\\\",familyName:\\\"lastName\\\",givenName:\\\"firstName\\\",identifiers:[{field:\\\"dob\\\",canonicalField:\\\"text\\\"},{field:\\\"ssn\\\",canonicalField:\\\"ssn\\\"}],missing:\\\"x\\\",missingIdentifiersCode:\\\"PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS\\\"},display:{kind:\\\"tuple\\\",fields:[\\\"lastName\\\",\\\"firstName\\\",\\\"dob\\\",\\\"ssn\\\"],separator:\\\",\\\",missing:\\\"x\\\",masked:[\\\"ssn\\\"]},identityFields:[\\\"lastName\\\",\\\"firstName\\\",\\\"dob\\\",\\\"ssn\\\"],},],controls:[{field:\\\"crmCheck\\\",label:\\\"CRMcheck\\\",placement:\\\"input\\\",modes:[\\\"search\\\",\\\"match\\\"],requires:[]},{field:\\\"keepNonHdh\\\",label:\\\"Keepnon-HDHcandidates\\\",placement:\\\"hidden\\\",modes:[\\\"search\\\"],requires:[]},{field:\\\"includeCrmDates\\\",label:\\\"ReadCRMdates\\\",placement:\\\"step\\\",modes:[\\\"search\\\"],requires:[\\\"crmCheck\\\"]},],},sampleOutcomes:[{label:\\\"Active\\\",tone:\\\"success\\\",lookupMode:\\\"search\\\"},{label:\\\"Inactive\\\",tone:\\\"neutral\\\",lookupMode:\\\"search\\\"},{label:\\\"CRMonly\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Multiplematches\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Notfound\\\",tone:\\\"neutral\\\",lookupMode:\\\"search\\\"},{label:\\\"Undetermined\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Found\\\",tone:\\\"success\\\",lookupMode:\\\"match\\\"},{label:\\\"NotfoundinUCPath\\\",tone:\\\"neutral\\\",lookupMode:\\\"match\\\"},],runnable:true,methods:[\\\"typed\\\"],inputLabel:\\\"EmployeeIDsornames\\\",placeholder:\\\"10000001;Lee,Jordan\\\",example:\\\"10000001\\\",dryRun:false,roster:false,steps:[step(\\\"searching\\\",\\\"Searchforperson\\\",\\\"UCPath\\\",\\\"SearchPersonOrgSummarybyEmployeeIDorname;MatchusesHR-Taskspersonmatching.\\\"),step(\\\"cross-verification\\\",\\\"Cross-checkidentity\\\",\\\"CRM\\\",\\\"Cross-checkthenamematchagainstCRMwhenCRMcheckisenabled.\\\"),step(\\\"active-status\\\",\\\"Reademploymentstatus\\\",\\\"UCPath\\\",\\\"Readdepartment,HRstatusandemploymentdates.\\\"),step(\\\"crm-dates\\\",\\\"ReadCRMdates\\\",\\\"CRM\\\",\\\"Readfirstdayofserviceandoathdateonlywhenrequestedbyaparentworkflow.\\\"),],result:[[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]]}\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-lookup\\\":{runnable:false,methods:[\\\"delegated\\\"],inputLabel:\\\"Person\\\",placeholder:\\\"Lee,Jordan\\\",example:\\\"Lee,Jordan\\\",dryRun:false,roster:false,steps:[step(\\\"lookup\\\",\\\"ReadSection2signer\\\",\\\"I-9Complete\\\",\\\"Searchbylastandfirstname,optionallySSN,andreadtheauthorizedofficialsignerandI-9status.\\\"),],result:[[\\\"Authorizedofficialsigner\\\",\\\"JamieMorgan\\\"],[\\\"I-9status\\\",\\\"Section2complete\\\"]]}\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-check\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-check\\\":{runnable:true,methods:[\\\"pdf\\\"],inputLabel:\\\"PDFs\\\",placeholder:\\\"\\\",example:\\\"i9-packet.pdf\\\",dryRun:false,roster:false,steps:[step(\\\"person-match\\\",\\\"MatchpersoninUCPath\\\",\\\"UCPath\\\",\\\"UsethepairedSection1/2identitytosearchUCPath.\\\"),step(\\\"employment-dates\\\",\\\"Reademploymentdates\\\",\\\"UCPath\\\",\\\"Readtheemploymentandseparationdates;noUCPathtransactionissubmitted.\\\"),step(\\\"roster-match\\\",\\\"Appendretentiontrackerrow\\\",undefined,\\\"MatchtheconfiguredActionHistoryrosterbyEmployeeIDandappendaretention-trackerrow.Arerunappendsagain.\\\"),],result:[[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"PPSID\\\",\\\"DEMO-PPS-001\\\"],[\\\"Section1present\\\",\\\"Yes\\\"],[\\\"Section2present\\\",\\\"Yes\\\"],[\\\"FoundinUCPath?\\\",\\\"Yes\\\"]]}\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:initialMockDraft\"],\"id===\\\"i9-check\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:initialMockDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"CallExpression:\",\"PropertyAccessExpression:map\",\"CallExpression:\",\"PropertyAccessExpression:filter\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockInputEntries\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"separations\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"onboarding\\\",\\\"separations\\\",\\\"crm-doc-download\\\"]\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"onbase\\\"\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"id===\\\"i9-check\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"id===\\\"onbase\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"person-lookup\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"i9-check\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"BinaryExpression:\",\"ExpressionStatement:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"BinaryExpression:\",\"ExpressionStatement:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"i9-check\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:subjects\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadAssignment:\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"PropertyAssignment:draft\",\"ObjectLiteralExpression:\",\"ParenthesizedExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:created\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadAssignment:\",\"ObjectLiteralExpression:\",\"VariableDeclaration:draft\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:runs\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:seedMockRuns\"],\"flow.id===\\\"onbase\\\"\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"ConditionalExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:seedMockRuns\"],\"[\\\"i9-lookup\\\",\\\"sharepoint-download\\\"]\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:fields\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"i9-check\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockLaunchCount\"],\"id===\\\"onbase\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"onbase\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{searching:[fill(\\\"Searchcriteria\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Campus\\\",\\\"SDCMP\\\"]]),click(\\\"SearchPersonOrganizationalSummary\\\"),read(\\\"UCPathperson\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"Jobtitle\\\",\\\"Studentassistant\\\"],[\\\"Jobrecord\\\",\\\"0\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]])],\\\"cross-verification\\\":[click(\\\"FindtheonboardingrecordinCRM\\\"),read(\\\"Identitycross-check\\\",[[\\\"UCPathname\\\",\\\"$name\\\"],[\\\"CRMname\\\",\\\"$name\\\"],[\\\"Campusemail\\\",\\\"$email\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Match\\\",\\\"Confirmed\\\"]])],\\\"active-status\\\":[click(\\\"OpenWorkforceJobSummary\\\"),read(\\\"Employmentstatus\\\",[[\\\"HRstatus\\\",\\\"Active\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Enddate\\\",\\\"—\\\"],[\\\"Terminationreason\\\",\\\"—\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]])],\\\"crm-dates\\\":[read(\\\"Caller-requestedCRMdates\\\",[[\\\"Employmentdate\\\",\\\"08/03/2026\\\"],[\\\"Oathdate\\\",\\\"08/03/2026\\\"]])],}\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-lookup\\\":{lookup:[fill(\\\"Portalpersonsearch\\\",[[\\\"Lastname\\\",\\\"$lastName\\\"],[\\\"Firstname\\\",\\\"$firstName\\\"],[\\\"SSN\\\",\\\"•••-••-0001\\\"]]),click(\\\"Searchandopenthematchingprofile\\\"),read(\\\"Section2\\\",[[\\\"I-9status\\\",\\\"Section2complete\\\"],[\\\"Authorizedofficialsigner\\\",\\\"AlexMorgan\\\"],[\\\"ProfileID\\\",\\\"DEMO-I9-001\\\"]])]}\"]",
    "[\"i9-check\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-check\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-check\\\":{\\\"person-match\\\":[read(\\\"PairedI-9identity\\\",[[\\\"Employee\\\",\\\"$name\\\"],[\\\"Section1page\\\",\\\"$section1\\\"],[\\\"Section2page\\\",\\\"$section2\\\"],[\\\"HiredatefromI-9\\\",\\\"08/03/2026\\\"]]),fill(\\\"UCPathpersonsearch\\\",[[\\\"Name\\\",\\\"$name\\\"],[\\\"EmployeeID\\\",\\\"$employeeId\\\"]]),read(\\\"Searchresult\\\",[[\\\"MatchedEmployeeID\\\",\\\"$employeeId\\\"],[\\\"Candidates\\\",\\\"1\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]])],\\\"employment-dates\\\":[read(\\\"Employmentevidence\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"UCPathhiredate\\\",\\\"08/03/2026\\\"],[\\\"I-9hiredate\\\",\\\"08/03/2026\\\"],[\\\"Hiredatematch\\\",\\\"Confirmed\\\"]])],\\\"roster-match\\\":[read(\\\"ActionHistorymatch\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"PPSID\\\",\\\"DEMO-PPS-001\\\"],[\\\"Separationdate\\\",\\\"Notseparated\\\"]]),read(\\\"Retentiontrackerrow\\\",[[\\\"Employee\\\",\\\"$name\\\"],[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"PPSID\\\",\\\"DEMO-PPS-001\\\"],[\\\"Section1present\\\",\\\"Yes\\\"],[\\\"Section2present\\\",\\\"Yes\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]]),click(\\\"Appendretentiontrackerrow\\\",true)],}\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:employeeId\",\"ObjectLiteralExpression:\",\"VariableDeclaration:values\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.workflowId!==\\\"separations\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"VariableDeclaration:values\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.parentWorkflowId===\\\"onbase\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"person-lookup\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
    "[\"i9-check\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"i9-check\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"separations\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"JsxExpression:\",\"JsxAttribute:className\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:description\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-preview-contracts.ts": [
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:\\\"contract\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:\\\"contract\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:\\\"contract\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:\\\"contract\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:\\\"contract\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"system\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:\\\"contract\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:nodes\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_GRAPHS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"system\\\":\\\"onbase\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-result-model.ts": [
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockFieldValue\"],\"run.workflowId===\\\"onbase\\\"\"]"
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
    "separations",
    "i9-check",
    "i9-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
    "separations",
    "person-lookup",
    "i9-lookup",
    "onbase",
    "i9-check",
    "person-lookup",
    "i9-lookup",
    "i9-check"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
    "i9-check",
    "onbase",
    "person-lookup",
    "person-lookup",
    "separations",
    "separations",
    "onbase",
    "i9-check",
    "onbase",
    "person-lookup",
    "onbase",
    "i9-check",
    "onbase",
    "i9-check",
    "onbase",
    "onbase",
    "onbase",
    "i9-lookup",
    "onbase",
    "i9-check",
    "onbase",
    "onbase",
    "person-lookup",
    "onbase"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
    "person-lookup",
    "i9-lookup",
    "i9-check"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
    "separations",
    "onbase",
    "person-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
    "i9-check",
    "onbase",
    "separations"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
    "onbase",
    "onbase",
    "onbase",
    "onbase"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-preview-contracts.ts": [
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase",
    "onbase"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-result-model.ts": [
    "onbase"
  ]
};

  return { RETAINED_MOCK_SITES, retainedLiteralSite, RETAINED_MOCK_LITERALS };
}
