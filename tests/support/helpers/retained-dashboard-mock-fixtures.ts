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
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:formStepIsLocked\"],\"id===\\\"i9-check-start\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:manualReadFields\"],\"[\\\"ocr\\\",\\\"i9-lookup\\\"]\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:manualReadFields\"],\"[\\\"ocr\\\",\\\"i9-lookup\\\"]\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
    "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"separations\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"onboarding\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"person-lookup\\\"\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"i9-lookup\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"ocr\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"emergency-contact\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"onbase\\\"\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"i9-check-start\\\"\"]",
    "[\"crm-doc-download\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"crm-doc-download\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{typedInput:{modeField:\\\"mode\\\",modeLabel:\\\"Lookupmode\\\",initialMode:\\\"search\\\",description:\\\"Eachentrystartsonerun.\\\",modes:[{value:\\\"search\\\",label:\\\"Search\\\",inputLabel:\\\"EmployeeIDsornames\\\",hint:\\\"Separatepeoplewithasemicolonoranewline.\\\",placeholder:\\\"10000001;Lee,Jordan\\\",defaults:[{field:\\\"crmCheck\\\",value:{kind:\\\"boolean\\\",value:true}},{field:\\\"keepNonHdh\\\",value:{kind:\\\"boolean\\\",value:false}},{field:\\\"includeCrmDates\\\",value:{kind:\\\"boolean\\\",value:false}}],parser:{kind:\\\"entries\\\",spec:{split:{kind:\\\"delimited\\\",delimiters:[\\\";\\\",\\\"\\\\n\\\"]},rules:[{when:{kind:\\\"pattern\\\",pattern:\\\"eid\\\"},emit:\\\"emplId\\\"},{when:{kind:\\\"otherwise\\\"},emit:\\\"name\\\"}]}},display:{kind:\\\"first-present\\\",fields:[\\\"emplId\\\",\\\"name\\\"]},identityFields:[\\\"emplId\\\",\\\"name\\\"],},{value:\\\"match\\\",label:\\\"Match\\\",inputLabel:\\\"Name,DOBandSSN\\\",hint:\\\"Last,First,DOB,SSN.UsexforanunavailableDOBorSSN,butnotboth.Separatepeoplewithsemicolons.\\\",placeholder:\\\"Lee,Jordan,01/01/2000,x\\\",defaults:[{field:\\\"crmCheck\\\",value:{kind:\\\"boolean\\\",value:false}},{field:\\\"includeCrmDates\\\",value:{kind:\\\"boolean\\\",value:false}}],parser:{kind:\\\"name-tuple\\\",delimiter:\\\";\\\",familyName:\\\"lastName\\\",givenName:\\\"firstName\\\",identifiers:[{field:\\\"dob\\\",canonicalField:\\\"text\\\"},{field:\\\"ssn\\\",canonicalField:\\\"ssn\\\"}],missing:\\\"x\\\",missingIdentifiersCode:\\\"PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS\\\"},display:{kind:\\\"tuple\\\",fields:[\\\"lastName\\\",\\\"firstName\\\",\\\"dob\\\",\\\"ssn\\\"],separator:\\\",\\\",missing:\\\"x\\\",masked:[\\\"ssn\\\"]},identityFields:[\\\"lastName\\\",\\\"firstName\\\",\\\"dob\\\",\\\"ssn\\\"],},],controls:[{field:\\\"crmCheck\\\",label:\\\"CRMcheck\\\",placement:\\\"input\\\",modes:[\\\"search\\\",\\\"match\\\"],requires:[]},{field:\\\"keepNonHdh\\\",label:\\\"Keepnon-HDHcandidates\\\",placement:\\\"hidden\\\",modes:[\\\"search\\\"],requires:[]},{field:\\\"includeCrmDates\\\",label:\\\"ReadCRMdates\\\",placement:\\\"step\\\",modes:[\\\"search\\\"],requires:[\\\"crmCheck\\\"]},],},sampleOutcomes:[{label:\\\"Active\\\",tone:\\\"success\\\",lookupMode:\\\"search\\\"},{label:\\\"Inactive\\\",tone:\\\"neutral\\\",lookupMode:\\\"search\\\"},{label:\\\"CRMonly\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Multiplematches\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Notfound\\\",tone:\\\"neutral\\\",lookupMode:\\\"search\\\"},{label:\\\"Undetermined\\\",tone:\\\"warning\\\",lookupMode:\\\"search\\\"},{label:\\\"Found\\\",tone:\\\"success\\\",lookupMode:\\\"match\\\"},{label:\\\"NotfoundinUCPath\\\",tone:\\\"neutral\\\",lookupMode:\\\"match\\\"},],runnable:true,methods:[\\\"typed\\\"],inputLabel:\\\"EmployeeIDsornames\\\",placeholder:\\\"10000001;Lee,Jordan\\\",example:\\\"10000001\\\",dryRun:false,roster:false,steps:[step(\\\"searching\\\",\\\"Searchforperson\\\",\\\"UCPath\\\",\\\"SearchPersonOrgSummarybyEmployeeIDorname;MatchusesHR-Taskspersonmatching.\\\"),step(\\\"cross-verification\\\",\\\"Cross-checkidentity\\\",\\\"CRM\\\",\\\"Cross-checkthenamematchagainstCRMwhenCRMcheckisenabled.\\\"),step(\\\"active-status\\\",\\\"Reademploymentstatus\\\",\\\"UCPath\\\",\\\"Readdepartment,HRstatusandemploymentdates.\\\"),step(\\\"crm-dates\\\",\\\"ReadCRMdates\\\",\\\"CRM\\\",\\\"Readfirstdayofserviceandoathdateonlywhenrequestedbyaparentworkflow.\\\"),],result:[[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]]}\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-lookup\\\":{runnable:false,methods:[\\\"delegated\\\"],inputLabel:\\\"Person\\\",placeholder:\\\"Lee,Jordan\\\",example:\\\"Lee,Jordan\\\",dryRun:false,roster:false,steps:[step(\\\"lookup\\\",\\\"ReadSection2signer\\\",\\\"I-9Complete\\\",\\\"Searchbylastandfirstname,optionallySSN,andreadtheauthorizedofficialsignerandI-9status.\\\"),],result:[[\\\"Authorizedofficialsigner\\\",\\\"JamieMorgan\\\"],[\\\"I-9status\\\",\\\"Section2complete\\\"]]}\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"PropertyAssignment:\\\"emergency-contact\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"emergency-contact\\\":{runnable:true,methods:[\\\"pdf\\\"],inputLabel:\\\"PDFs\\\",placeholder:\\\"\\\",example:\\\"emergency-contact.pdf\\\",dryRun:true,roster:true,steps:[step(\\\"navigation\\\",\\\"Readexistingcontacts\\\",\\\"UCPath\\\",\\\"Findtheemployeeandinspectexistingemergencycontactstoavoidanexactduplicate.\\\"),step(\\\"fill-form\\\",\\\"Fillemergencycontact\\\",\\\"UCPath\\\",\\\"Enterthereviewedcontact'sname,relationship,phoneandavailableaddress.\\\"),step(\\\"save\\\",\\\"Saveemergencycontact\\\",\\\"UCPath\\\",\\\"Savethecontactandverifytheresult;anexactexistingcontactisskipped.\\\",true),],result:[[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"Contact\\\",\\\"AlexLee\\\"],[\\\"Relationship\\\",\\\"Sibling\\\"],[\\\"Contactphone\\\",\\\"(202)555-0102\\\"]]}\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-check-start\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-check-start\\\":{runnable:true,methods:[\\\"pdf\\\"],inputLabel:\\\"PDFs\\\",placeholder:\\\"\\\",example:\\\"i9-packet.pdf\\\",dryRun:false,roster:false,steps:[step(\\\"person-match\\\",\\\"MatchpersoninUCPath\\\",\\\"UCPath\\\",\\\"UsethepairedSection1/2identitytosearchUCPath.\\\"),step(\\\"employment-dates\\\",\\\"Reademploymentdates\\\",\\\"UCPath\\\",\\\"Readtheemploymentandseparationdates;noUCPathtransactionissubmitted.\\\"),step(\\\"roster-match\\\",\\\"Appendretentiontrackerrow\\\",undefined,\\\"MatchtheconfiguredActionHistoryrosterbyEmployeeIDandappendaretention-trackerrow.Arerunappendsagain.\\\"),],result:[[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"PPSID\\\",\\\"DEMO-PPS-001\\\"],[\\\"Section1present\\\",\\\"Yes\\\"],[\\\"Section2present\\\",\\\"Yes\\\"],[\\\"FoundinUCPath?\\\",\\\"Yes\\\"]]}\"]",
    "[\"crm-doc-download\",[\"StringLiteral:\",\"PropertyAssignment:\\\"crm-doc-download\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"crm-doc-download\\\":{runnable:true,methods:[\\\"typed\\\"],inputLabel:\\\"EmployeeIDsoremails\\\",placeholder:\\\"10000001,jordan.lee@example.com\\\",example:\\\"10000001\\\",dryRun:false,roster:false,steps:[step(\\\"search-record\\\",\\\"FindCRMrecord\\\",\\\"CRM\\\",\\\"SearchfortheonboardingrecordusingEmployeeIDoremail.\\\"),step(\\\"download\\\",\\\"Downloaddocuments\\\",\\\"CRM\\\",\\\"Downloadtherecord'sstoredPDFsintotheemployeefolder.\\\"),step(\\\"archive\\\",\\\"Archivedownloadeddocuments\\\",undefined,\\\"FinishthedocumentfolderandrecordthedownloadedPDFpaths.\\\"),],result:[[\\\"PDFs\\\",\\\"entry-sheet.pdf,onboarding-packet.pdf\\\"],[\\\"Folder\\\",\\\"JordanLee\\\"]]}\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"PropertyAssignment:value\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:MOCK_FORM_TYPES\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"value:\\\"emergency-contact\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:initialMockDraft\"],\"id===\\\"i9-check-start\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:initialMockDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:initialMockDraft\"],\"id===\\\"emergency-contact\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:initialMockDraft\"],\"id===\\\"emergency-contact\\\"?\\\"emergency-contact\\\":\\\"oath\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"CallExpression:\",\"PropertyAccessExpression:map\",\"CallExpression:\",\"PropertyAccessExpression:filter\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockInputEntries\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"onboarding\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"separations\\\"\"]",
    "[\"crm-doc-download\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"crm-doc-download\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"onboarding\\\",\\\"separations\\\",\\\"crm-doc-download\\\"]\"]",
    "[\"separations\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"onboarding\\\",\\\"separations\\\",\\\"crm-doc-download\\\"]\"]",
    "[\"crm-doc-download\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"onboarding\\\",\\\"separations\\\",\\\"crm-doc-download\\\"]\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"ocr\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"oath\\\",\\\"emergency-contact\\\",\\\"onbase-emergency-contact\\\",\\\"i9\\\"]\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"onbase\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"id===\\\"emergency-contact\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"id===\\\"emergency-contact\\\"?\\\"emergency-contact\\\":id===\\\"i9-check-start\\\"?\\\"i9\\\":id===\\\"onbase\\\"?mockOnbaseDocumentType(draft.documentType).formType:draft.formType\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"id===\\\"i9-check-start\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"id===\\\"onbase\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:label\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOcrReadSteps\"],\"type===\\\"emergency-contact\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockPipeline\"],\"id===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockNeedsReview\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockWaitsForOcr\"],\"run.workflowId!==\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"person-lookup\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"onboarding\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:gate\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockRunPipeline\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:delegateMockOcr\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"VariableDeclaration:ocr\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:delegateMockOcr\"],\"workflowId:\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"PropertyAssignment:records\",\"ObjectLiteralExpression:\",\"VariableDeclaration:ocr\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:delegateMockOcr\"],\"workflowId:\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"emergency-contact\\\"\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"i9-check-start\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"BinaryExpression:\",\"ExpressionStatement:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"BinaryExpression:\",\"ExpressionStatement:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"i9-check-start\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"BinaryExpression:\",\"ExpressionStatement:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"i9-check-start\\\"?\\\"i9\\\":\\\"emergency-contact\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:subjects\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadAssignment:\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"PropertyAssignment:draft\",\"ObjectLiteralExpression:\",\"ParenthesizedExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:created\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"onbase\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadAssignment:\",\"ObjectLiteralExpression:\",\"ParenthesizedExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:created\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockRunsForDraft\"],\"id===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"PropertyAccessExpression:flatMap\",\"CallExpression:\",\"VariableDeclaration:runs\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:seedMockRuns\"],\"flow.id!==\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadAssignment:\",\"ObjectLiteralExpression:\",\"VariableDeclaration:draft\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:runs\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:seedMockRuns\"],\"flow.id===\\\"onbase\\\"\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"ConditionalExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:seedMockRuns\"],\"[\\\"i9-lookup\\\",\\\"sharepoint-download\\\"]\"]",
    "[\"ocr\",[\"StringLiteral:\",\"PropertyAssignment:parentWorkflowId\",\"ObjectLiteralExpression:\",\"ConditionalExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:seedMockRuns\"],\"parentWorkflowId:\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"WhileStatement:\",\"Block:\",\"FunctionDeclaration:mockRetrySource\"],\"source.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:root\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockDeletionIds\"],\"target.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:fields\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"i9-check-start\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:resultFields\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockLaunchCount\"],\"id===\\\"onbase\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"onboarding\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"onbase\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{searching:[fill(\\\"Searchcriteria\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Campus\\\",\\\"SDCMP\\\"]]),click(\\\"SearchPersonOrganizationalSummary\\\"),read(\\\"UCPathperson\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"Jobtitle\\\",\\\"Studentassistant\\\"],[\\\"Jobrecord\\\",\\\"0\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]])],\\\"cross-verification\\\":[click(\\\"FindtheonboardingrecordinCRM\\\"),read(\\\"Identitycross-check\\\",[[\\\"UCPathname\\\",\\\"$name\\\"],[\\\"CRMname\\\",\\\"$name\\\"],[\\\"Campusemail\\\",\\\"$email\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Match\\\",\\\"Confirmed\\\"]])],\\\"active-status\\\":[click(\\\"OpenWorkforceJobSummary\\\"),read(\\\"Employmentstatus\\\",[[\\\"HRstatus\\\",\\\"Active\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Enddate\\\",\\\"—\\\"],[\\\"Terminationreason\\\",\\\"—\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]])],\\\"crm-dates\\\":[read(\\\"Caller-requestedCRMdates\\\",[[\\\"Employmentdate\\\",\\\"08/03/2026\\\"],[\\\"Oathdate\\\",\\\"08/03/2026\\\"]])],}\"]",
    "[\"i9-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-lookup\\\":{lookup:[fill(\\\"Portalpersonsearch\\\",[[\\\"Lastname\\\",\\\"$lastName\\\"],[\\\"Firstname\\\",\\\"$firstName\\\"],[\\\"SSN\\\",\\\"•••-••-0001\\\"]]),click(\\\"Searchandopenthematchingprofile\\\"),read(\\\"Section2\\\",[[\\\"I-9status\\\",\\\"Section2complete\\\"],[\\\"Authorizedofficialsigner\\\",\\\"AlexMorgan\\\"],[\\\"ProfileID\\\",\\\"DEMO-I9-001\\\"]])]}\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"PropertyAssignment:\\\"emergency-contact\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"emergency-contact\\\":{navigation:[click(\\\"Opentheemployee'semergency-contactpage\\\"),read(\\\"Identityandexistingcontacts\\\",[[\\\"Employee\\\",\\\"$name\\\"],[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Existingcontact\\\",\\\"Noexact-nameduplicate\\\"],[\\\"Existingprimary\\\",\\\"None\\\"]]),click(\\\"ViewAllandscanforablankcontactrow\\\")],\\\"fill-form\\\":[fill(\\\"Contactdetails\\\",[[\\\"Primarycontact\\\",\\\"Yes\\\"],[\\\"Contactname\\\",\\\"$contactName\\\"],[\\\"Relationship\\\",\\\"$relationship\\\"],[\\\"Phone\\\",\\\"$phone\\\"],[\\\"Sameaddressasemployee\\\",\\\"$sameAddress\\\"]]),fill(\\\"Contactaddress\\\",[[\\\"Street\\\",\\\"$street\\\"],[\\\"City\\\",\\\"$city\\\"],[\\\"State\\\",\\\"$state\\\"],[\\\"ZIP\\\",\\\"$zip\\\"],[\\\"Country\\\",\\\"$country\\\"]])],save:[click(\\\"Saveemergencycontact\\\",true),read(\\\"Savedcontact\\\",[[\\\"Contactname\\\",\\\"$contactName\\\"],[\\\"Relationship\\\",\\\"$relationship\\\"],[\\\"Phone\\\",\\\"$phone\\\"],[\\\"Primarycontact\\\",\\\"Yes\\\"]],\\\"Contactrowre-readontheemployee'srecord.\\\")],}\"]",
    "[\"i9-check-start\",[\"StringLiteral:\",\"PropertyAssignment:\\\"i9-check-start\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"i9-check-start\\\":{\\\"person-match\\\":[read(\\\"PairedI-9identity\\\",[[\\\"Employee\\\",\\\"$name\\\"],[\\\"Section1page\\\",\\\"$section1\\\"],[\\\"Section2page\\\",\\\"$section2\\\"],[\\\"HiredatefromI-9\\\",\\\"08/03/2026\\\"]]),fill(\\\"UCPathpersonsearch\\\",[[\\\"Name\\\",\\\"$name\\\"],[\\\"EmployeeID\\\",\\\"$employeeId\\\"]]),read(\\\"Searchresult\\\",[[\\\"MatchedEmployeeID\\\",\\\"$employeeId\\\"],[\\\"Candidates\\\",\\\"1\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]])],\\\"employment-dates\\\":[read(\\\"Employmentevidence\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"UCPathhiredate\\\",\\\"08/03/2026\\\"],[\\\"I-9hiredate\\\",\\\"08/03/2026\\\"],[\\\"Hiredatematch\\\",\\\"Confirmed\\\"]])],\\\"roster-match\\\":[read(\\\"ActionHistorymatch\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"PPSID\\\",\\\"DEMO-PPS-001\\\"],[\\\"Separationdate\\\",\\\"Notseparated\\\"]]),read(\\\"Retentiontrackerrow\\\",[[\\\"Employee\\\",\\\"$name\\\"],[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"PPSID\\\",\\\"DEMO-PPS-001\\\"],[\\\"Section1present\\\",\\\"Yes\\\"],[\\\"Section2present\\\",\\\"Yes\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]]),click(\\\"Appendretentiontrackerrow\\\",true)],}\"]",
    "[\"crm-doc-download\",[\"StringLiteral:\",\"PropertyAssignment:\\\"crm-doc-download\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"crm-doc-download\\\":{\\\"search-record\\\":[read(\\\"Rosteridentity\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Rosteremail\\\",\\\"$email\\\"]]),fill(\\\"CRMsearch\\\",[[\\\"Email\\\",\\\"$email\\\"]]),click(\\\"Openthematchingonboardingrecord\\\")],download:[click(\\\"OpeniDocsandenumerateattachments\\\"),read(\\\"Attachments\\\",[[\\\"Documents\\\",\\\"2\\\"],[\\\"Selectedfiles\\\",\\\"entry-sheet.pdf,onboarding-packet.pdf\\\"]]),click(\\\"DownloadtheselectedPDFs\\\"),read(\\\"Downloadreadback\\\",[[\\\"Files\\\",\\\"entry-sheet.pdf,onboarding-packet.pdf\\\"],[\\\"Folder\\\",\\\"$name\\\"]])],archive:[read(\\\"Archiveidentity\\\",[[\\\"Legalname\\\",\\\"$name\\\"],[\\\"Livedname\\\",\\\"$name\\\"]]),click(\\\"Createtheemployee'sdocumentarchive\\\"),read(\\\"Archiveoutput\\\",[[\\\"PDFs\\\",\\\"2\\\"],[\\\"Folder\\\",\\\"$name\\\"],[\\\"ArchiveZIP\\\",\\\"Jordan-Lee-documents.zip\\\"]])],}\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:record\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:employeeId\",\"ObjectLiteralExpression:\",\"VariableDeclaration:values\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.workflowId!==\\\"separations\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:formType\",\"ObjectLiteralExpression:\",\"VariableDeclaration:values\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.parentWorkflowId===\\\"onbase\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"person-lookup\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"emergency-contact\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"onboarding\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:stagesDryRunForm\"],\"run.workflowId===\\\"onboarding\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
    "[\"i9-check-start\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"i9-check-start\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"emergency-contact\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"emergency-contact\\\"?\\\"emergency-contact\\\":run.workflowId===\\\"separations\\\"?\\\"separation\\\":\\\"oath\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"separations\\\"\"]",
    "[\"emergency-contact\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"[\\\"i9\\\",\\\"verify\\\",\\\"oath\\\",\\\"emergency-contact\\\",\\\"onbase-emergency-contact\\\",\\\"separation\\\"]\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:seedReviewRecords\"],\"run.workflowId!==\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:reviewRecords\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:reviewIsReadOnly\"],\"run.workflowId!==\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:restoreMockReview\"],\"run?.workflowId!==\\\"ocr\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"JsxExpression:\",\"JsxAttribute:className\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"JsxExpression:\",\"JsxAttribute:className\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"JsxAttribute:value\",\"JsxAttributes:\",\"JsxSelfClosingElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"value=\\\"onboarding\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"PropertyAssignment:value\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"JsxExpression:\",\"JsxAttribute:options\",\"JsxAttributes:\",\"JsxSelfClosingElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"value:\\\"onboarding\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onboarding\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:description\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"onbase\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:description\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"ocr\\\"\"]"
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
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:record\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockFieldValue\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockFieldValue\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockFieldValue\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"onbase\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockFieldValue\"],\"run.workflowId===\\\"onbase\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:id\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockStepNode\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:id\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockStepNode\"],\"run.workflowId===\\\"onboarding\\\"\"]",
    "[\"onboarding\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDetailEntries\"],\"run.workflowId===\\\"onboarding\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDetailEntries\"],\"run.workflowId===\\\"ocr\\\"\"]"
  ],
  "src/dashboard/app/dashboard-app.tsx": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:review\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:submitMock\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:LoadedApp\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"ConditionalExpression:\",\"PropertyAssignment:preview\",\"ObjectLiteralExpression:\",\"PropertyAssignment:view\",\"ObjectLiteralExpression:\",\"ParenthesizedExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"ExpressionStatement:\",\"Block:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:submitMock\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:LoadedApp\"],\"review?\\\"ocr\\\":id\"]"
  ],
  "src/dashboard/surfaces/explorer/explorer-workflow-model.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:key\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:operationStep\"],\"run.workflowId===\\\"ocr\\\"\"]"
  ],
  "src/dashboard/surfaces/notifications/notifications-preview-model.ts": [],
  "src/dashboard/surfaces/shell/search/search-wiring-model.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"PropertyAssignment:records\",\"ObjectLiteralExpression:\",\"PropertyAssignment:destination\",\"ObjectLiteralExpression:\",\"ParenthesizedExpression:\",\"ArrowFunction:\",\"CallExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:results\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:buildWorkspaceSearchData\"],\"run.workflowId===\\\"ocr\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-queue.tsx": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"VariableDeclaration:hasRecords\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockLog\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:toolbar\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockLog\"],\"run.workflowId!==\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ParenthesizedExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"ArrowFunction:\",\"CallExpression:\",\"VariableDeclaration:toolbar\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockLog\"],\"run.workflowId===\\\"ocr\\\"\"]",
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:onDiscard\",\"JsxAttributes:\",\"JsxSelfClosingElement:\",\"JsxElement:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:content\",\"JsxAttributes:\",\"JsxSelfClosingElement:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockLog\"],\"run.workflowId===\\\"ocr\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-queue-model.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:availableSections\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockQueueSurface\"],\"run.workflowId===\\\"ocr\\\"\"]"
  ]
};

  const RETAINED_OCR_SERVICE_SITES: Readonly<Record<string, readonly string[]>> = {
  "src/backend/app/composition/dashboard/queue.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ReturnStatement:\",\"Block:\",\"ArrowFunction:\",\"CallExpression:\",\"ArrowFunction:\",\"PropertyAssignment:reviewAvailable\",\"ObjectLiteralExpression:\",\"PropertyAssignment:authority\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:createOperatorProjection\"],\"current.run.envelope.workflow===\\\"ocr\\\"\"]"
  ],
  "src/backend/app/composition/runtime-composition.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:startRebuildRuntime\"],\"command===\\\"ocr\\\"\"]"
  ],
  "src/backend/app/composition/worker/run-resources.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"IfStatement:\",\"Block:\",\"MethodDeclaration:forRun\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:createRunResourcesFactory\"],\"[\\\"ocr\\\",\\\"ocr-page\\\"]\"]",
    "[\"ocr-page\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"IfStatement:\",\"Block:\",\"MethodDeclaration:forRun\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:createRunResourcesFactory\"],\"[\\\"ocr\\\",\\\"ocr-page\\\"]\"]",
    "[\"ocr\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"MethodDeclaration:forRun\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:createRunResourcesFactory\"],\"[\\\"ocr\\\",\\\"ocr-page\\\"]\"]",
    "[\"ocr-page\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"MethodDeclaration:forRun\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:createRunResourcesFactory\"],\"[\\\"ocr\\\",\\\"ocr-page\\\"]\"]"
  ],
  "src/backend/runs/commands/command-kernel.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:executeResolveGate\"],\"current.envelope.workflow===\\\"ocr\\\"\"]"
  ],
  "src/backend/runs/queries/bootstrap.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:DEFERRED_FEATURES\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"[\\\"ocr\\\",\\\"OCRreviewsurfaceslandin2h\\\"]\"]"
  ],
  "src/backend/runs/queries/run-detail.ts": [
    "[\"ocr\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"PropertyAssignment:availableSections\",\"ObjectLiteralExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:buildRunDetail\"],\"authority.envelope.workflow===\\\"ocr\\\"\"]"
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
    "i9-check-start",
    "ocr",
    "i9-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
    "separations",
    "onboarding",
    "person-lookup",
    "i9-lookup",
    "ocr",
    "emergency-contact",
    "onbase",
    "i9-check-start",
    "crm-doc-download",
    "person-lookup",
    "i9-lookup",
    "emergency-contact",
    "i9-check-start",
    "crm-doc-download",
    "emergency-contact"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
    "i9-check-start",
    "onbase",
    "emergency-contact",
    "emergency-contact",
    "person-lookup",
    "person-lookup",
    "onboarding",
    "separations",
    "crm-doc-download",
    "onboarding",
    "separations",
    "crm-doc-download",
    "ocr",
    "emergency-contact",
    "onbase",
    "emergency-contact",
    "emergency-contact",
    "i9-check-start",
    "onbase",
    "emergency-contact",
    "ocr",
    "ocr",
    "ocr",
    "ocr",
    "ocr",
    "person-lookup",
    "onboarding",
    "ocr",
    "ocr",
    "ocr",
    "ocr",
    "ocr",
    "onbase",
    "emergency-contact",
    "i9-check-start",
    "onbase",
    "i9-check-start",
    "emergency-contact",
    "onbase",
    "onbase",
    "ocr",
    "ocr",
    "onbase",
    "i9-lookup",
    "ocr",
    "ocr",
    "ocr",
    "ocr",
    "onbase",
    "i9-check-start",
    "onbase",
    "onbase",
    "onboarding",
    "person-lookup",
    "ocr",
    "onbase"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
    "person-lookup",
    "i9-lookup",
    "emergency-contact",
    "i9-check-start",
    "crm-doc-download"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
    "ocr",
    "separations",
    "onbase",
    "ocr",
    "ocr",
    "person-lookup",
    "emergency-contact",
    "onboarding",
    "onboarding"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
    "i9-check-start",
    "ocr",
    "onbase",
    "emergency-contact",
    "emergency-contact",
    "separations",
    "emergency-contact",
    "ocr",
    "ocr",
    "ocr",
    "ocr"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
    "ocr",
    "onbase",
    "onbase",
    "ocr",
    "onbase",
    "onboarding",
    "onboarding",
    "onboarding",
    "onbase",
    "ocr"
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
    "ocr",
    "ocr",
    "ocr",
    "onbase",
    "ocr",
    "onboarding",
    "onboarding",
    "ocr"
  ],
  "src/dashboard/app/dashboard-app.tsx": [
    "ocr",
    "ocr"
  ],
  "src/dashboard/surfaces/explorer/explorer-workflow-model.ts": [
    "ocr"
  ],
  "src/dashboard/surfaces/notifications/notifications-preview-model.ts": [],
  "src/dashboard/surfaces/shell/search/search-wiring-model.ts": [
    "ocr"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-queue.tsx": [
    "ocr",
    "ocr",
    "ocr",
    "ocr"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-queue-model.ts": [
    "ocr"
  ]
};

  return { RETAINED_MOCK_SITES, RETAINED_OCR_SERVICE_SITES, retainedLiteralSite, RETAINED_MOCK_LITERALS };
}
