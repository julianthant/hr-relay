import type { MockWorkflowId } from "./workflow-mock-catalog.js";

export type OperationField = readonly [label: string, value: string, kind?: "read" | "fill"];
export type MockOperation = Readonly<{ label: string; fields?: readonly OperationField[]; click?: string; verify?: string; commit?: boolean }>;
export const read = (label: string, fields: readonly OperationField[], verify?: string): MockOperation => ({ label, fields, verify });
export const fill = (label: string, fields: readonly OperationField[]): MockOperation => ({ label, fields: fields.map(([name, value]) => [name, value, "fill"]) });
export const click = (label: string, commit = false): MockOperation => ({ label, click: label, commit });

// Copied operation sequences/fields: legacy:hr-automation@9bb973672666b9267569a22d3fa0af722e4c5e87 src/workflows/<id>/{workflow,enter,handler}.ts and src/systems/<system>/*.ts. Values and timings are synthetic.
export const MOCK_OPERATION_CATALOG: Readonly<Record<MockWorkflowId, Readonly<Record<string, readonly MockOperation[]>>>> = {
  "person-lookup": {
    searching: [fill("Search criteria", [["Employee ID", "$employeeId"], ["Name", "$name"], ["Campus", "SDCMP"]]), click("Search Person Organizational Summary"), read("UCPath person", [["Employee ID", "$employeeId"], ["Name", "$name"], ["Department", "HDH"], ["Job title", "Student assistant"], ["Job record", "0"], ["HR status", "Active"]])],
    "cross-verification": [click("Find the onboarding record in CRM"), read("Identity cross-check", [["UCPath name", "$name"], ["CRM name", "$name"], ["Campus email", "$email"], ["Start date", "08/03/2026"], ["Match", "Confirmed"]])],
    "active-status": [click("Open Workforce Job Summary"), read("Employment status", [["HR status", "Active"], ["Start date", "08/03/2026"], ["End date", "—"], ["Termination reason", "—"], ["Found in UCPath", "Yes"]])],
    "crm-dates": [read("Caller-requested CRM dates", [["Employment date", "08/03/2026"], ["Oath date", "08/03/2026"]])],
  },
  separations: {
    "kuali-extraction": [click("Open the RRSS separation document"), read("Separation request", [["Kuali ID", "$subject"], ["Employee", "$name"], ["Employee ID", "$employeeId"], ["Termination type", "Voluntary"], ["Last day worked", "08/02/2026"], ["Separation date", "08/02/2026"], ["Department", "HDH"], ["Comments", "Appointment ended"]]), read("Transaction choice", [["Template", "UC_VOL_TERM"], ["Effective date", "08/03/2026"], ["Date rule", "Separation date + 1 day"]])],
    "identity-check": [fill("Person search", [["Employee ID", "$employeeId"]]), click("Search UCPath"), read("Resolved identity", [["Employee", "$name"], ["Employee ID", "$employeeId"], ["Job record", "0"], ["Match", "Confirmed"]])],
    "ucpath-job-summary": [click("Open Workforce Job Summary"), read("Active job", [["Position number", "DEMO-POS-001"], ["Department", "HDH"], ["Payroll title code", "DEMO-JOB-001"], ["Payroll title", "Student assistant"], ["Job record", "0"]]), fill("Kuali job fields", [["Department", "HDH"], ["Payroll title code", "DEMO-JOB-001"], ["Payroll title", "Student assistant"]])],
    "kronos-search": [fill("Timecard search", [["Employee ID", "$employeeId"], ["Date range", "05/04/2026 – 08/02/2026"]]), click("Open the employee timecard"), read("Timekeeping reconciliation", [["Last physical punch", "08/02/2026"], ["Sick days", "None"], ["Holiday days", "None"], ["Last date worked", "08/02/2026"]]), fill("Kuali timekeeper", [["Timekeeper", "Demo operator"]])],
    "transaction-check": [click("Search SS Smart HR transactions"), read("Existing termination", [["Employee ID", "$employeeId"], ["Job record", "0"], ["Existing termination", "None in separation window"], ["Pending termination", "None"], ["Approval status", "—"], ["Transaction ID", "—"]])],
    "ucpath-transaction": [click("Open Smart HR Transactions"), fill("Termination template", [["Template", "UC_VOL_TERM"], ["Employee ID", "$employeeId"], ["Job record", "0"], ["Effective date", "08/03/2026"]]), click("Create Transaction"), fill("Termination data", [["Action", "Termination"], ["Reason", "Voluntary termination"], ["Last date worked", "08/02/2026"]]), click("Save and Submit", true), read("Termination confirmation", [["Transaction number", "DEMO-TXN-001"], ["Employee", "$name"], ["Effective date", "08/03/2026"]], "Confirmation number and submitted job record agree.")],
    "kuali-finalization": [fill("Kuali completion", [["Transaction number", "DEMO-TXN-001"], ["Termination effective date", "08/03/2026"], ["Timekeeper", "Demo operator"], ["Comments", "UCPath termination verified · DEMO-TXN-001"]]), click("Save and finalize the RRSS document", true), read("Final document", [["Document status", "Final"], ["Kuali ID", "$subject"]], "Final status re-read from the document.")],
  },
  onboarding: {
    "crm-search": [fill("CRM search", [["Email", "$email"]]), click("Search and select the latest onboarding record"), read("CRM record", [["Email", "$email"], ["Department number", "DEMO-DEPT-001"], ["Recruitment number", "DEMO-REC-001"]])],
    extraction: [click("Open the UCPath entry sheet"), read("Identity and contact", [["First name", "$firstName"], ["Middle name", "—"], ["Last name", "$lastName"], ["Preferred first name", "$firstName"], ["Preferred last name", "$lastName"], ["Date of birth", "01/15/2005"], ["SSN", "•••-••-0001"], ["Email", "$email"], ["Phone", "(202) 555-0101"], ["Street", "100 Example Street"], ["City", "San Diego"], ["State", "CA"], ["ZIP", "92101"]]), read("Appointment", [["Position number", "DEMO-POS-001"], ["Wage", "$17.75 per hour"], ["Appointment", "Casual/Restricted 5"], ["Employee classification", "5"], ["Effective date", "$effectiveDate"], ["Expected job end date", "06/30/2027"]], "Required fields validated; CRM empty placeholders normalized.")],
    "pdf-download": [click("Open the record's iDocs viewer"), read("Document inventory", [["Documents", "2"], ["Selected PDFs", "entry-sheet.pdf, onboarding-packet.pdf"]]), click("Download each selected PDF"), read("Downloaded files", [["Folder", "$name"], ["Files", "entry-sheet.pdf, onboarding-packet.pdf"]], "Each file exists in the download folder.")],
    "person-search": [fill("UCPath person search", [["Name", "$name"], ["Date of birth", "01/15/2005"], ["SSN", "•••-••-0001"]]), click("Search for an existing person"), read("Hire decision", [["Hire type", "$hireType"], ["Existing employee", "$existingPerson"], ["Existing hire transaction", "None"]])],
    "i9-creation": [click("Search the I-9 portal for an existing profile"), read("Existing profile", [["Employee", "$name"], ["Existing I-9 profile", "None"]]), fill("Employee profile", [["First name", "$firstName"], ["Last name", "$lastName"], ["Email", "$email"], ["Date of birth", "01/15/2005"], ["Hire date", "$effectiveDate"]]), click("Save & Continue", true), read("I-9 profile confirmation", [["Profile ID", "DEMO-I9-001"]], "Profile ID re-read from the portal.")],
    transaction: [
      click("HR Tasks → Smart HR Templates → Smart HR Transactions"),
      fill("Hire template", [["Template", "$hireTemplate"], ["Effective date", "$effectiveDate"]]), click("Create Transaction"),
      fill("Transaction reason", [["Reason", "$hireReason"]]),
      fill("Personal Data", [["First name", "$firstName"], ["Middle name", "—"], ["Last name", "$lastName"], ["Preferred first name", "$firstName"], ["Preferred middle name", "—"], ["Preferred last name", "$lastName"], ["Date of birth", "01/15/2005"], ["SSN", "•••-••-0001"], ["Street", "100 Example Street"], ["City", "San Diego"], ["State", "CA"], ["ZIP", "92101"], ["Phone", "(202) 555-0101"], ["Email", "$email"], ["Tracker Profile ID", "$profileId"]]),
      fill("Personal Data comments", [["Comments", "$hireComments"]]), click("Job Data"),
      fill("Job Data", [["Position number", "DEMO-POS-001"], ["Employee classification", "5"], ["Compensation rate code", "UCHRLY"], ["Compensation rate", "$17.75 per hour"], ["Expected job end date", "06/30/2027"]]),
      click("Earns Dist"), click("Employee Experience"), fill("Initiator comments", [["Comments", "$hireComments"]]),
      click("Return to Personal Data"), read("Submit readiness", [["Save and Submit", "Enabled"]]), click("Save and Submit", true),
      read("Hire confirmation", [["Transaction number", "DEMO-TXN-001"], ["Employee", "$name"], ["Position number", "DEMO-POS-001"]], "Filed transaction receipt re-read."),
    ],
  },
  "i9-lookup": { lookup: [fill("Portal person search", [["Last name", "$lastName"], ["First name", "$firstName"], ["SSN", "•••-••-0001"]]), click("Search and open the matching profile"), read("Section 2", [["I-9 status", "Section 2 complete"], ["Authorized official signer", "Alex Morgan"], ["Profile ID", "DEMO-I9-001"]])] },
  "work-study": { transaction: [click("HR Tasks → PayPath/Additional Pay → PayPath Actions"), fill("Employee search", [["Employee ID", "$employeeId"]]), click("Search"), read("Employee header", [["Employee", "$name"]]), fill("Position Data", [["Effective date", "$effectiveDate"], ["Position change reason", "JRL"], ["Position pool", "F"]]), click("Job Data"), fill("Job Data comments", [["Comments", "$workStudyComments"]]), click("Additional Pay Data"), fill("Initiator comments", [["Comments", "$workStudyComments"]]), click("Save and Submit", true), read("Transaction outcome", [["Outcome", "Submitted"]])] },
  "kronos-pay-rule": {
    "csv-lookup": [read("OT Elections Tracker", [["Employee", "$name"], ["Employee ID", "$employeeId"], ["Union code", "SX"], ["Current pay rule", "DEMO-CT-BASE"], ["Current election", "Compensatory time"], ["New election", "Cash"]])],
    "determine-action": [read("Election decision", [["Old code", "CT"], ["New code", "OT"], ["Current pay rule", "DEMO-CT-BASE"], ["New pay rule", "DEMO-OT-BASE"], ["Effective date", "07/01/2026"]])],
    "update-pay-rule": [click("Open People → timekeeper workspace"), fill("Employee search", [["Employee ID", "$employeeId"]]), click("Search and open the employee"), read("Displayed identity", [["Employee ID", "$employeeId"], ["Employee", "$name"]]), click("Job Assignment"), fill("Pay rule assignment", [["Pay rule", "DEMO-OT-BASE"], ["Effective date", "07/01/2026"]]), click("Save pay rule", true), read("Saved assignment", [["Pay rule", "DEMO-OT-BASE"], ["Effective date", "07/01/2026"]], "Employee ID, rule and effective date re-read.")],
  },
  ocr: {
    "prep:loading-roster": [read("Roster source", [["Spreadsheet", "$roster"], ["Source", "$rosterMode"], ["Rows matched", "$recordCount"]])],
    "prep:ocr": [read("PDF pages", [["Source PDF", "$pdf"], ["Form type", "$formType"], ["Pages", "2"]]), click("Split pages and recognize the form blocks"), read("Extraction summary", [["Records extracted", "$recordCount"], ["Source pages", "1–2"]])],
    "prep:person-lookup": [read("Identity matching", [["Employee", "$sourceName"], ["Employee ID", "$sourceEmployeeId"], ["Roster match", "Matched"], ["UCPath match", "Confirmed"], ["HR status", "Active"]])],
    "prep:awaiting-approval": [read("Review selection", [["Records", "$recordCount"], ["Approved people", "$approvedCount"]])],
  },
  "oath-signature": {
    "crm-verify": [fill("CRM identity search", [["Employee ID", "$employeeId"], ["Employee", "$name"]]), click("Open the onboarding record and history"), read("Oath eligibility", [["CRM onboarding", "Record found"], ["Process stage", "Onboarding complete"], ["First day of service", "08/03/2026"], ["Signed date", "$signedDate"]])],
    transaction: [click("Open Person Profiles"), fill("Profile search", [["Employee ID", "$employeeId"]]), click("Search"), read("Profile and existing oath", [["Employee", "$name"], ["Existing oath", "None"]]), click("Add New Oath Signature Date"), fill("Oath date", [["Signature date", "$signedDate"]]), click("OK · stage oath row"), click("Save · commit oath", true), read("Saved oath", [["Signature date", "$signedDate"], ["Signature time", "09:18 AM"]], "Saved date re-read from the person's profile.")],
  },
  "oath-upload": {
    "wait-approval": [read("Delegated OCR", [["PDF", "$pdf"], ["Approval", "$approval"], ["Signers", "$approvedCount"]])],
    "wait-signatures": [read("Linked signature outcomes", [["Signers", "$approvedCount"], ["Succeeded", "$approvedCount"], ["Failed", "0"], ["Cancelled", "0"]], "Every linked signer must succeed before the ticket form opens.")],
    "open-hr-form": [click("Open HR inquiry"), read("Form", [["Service", "HR inquiry"], ["Attachment", "$pdf"]])],
    "fill-form": [fill("HR inquiry", [["Subject", "HDH New Hire Oaths"], ["Description", "Please see attached oaths for employees hired under HDH."], ["Specifically", "Signing Ceremony (Oath)"], ["Category", "Payroll"]]), click("Attach the paper oath PDF"), read("Attachment readback", [["Filename", "$pdf"], ["Upload", "Registered"]])],
    submit: [click("Submit HR inquiry", true), read("Ticket confirmation", [["HR ticket number", "DEMO-HR-001"], ["Filed", "Yes"], ["PDF", "$pdf"]], "Ticket number re-read from the submitted request.")],
  },
  "emergency-contact": {
    navigation: [click("Open the employee's emergency-contact page"), read("Identity and existing contacts", [["Employee", "$name"], ["Employee ID", "$employeeId"], ["Existing contact", "No exact-name duplicate"], ["Existing primary", "None"]]), click("View All and scan for a blank contact row")],
    "fill-form": [fill("Contact details", [["Primary contact", "Yes"], ["Contact name", "$contactName"], ["Relationship", "$relationship"], ["Phone", "$phone"], ["Same address as employee", "$sameAddress"]]), fill("Contact address", [["Street", "$street"], ["City", "$city"], ["State", "$state"], ["ZIP", "$zip"], ["Country", "$country"]])],
    save: [click("Save emergency contact", true), read("Saved contact", [["Contact name", "$contactName"], ["Relationship", "$relationship"], ["Phone", "$phone"], ["Primary contact", "Yes"]], "Contact row re-read on the employee's record.")],
  },
  onbase: {
    "prepare-import": [click("Open Import Document"), fill("Import settings", [["Document type", "$documentType"], ["File type", "PDF (.pdf)"], ["Keyset", "Employee Lookup"]]), read("Source document", [["PDF", "$pdf"], ["Source page", "$sourcePage"]]), click("Attach the person's page and verify the Document Queue")],
    "fill-keywords": [click("Open Employee Lookup"), fill("Lookup criteria", [["UCPath ID", "$employeeId"]]), click("Find → Select Employee"), read("Autofilled keywords", [["UCPath ID", "$employeeId"], ["Last name", "$lastName"], ["First name", "$firstName"], ["Department name", "Housing Dining Hospitality"], ["Department code", "DEMO-DEPT-001"], ["Vice Chancellor", "Student Affairs"], ["Vice Chancellor code", "DEMO-VC-001"]]), fill("Document name", [["Document name", "$documentName"]]), read("Required keyword check", [["Keyset autofill", "Yes"], ["Employee ID match", "Confirmed"], ["Missing required keywords", "0"]])],
    import: [click("Import document", true), read("Import confirmation", [["Document ID", "DEMO-ONBASE-001"], ["Document type", "$documentType"], ["UCPath ID", "$employeeId"], ["Source page", "$sourcePage"]], "Imported document re-read under the employee record.")],
  },
  "i9-check": {
    "person-match": [read("Paired I-9 identity", [["Employee", "$name"], ["Section 1 page", "$section1"], ["Section 2 page", "$section2"], ["Hire date from I-9", "08/03/2026"]]), fill("UCPath person search", [["Name", "$name"], ["Employee ID", "$employeeId"]]), read("Search result", [["Matched Employee ID", "$employeeId"], ["Candidates", "1"], ["Found in UCPath", "Yes"]])],
    "employment-dates": [read("Employment evidence", [["Employee ID", "$employeeId"], ["UCPath hire date", "08/03/2026"], ["I-9 hire date", "08/03/2026"], ["Hire date match", "Confirmed"]])],
    "roster-match": [read("Action History match", [["Employee ID", "$employeeId"], ["PPS ID", "DEMO-PPS-001"], ["Separation date", "Not separated"]]), read("Retention tracker row", [["Employee", "$name"], ["Employee ID", "$employeeId"], ["PPS ID", "DEMO-PPS-001"], ["Section 1 present", "Yes"], ["Section 2 present", "Yes"], ["Found in UCPath", "Yes"]]), click("Append retention tracker row", true)],
  },
  "crm-doc-download": {
    "search-record": [read("Roster identity", [["Employee ID", "$employeeId"], ["Roster email", "$email"]]), fill("CRM search", [["Email", "$email"]]), click("Open the matching onboarding record")],
    download: [click("Open iDocs and enumerate attachments"), read("Attachments", [["Documents", "2"], ["Selected files", "entry-sheet.pdf, onboarding-packet.pdf"]]), click("Download the selected PDFs"), read("Download readback", [["Files", "entry-sheet.pdf, onboarding-packet.pdf"], ["Folder", "$name"]])],
    archive: [read("Archive identity", [["Legal name", "$name"], ["Lived name", "$name"]]), click("Create the employee's document archive"), read("Archive output", [["PDFs", "2"], ["Folder", "$name"], ["Archive ZIP", "Jordan-Lee-documents.zip"]])],
  },
  "sharepoint-download": {
    navigate: [read("Configured destination", [["Spreadsheet", "Onboarding Roster"], ["Provider", "SharePoint"]]), click("Open Excel Online"), read("Viewer", [["Workbook", "Onboarding Roster"], ["Authentication", "Authenticated"]])],
    download: [click("File → Create a Copy → Download a Copy"), read("Downloaded workbook", [["Spreadsheet", "Onboarding Roster"], ["Filename", "onboarding-roster.xlsx"], ["Saved to", "Roster folder"], ["File validation", "Workbook readable"]])],
  },
  "old-kronos-reports": {
    searching: [fill("Workforce Central search", [["Employee ID", "$employeeId"]]), click("Search employees"), read("Search result", [["Found", "Yes"], ["Matching rows", "1"]])],
    extracting: [read("Selected employee", [["Employee ID", "$employeeId"], ["Employee name", "$name"]])],
    downloading: [click("Reports → Time Detail"), fill("Report options", [["Start date", "$reportStart"], ["End date", "$reportEnd"], ["Employees", "$employeeId"]]), click("Run report and download PDF"), read("PDF validation", [["Report", "Time Detail"], ["Employee ID", "$employeeId"], ["Employee name", "$name"], ["Identity match", "Confirmed"], ["Contains data", "Yes"]]), read("Tracker outcome", [["File", "Time Detail_Jordan Lee (10000001).pdf"], ["Status", "Done"]])],
  },
};
