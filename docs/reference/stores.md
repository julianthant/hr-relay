# Store catalog

Code owns store declarations and task behavior. This reference locates reusable tasks and the
modules that bind them. The catalog describes registration, not live system readiness.

Profile credential encryption keys belong to the OS credential store (`Relay`, installation/profile
account), owned by `storage/configuration/credential-key-custody.ts`. Machine key files contain only
binding metadata and digests. Backups copy that metadata and encrypted records, never new key bytes;
restore requires the same machine entry. The [clock/config contract](clock-config-secrets.md) owns
migration, historical backups and key deletion semantics.

## 1 · How stores work

`src/workflow-kit/task-registry.ts` owns store factories and registry validation.
`src/backend/app/registries/task-registry.ts` composes `BROWSER_STORES`, `TASK_STORES`,
`browserStoreRegistry`, and `taskStoreRegistry`.

| Factory | Namespace | Binding requirements |
| --- | --- | --- |
| `defineBrowserStore` | Browser system ID | Factory-declared driver and session provider name the same system. Every task uses the store's exact driver declaration object. |
| `defineServiceStore` | Service system ID | Tasks are sessionless reads without a browser driver. |
| `defineWorkflowStore` | `workflow:<workflowId>` | Tasks are sessionless reads without a browser driver, artifacts, or providers. |

All factories validate camelCase task keys, contract ID namespace prefixes, factory-defined tasks,
and unique contract IDs within the store. They freeze the store and its task map. OnBase requires
an identity-exclusive session provider. Other browser stores reject that exclusive setting.

`defineTaskStoreRegistry` accepts exact factory-created stores, rejects duplicate namespaces and
task IDs, and checks contract effects and references against its supplied corpus. The application
registry derives that corpus from the registered tasks. Descriptor coverage is checked separately
by `auditImplBindings` in `src/backend/app/registries/workflow-registry.ts`.

### Task and driver binding

`src/workflow-kit/task.ts` owns `defineTask`, `declareDriver`, and `declareDriverFor`.
A browser task binds its contract and implementation to a typed driver declaration. It declares
exactly one session for the matching system: `read` access for reads, `transaction` access for
prepare and commit effects. OnBase tasks also declare `exclusive: true`.
A download session requires a read contract with `artifacts: "content-addressed"`.
Headless tasks have no driver or sessions and use the read effect.

A browser declaration carries `semantic-ready` or `unwired` status. The four currently unwired
stores have empty task maps and no runtime system binding. The declaration's status alone is not
a factory check that prohibits tasks.

`src/backend/runtime/browser/system-bindings.ts` owns concrete driver construction, login recipes,
and authenticated-application verification for UCPath, CRM, I-9, Kuali, and New Kronos. Registration
alone does not provide those runtime bindings. Missing bindings refuse rather than substituting a
driver. [Execution and sessions](execution-and-sessions.md) owns session acquisition and teardown.

### Workflow composition and reuse

Workflow declarations under `src/workflows/<id>/workflow.ts` import browser-safe contracts from
`src/models/`. The backend workflow registry compiles each declaration and calls
`composeWorkflowModule` in `src/workflow-kit/workflow-definition.ts`. Composition resolves each
required namespace to one store and each contract to the exact contract object held by a task.
It refuses missing stores, duplicate stores, and contracts without an exact binding.

The catalog provides three authoring choices:

- **Reuse:** an existing task already returns the needed facts. The workflow names its contract.
- **Customize:** the system is implemented but lacks the operation. A sibling task uses its existing
  driver declaration and semantic driver interface.
- **Build:** the system has no runtime implementation. Its system module needs a semantic driver,
  login recipe, runtime binding, and verified selectors before workflow use.

Read tasks return a fixed contract shape for a page visit. Consumers project those facts or use a
workflow mini-store for a fold that can refuse with a durable failure code. Page extraction retains
raw observations; consumer-specific classification belongs in the fold. Optional blank fields use
the contract's explicit absent shape rather than a fabricated value.

A new output leaf needs matching `ctx.recordData` coverage. The collector in
`src/backend/runs/provenance/task-provenance.ts` checks every parsed output leaf against recorded
read values and refuses missing or contradictory provenance. A parent object point can cover its
leaves. Direct implementation tests with a no-op recorder do not prove this executor boundary.
[Task contract](task-contract.md) owns output, freshness, and observation rules.
[Write safety](write-safety.md) owns transaction sequencing and mutation authority.

## 2 · Per-store catalog

This section is hand-edited. It lists registered stores and tasks from
`src/backend/app/registries/task-registry.ts` and pending contracts from
`src/backend/app/registries/pending-impl-bindings.json`; the code is the authority when they differ.
Inputs and outputs list top-level schema keys, including union arms. Freshness is the contract's
default maximum age for reads. Driver status and `bound` describe declarations and binding;
neither proves a live session, successful dry run, or operator sign-off.

Update the entry when you add or change a store task.

_26 registered stores · 98 bound tasks · 0 pending contracts._

### `ucpath`

**Kind:** browser store · **Browser system:** `ucpath` · **Driver declaration:** `semantic-ready` · **Tasks:** 25 (17 read · 4 prepare · 4 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `ucpath/read-emergency-contacts` | Read Emergency Contacts | read | read | `ucpath` (read) | — | `emplId`, `expectedName` | `contacts` | 0 (re-read every run) | bound |
| `ucpath/stage-emergency-contact` | Stage Emergency Contact | prepare | stage | `ucpath` (transaction) | — | `emplId`, `expectedName`, `contact`, `plan` | `contacts`, `stagedPageState` | — | bound |
| `ucpath/match-emergency-contact-plan` | Probe exact Emergency Contact plan | read | match | `ucpath` (read) | — | `emplId`, `expectedName`, `contact`, `plan` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/verify-emergency-contact-plan` | Verify exact Emergency Contact effect | read | verify | `ucpath` (read) | — | `emplId`, `expectedName`, `contact`, `plan` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/save-emergency-contact` | Save Emergency Contact | commit | save | `ucpath` (transaction) | — | `emplId`, `expectedName`, `contact`, `plan` | `proof` | — | bound |
| `ucpath/read-hire-receipt` | Read the current hire receipt | read | read | `ucpath` (read) | — | `query`, `transactionId` | `transactionId`, `approvalStatus`, `profileId`, `action`, `displayedName`, `emplId`, `effectiveDate`, `positionNumber`, `email`, `dob`, `detailVerified`, `kind`, `source` | 0 (re-read every run) | bound |
| `ucpath/read-hire-findings` | Read UCPath hire transactions | read | read | `ucpath` (read) | — | `employee`, `expectedName` | `state`, `rows`, `queryDigest`, `observedAt`, `source` | 0 (re-read every run) | bound |
| `ucpath/match-hire` | Check for an existing UCPath hire | read | match | `ucpath` (read) | — | `employee`, `expectedName`, `mode`, `emplId`, `profileId`, `comments` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/verify-hire` | Verify the filed UCPath hire | read | verify | `ucpath` (read) | — | `employee`, `expectedName`, `mode`, `emplId`, `profileId`, `comments` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/stage-hire` | Fill UCPath hire wizard | prepare | stage | `ucpath` (transaction) | — | `employee`, `expectedName`, `mode`, `emplId`, `profileId`, `comments` | `stagedPageState`, `observedName`, `transactionIdDisplay`, `template`, `reason` | — | bound |
| `ucpath/create-hire` | Submit UCPath hire | commit | create | `ucpath` (transaction) | — | `employee`, `expectedName`, `mode`, `emplId`, `profileId`, `comments` | `receipt` | — | bound |
| `ucpath/search-person-match` | Search for person | read | search | `ucpath` (read) | — | `lastName`, `firstName`, `dob`, `ssn` | `hits`, `confirmed`, `dropped` | 4h | bound |
| `ucpath/search-person-org` | Searching | read | search | `ucpath` (read) | — | `kind="by-eid"` + `emplId` / `kind="by-name"` + `name`, `keepNonHdh` | `results`, `selection` | 4h | bound |
| `ucpath/read-job-summary` | Job Summary | read | read | `ucpath` (read) | — | `emplId` | `pageStateId`, `emplId`, `displayedName`, `jobRows`, `rowCount`, `renderContext`, `observedAt` | 4h | bound |
| `ucpath/match-existing-termination` | Probe UCPath Termination | read | match | `ucpath` (read) | — | `emplId`, `expectedName`, `emplRecord`, `effectiveDate`, `template`, `reasonCode`, `lastDateWorked`, `initiatorComments` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/stage-termination` | Stage UCPath Termination | prepare | stage | `ucpath` (transaction) | — | `emplId`, `expectedName`, `emplRecord`, `effectiveDate`, `template`, `reasonCode`, `lastDateWorked`, `initiatorComments` | `stagedPageState`, `emplId`, `observedName`, `observedEmplRecord`, `template`, `transactionDate`, `effectiveDate`, `resolvedReasonOption`, `observedReasonOptions`, `lastDateWorked`, `lastDateWorkedOverridden`, `transactionIdDisplay`, `observedAt` | — | bound |
| `ucpath/create-termination` | Submit UCPath Termination | commit | create | `ucpath` (transaction) | — | `emplId`, `expectedName`, `emplRecord`, `effectiveDate`, `template`, `reasonCode`, `lastDateWorked`, `initiatorComments` | `receipt` | — | bound |
| `ucpath/verify-termination` | Verify Filed UCPath Termination | read | verify | `ucpath` (read) | — | `emplId`, `expectedName`, `emplRecord`, `effectiveDate`, `template`, `reasonCode`, `lastDateWorked`, `initiatorComments`, `transactionId` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/verify-termination-filing-present` | Verify Current UCPath Termination Filing | read | verify | `ucpath` (read) | — | `transactionNumber`, `approvalStatus`, `effectiveDate`, `emplId`, `displayedName`, `disposition` | `kind`, `transactionId`, `emplId`, `effectiveDate`, `approvalStatus`, `displayedName`, `observedAt`, `source`, `receiptDisposition`, `authority` | 0 (re-read every run) | bound |
| `ucpath/read-pending-termination-set` | Read Exact Pending UCPath Termination Set | read | read | `ucpath` (read) | — | `emplId`, `expectedName` | `kind`, `emplId`, `eligible`, `protected`, `observedAt`, `source` | 0 (re-read every run) | bound |
| `ucpath/read-transaction-findings` | Read UCPath Transaction Findings | read | read | `ucpath` (read) | — | `emplId`, `expectedName` | `state`, `emplId`, `rows`, `scannedRowCount`, `completeness`, `observedAt`, `source` | 0 (re-read every run) | bound |
| `ucpath/match-pending-terminations` | Probe Pending UCPath Terminations | read | match | `ucpath` (read) | — | `emplId`, `expectedName`, `observedSet` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `ucpath/stage-pending-termination-sweep` | Select Pending UCPath Terminations | prepare | stage | `ucpath` (transaction) | — | `emplId`, `expectedName`, `observedSet` | `stagedPageState`, `emplId`, `observedName`, `selected`, `observedAt` | — | bound |
| `ucpath/delete-pending-terminations` | Clear Pending UCPath Terminations | commit | delete | `ucpath` (transaction) | — | `emplId`, `expectedName`, `observedSet` | `cleared` | — | bound |
| `ucpath/verify-pending-terminations-cleared` | Verify Pending UCPath Terminations Cleared | read | verify | `ucpath` (read) | — | `emplId`, `expectedName`, `observedSet` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |

### `crm`

**Kind:** browser store · **Browser system:** `crm` · **Driver declaration:** `semantic-ready` · **Tasks:** 8 (8 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `crm/search-document-records` | Find latest CRM document records | read | search | `crm` (read) | — | `subjects` | `records` | 0 (re-read every run) | bound |
| `crm/read-idocs` | Download verified CRM PDFs | read | read | `crm` (read) | — | `records`, `docIndices` | `people` | 0 (re-read every run) | bound |
| `crm/read-hire-data` | Read CRM hire data | read | read | `crm` (read) | — | `email` | `recordId`, `recordUrl`, `requestedEmail`, `personalEmail`, `workEmail`, `recordFirstName`, `recordLastName`, `department`, `recruitmentNumber`, `fields` | 0 (re-read every run) | bound |
| `crm/read-onboarding-results` | Read unresolved CRM results | read | read | `crm` (read) | — | `query`, `records` | `records` | 1h | bound |
| `crm/search-onboarding-records` | Cross-check identity | read | search | `crm` (read) | — | `name`, `eid` | `state="checked"` + `records` / `state="check-failed"` + `code`, `reason` | 1h | bound |
| `crm/verify-onboarding-record` | Verify selected CRM record | read | verify | `crm` (read) | — | `recordId`, `recordUrl`, `emplId`, `name`, `department`, `firstDayOfService`, `dateSigned` | `state="checked"` + `records` / `state="check-failed"` + `code`, `reason` | 1h | bound |
| `crm/read-onboarding-record` | Cross Verification | read | read | `crm` (read) | — | `eid`, `name` | `state="found"` + `record` / `state="absent"` + `queriedEid`, `reason` | 1h | bound |
| `crm/read-onboarding-dates` | CRM Dates | read | read | `crm` (read) | — | `eid`, `name` | `state="read"` + `emplId`, `employmentDate`, `oathDate`, `reason` / `state="no-confident-record"` + `emplId`, `employmentDate`, `oathDate`, `reason` / `state="check-failed"` + `emplId`, `employmentDate`, `oathDate`, `reason`, `code` | 1h | bound |

### `onbase`

**Kind:** browser store · **Browser system:** `onbase` · **Driver declaration:** `semantic-ready` · **Tasks:** 5 (3 read · 1 prepare · 1 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `onbase/read-source-page` | Read this person's PDF page | read | read | `onbase` (read) | — | `ucpathId`, `document`, `sourcePage`, `fallback` | `ucpathId`, `document`, `sourcePage`, `fallback`, `pageSha256` | 0 (re-read every run) | bound |
| `onbase/stage-import` | Prepare Emergency Contact import | prepare | stage | `onbase` (transaction) | — | `ucpathId`, `document`, `sourcePage`, `fallback`, `pageSha256` | `stagedPageState`, `observedEid`, `pageSha256`, `keywords` | — | bound |
| `onbase/upload-import` | Import Emergency Contact once | commit | upload | `onbase` (transaction) | — | `ucpathId`, `document`, `sourcePage`, `fallback`, `pageSha256` | `savedDocument` | — | bound |
| `onbase/match-import` | Find the exact saved PDF | read | match | `onbase` (read) | — | `ucpathId`, `document`, `sourcePage`, `fallback`, `pageSha256` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `onbase/verify-import` | Verify the imported PDF exists | read | verify | `onbase` (read) | — | `ucpathId`, `document`, `sourcePage`, `fallback`, `pageSha256` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |

### `kuali`

**Kind:** browser store · **Browser system:** `kuali` · **Driver declaration:** `semantic-ready` · **Tasks:** 6 (4 read · 1 prepare · 1 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `kuali/search-separation-action` | Search Kuali Action List | read | search | `kuali` (read) | — | `documentNumber` | `pageStateId`, `documentNumber`, `actionId`, `actionHref`, `matchedLinkCount`, `observedAt` | ∞ | bound |
| `kuali/read-separation-document` | Read Kuali Separation Document | read | read | `kuali` (read) | — | `actionId`, `documentNumber` | `pageStateId`, `actionId`, `documentNumber`, `formType`, `employee`, `separation`, `timekeeper`, `finalTransactions`, `options`, `observedAt` | ∞ | bound |
| `kuali/match-separation-finalization` | Probe Kuali Separation Finalization | read | match | `kuali` (read) | — | `protectedBindings`, `actionId`, `documentNumber`, `emplId`, `variables` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `kuali/stage-separation-finalization` | Stage Kuali Separation Finalization | prepare | stage | `kuali` (transaction) | — | `protectedBindings`, `actionId`, `documentNumber`, `emplId`, `variables` | `stagedPageState`, `actionId`, `documentNumber`, `observedEid`, `previousFields`, `stagedFields`, `observedDepartmentOptions`, `observedAt` | — | bound |
| `kuali/save-separation-finalization` | Save Kuali Separation Finalization | commit | save | `kuali` (transaction) | — | `protectedBindings`, `actionId`, `documentNumber`, `emplId`, `variables` | `savedState` | — | bound |
| `kuali/verify-separation-finalization` | Verify Saved Kuali Separation Finalization | read | verify | `kuali` (read) | — | `protectedBindings`, `actionId`, `documentNumber`, `emplId`, `variables` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |

### `servicenow`

**Kind:** browser store · **Browser system:** `servicenow` · **Driver declaration:** `unwired` · **Tasks:** 0 (0 read · 0 prepare · 0 commit)

_No tasks registered — this store is a declaration-only placeholder._

### `i9`

**Kind:** browser store · **Browser system:** `i9` · **Driver declaration:** `semantic-ready` · **Tasks:** 9 (5 read · 2 prepare · 2 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `i9/match-profile` | Check for existing I-9 profile | read | match | `i9` (read) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `i9/verify-profile` | Verify saved I-9 profile | read | verify | `i9` (read) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `i9/stage-profile` | Fill I-9 profile | prepare | stage | `i9` (transaction) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName` | `stagedPageState`, `observedName` | — | bound |
| `i9/create-profile` | Save I-9 profile | commit | create | `i9` (transaction) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName` | `receipt` | — | bound |
| `i9/match-remote-record` | Check for existing I-9 record | read | match | `i9` (read) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName`, `profileId`, `startDate` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `i9/verify-remote-record` | Verify saved I-9 record | read | verify | `i9` (read) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName`, `profileId`, `startDate` | `state="present"` + `proof` / `state="absent"` + `evidence` / `state="ambiguous"` + `matches`, `observedAt`, `queryDigest`, `evidence` / `state="unknown"` + `reason`, `observedAt` | 0 (re-read every run) | bound |
| `i9/stage-remote-record` | Fill remote I-9 record | prepare | stage | `i9` (transaction) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName`, `profileId`, `startDate` | `stagedPageState`, `observedName` | — | bound |
| `i9/create-remote-record` | Create remote I-9 record | commit | create | `i9` (transaction) | — | `firstName`, `lastName`, `middleName`, `ssn`, `dob`, `email`, `departmentNumber`, `expectedName`, `profileId`, `startDate` | `receipt` | — | bound |
| `i9/read-section2-signer` | Read Section 2 signer | read | read | `i9` (read) | — | `lastName`, `firstName`, `ssn` | `i9Status="signed"` + `signerName`, `profileId`, `i9Id` / `i9Status="unsigned"` + `signerName`, `profileId`, `i9Id` / `i9Status="historical"` + `signerName`, `profileId`, `i9Id` / `i9Status="not-found"` + `signerName` / `i9Status="unable-to-access"` + `signerName` | 1h | bound |

### `new-kronos`

**Kind:** browser store · **Browser system:** `new-kronos` · **Driver declaration:** `semantic-ready` · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `new-kronos/search-employee` | Search New Kronos For Employee | read | search | `new-kronos` (read) | — | `emplId`, `searchTimeoutMs` | `query`, `totalCount`, `candidates`, `matched`, `selectedCount`, `panelContext` | ∞ | bound |
| `new-kronos/read-separation-timecard` | Read New Kronos Separation Timecard | read | read | `new-kronos` (read) | — | `emplId`, `rangeStart`, `rangeEnd` | `subject`, `range`, `grid` | ∞ | bound |

### `old-kronos`

**Kind:** browser store · **Browser system:** `old-kronos` · **Driver declaration:** `unwired` · **Tasks:** 0 (0 read · 0 prepare · 0 commit)

_No tasks registered — this store is a declaration-only placeholder._

### `sharepoint`

**Kind:** browser store · **Browser system:** `sharepoint` · **Driver declaration:** `unwired` · **Tasks:** 0 (0 read · 0 prepare · 0 commit)

_No tasks registered — this store is a declaration-only placeholder._

### `extraction`

**Kind:** service store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `extraction/extract-spreadsheet` | Parsing spreadsheet | read | extract | — (sessionless) | — | `artifact`, `sheet`, `headerRowIndex` | `sheets`, `sheet`, `headerRowIndex`, `headerCandidates`, `columns`, `rows`, `skippedRows` | ∞ | bound |
| `extraction/extract-pdf-pages` | Splitting document pages | read | extract | — (sessionless) | — | `document`, `fromPage`, `toPage` | `pageCount`, `pages` | ∞ | bound |

### `normalization`

**Kind:** service store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 1 (1 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `normalization/read-contact-advice` | Normalizing contact | read | read | — (sessionless) | `geocode.census`, `geocode.nominatim` | `contact`, `geocode`, `readAt` | `normalized`, `relationshipCanonical`, `changes`, `disposition` | 24h | bound |

### `ocr`

**Kind:** service store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 4 (4 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `ocr/extract-form-page` | Reading form page | read | extract | — (sessionless) | `ocr.extract` | `formType`, `page`, `sourcePage` | `formType`, `source`, `readAt`, `sourceSha256`, `sourcePage`, `pageKind`, `record`, `pageFingerprint` | 4h | bound |
| `ocr/read-approved-snapshot` | Read approved OCR snapshot | read | read | — (sessionless) | `ocr.approved-snapshot` | `snapshotId`, `sourceRunId`, `revision`, `digest` | `snapshot` | 0 (re-read every run) | bound |
| `ocr/read-approved-record` | Verify approved OCR member | read | read | — (sessionless) | `ocr.approved-snapshot` | `approval`, `record` | `record` | 0 (re-read every run) | bound |
| `ocr/read-approved-records` | Read approved OCR selections | read | read | — (sessionless) | `ocr.review` | `delegationNodeId`, `outcomes` | `state="ready"` + `sources` / `state="refused"` + `code` | ∞ | bound |

### `roster`

**Kind:** service store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 1 (1 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `roster/match-spreadsheet` | Matching against roster | read | match | — (sessionless) | — | `subjects`, `rosterFileRef`, `sheet`, `mapping`, `readAt` | `matches` | 24h | bound |

### `workbooks`

**Kind:** service store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workbooks/read-result` | Save workflow workbook | read | read | — (sessionless) | `workbooks.library` | [`name`, `table`] / [`kind`, `writeId`, `typeId`, `key`, `values`] | `state="saved"` + `operationId`, `libraryId`, `version` / `state="recorded"` + `operationId`, `libraryId`, `version`, `receiptState` / `state="refused"` + `code`, `message` | ∞ | bound |
| `workbooks/read-reference` | Read retained workbook reference | read | read | — (sessionless) | `workbooks.library` | `typeId`, `keys` | `state`, `referenceDigest`, `reference` | ∞ | bound |

### `workflow:crm-doc-download`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:crm-doc-download/read-document-rows` | Resolve worksheet rows | read | read | — (sessionless) | — | `records`, `reference`, `referenceDigest` | `referenceDigest`, `state`, `people` | ∞ | bound |
| `workflow:crm-doc-download/read-worksheet-archives` | Package worksheet archives | read | read | — (sessionless) | — | `people` | `collection`, `worksheets`, `worksheetCount`, `personCount`, `documentCount` | ∞ | bound |

### `workflow:emergency-contact`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 1 (1 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:emergency-contact/read-result` | Account for approved contact members | read | read | — (sessionless) | — | `approval`, `members` | `approval`, `members` | 0 (re-read every run) | bound |

### `workflow:emergency-contact-member`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:emergency-contact-member/read-approved-contact` | Map approved contact fields | read | read | — (sessionless) | — | `approval`, `record` | `emplId`, `expectedName`, `contact` | 0 (re-read every run) | bound |
| `workflow:emergency-contact-member/read-contact-plan` | Plan ordered primary contact changes | read | read | — (sessionless) | — | `contact`, `contacts` | `target`, `changes`, `demotionLine`, `contactLine` | 0 (re-read every run) | bound |

### `workflow:i9-check`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:i9-check/read-match-outcome` | Resolve identifier match | read | read | — (sessionless) | — | `match` | `identity`, `shouldLookup` | ∞ | bound |
| `workflow:i9-check/read-retention-row` | Match roster and derive retention | read | read | — (sessionless) | — | `input`, `initial`, `search` | `identity`, `row` | ∞ | bound |

### `workflow:i9-check-start`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 4 (4 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:i9-check-start/read-people` | Group approved I-9 sections by person | read | read | — (sessionless) | — | `request`, `selection` | `people` | ∞ | bound |
| `workflow:i9-check-start/read-requests` | Bind the selected roster rows | read | read | — (sessionless) | — | `request`, `people`, `reference` | `people`, `children`, `reference` | ∞ | bound |
| `workflow:i9-check-start/read-rows` | Collect one retention row per person | read | read | — (sessionless) | — | `batchKey`, `prepared`, `outcomes` | `batchKey`, `personCount`, `tracker`, `reference`, `people` | ∞ | bound |
| `workflow:i9-check-start/read-publication` | Verify the results workbook and fill the tracker | read | read | — (sessionless) | — | `rows`, `workbook` | `batchKey`, `personCount`, `tracker`, `reference`, `people`, `workbook` | ∞ | bound |

### `workflow:i9-lookup`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 1 (1 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:i9-lookup/read-result` | Retain I-9 signer result | read | read | — (sessionless) | — | `signer` | `i9Status="signed"` + `signerName`, `profileId`, `i9Id` / `i9Status="unsigned"` + `signerName`, `profileId`, `i9Id` / `i9Status="historical"` + `signerName`, `profileId`, `i9Id` / `i9Status="not-found"` + `signerName` / `i9Status="unable-to-access"` + `signerName` | ∞ | bound |

### `workflow:ocr`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 3 (3 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:ocr/read-source-pages` | Bind original pages | read | read | — (sessionless) | — | `request`, `rendered` | `manifest` (document, page count, fingerprint) | ∞ | bound |
| `workflow:ocr/read-review-seed` | Build source-bound review | read | read | — (sessionless) | — | `sourceRunId`, `roster`, `manifest`, `readingId`, `formType`, `outcomes` | `sourceRunId`, `accounting`, `roster`, `formType`, `pages`, `grouping`, `records` | ∞ | bound |
| `workflow:ocr/read-result` | Retain identity outcomes | read | read | — (sessionless) | — | `review`, `outcomes` | `review`, `identities` | ∞ | bound |

### `workflow:ocr-page`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:ocr-page/read-page-reading` | Retain page reading | read | read | — (sessionless) | — | `request`, `extraction` | `input`, `extractionId`, `extraction` | ∞ | bound |
| `workflow:ocr-page/read-manual-reading` | Read operator assertion | read | read | — (sessionless) | — | `page`, `reading` | `input`, `extractionId`, `extraction` | ∞ | bound |

### `workflow:onbase`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 0 (0 read · 0 prepare · 0 commit)

_No tasks registered — this store is a declaration-only placeholder._

### `workflow:onboarding`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 5 (5 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:onboarding/read-write-plan` | Verify the reviewed hire path | read | read | — (sessionless) | — | `mode`, `plan`, `subject`, `match`, `lookup`, `findings`, `approval` | `roster`, `hire`, `subject`, `i9`, `comments` | 0 (re-read every run) | bound |
| `workflow:onboarding/read-hire-plan` | Validate hire data | read | read | — (sessionless) | — | `crm`, `roster`, `postalCodeOverride`, `configuredJobEndDate` | `recordId`, `roster`, `employee`, `postalCodeOverride`, `jobEndDateSource`, `ssnState` | ∞ | bound |
| `workflow:onboarding/match-hire-subject` | Check UCPath duplicate identity | read | match | — (sessionless) | — | `mode`, `firstName`, `lastName`, `match` | `state="new-hire"` + `candidateEids` / `state="existing-person"` + `person` / `state="review-required"` + `candidates` | ∞ | bound |
| `workflow:onboarding/read-i9-lookup` | Retain delegated I-9 lookup | read | read | — (sessionless) | — | `subject`, `expectedItemId`, `outcomes` | `state="not-required"` + `subjectState` / `state="checked"` + `childRunId`, `result` | ∞ | bound |
| `workflow:onboarding/read-i9-profile-plan` | Plan I-9 profile creation | read | read | — (sessionless) | — | `plan`, `lookup` | `state="not-required"` + `subjectState` / `state="existing-profile"` + `profileId`, `i9Status` / `state="review-required"` + `reason` / `state="creation-required"` + `request` | ∞ | bound |

### `workflow:person-lookup`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 2 (2 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:person-lookup/read-resolved-identity` | Identity cross-check | read | read | — (sessionless) | — | `input`, `person`, `match`, `crm` | `shouldCheckCrm`, `ucpathFound`, `crmErrorCode`, `state`, `crmIdentity`, `unselectedCrmRecords`, `selected`, `crmRecord`, `candidateEids`, `recoveryEid`, `crmState`, `method` | ∞ | bound |
| `workflow:person-lookup/read-active-status` | Read employment status | read | read | — (sessionless) | — | `input`, `identity`, `verifiedCrm`, `recovered`, `match` | `ucpathSelection`, `datesEid`, `state`, `reason`, `code`, `hdh`, `candidateEids`, `details` | ∞ | bound |

### `workflow:separations`

**Kind:** workflow mini-store · **Browser system:** none (sessionless) · **Driver declaration:** none · **Tasks:** 9 (9 read · 0 prepare · 0 commit)

| Contract id | Title | Effect | Verb | Session | Capability | Inputs | Outputs | Freshness | Status |
|---|---|---|---|---|---|---|---|---|---|
| `workflow:separations/match-termination-type` | Match Termination Type | read | match | — (sessionless) | — | `terminationType`, `observedOptions`, `documentNumber` | `terminationType`, `classification`, `template`, `reasonCode`, `observedOptionCount` | ∞ | bound |
| `workflow:separations/match-identity` | Identity Comparison | read | match | — (sessionless) | — | `protectedBindings`, `documentNumber`, `documentName`, `documentEid`, `emplId`, `emplIdSource`, `jobSummary`, `nameSelection`, `plan` | `packet`, `approvalRequired`, `evidenceDigest` | ∞ | bound |
| `workflow:separations/verify-identity-approval` | Identity Approval | read | verify | — (sessionless) | — | `packet`, `evidenceDigest`, `approval` | `documentNumber`, `approved`, `jobs` | ∞ | bound |
| `workflow:separations/match-department-option` | Match Department Option | read | match | — (sessionless) | — | `deptId`, `department`, `observedOptions`, `documentNumber` | `option`, `departmentCode`, `optionDescription`, `ucpathDepartment`, `observedOptionCount` | ∞ | bound |
| `workflow:separations/read-separation-plan` | Separation Plan | read | read | — (sessionless) | — | `documentNumber`, `employeeName`, `lastDayWorked`, `separationDate`, `observedAt` | `documentNumber`, `employeeName`, `kualiLastDayWorked`, `kualiSeparationDate`, `asOfDate`, `timecardWindow` | ∞ | bound |
| `workflow:separations/match-separation-subject` | Separation Subject | read | match | — (sessionless) | — | `operatorEmployeeId`, `documentNumber`, `employeeName`, `documentEid`, `nameSelection` | `emplId`, `emplIdSource`, `searchedName`, `candidateCount` | ∞ | bound |
| `workflow:separations/match-active-employment` | Select Employment | read | match | — (sessionless) | — | `documentNumber`, `jobSummary` | `rowIndex`, `emplRecord`, `hrStatus`, `businessUnit`, `deptId`, `department`, `payrollTitleCode`, `payrollTitle`, `effectiveDate`, `rowCount` | ∞ | bound |
| `workflow:separations/read-separation-dates` | Reconcile Separation Dates | read | read | — (sessionless) | — | `plan`, `timekeeperInitials`, `lastPunchDate`, `sickDates`, `holidayDates`, `unclassifiedPayCodes`, `observedWindow` | `lastDayWorked`, `separationDate`, `terminationEffectiveDate`, `kualiLastDayWorked`, `kualiSeparationDate`, `lastDayWorkedChanged`, `separationDateChanged`, `latestSickDate`, `firstHolidayDate`, `latestHolidayDate`, `separationDeterminingLeave`, `unclassifiedPayCodes`, `terminationComments`, `dateChangeComments`, `source` | ∞ | bound |
| `workflow:separations/verify-termination-receipt` | Verify Termination Receipt | read | verify | — (sessionless) | — | `proof`, `disposition`, `approvedEmplId`, `expectedEffectiveDate` | `transactionNumber`, `approvalStatus`, `effectiveDate`, `emplId`, `displayedName`, `disposition` | ∞ | bound |

### Pending contracts (declared by a descriptor, no store implementation)

_None — every descriptor contract resolves to a registered store task (`src/backend/app/registries/pending-impl-bindings.json`)._

## 2b · Store notes

Browser task registries live under `src/backend/systems/<system>/task-registry.ts`.
Processing task registries live under `src/backend/processing/<family>/task-registry.ts`.
Workflow mini-stores live under `src/workflows/<id>/task-registry.ts`.
Each registry imports implementations from its adjacent `tasks/` folder.

| Store | Current responsibilities |
| --- | --- |
| `ucpath` | Person Organizational Summary search and Job Summary reads; termination filing probes, staging, submission, and verification; exact pending termination set reads, sweep staging, deletion, and verification. The driver declaration is `driver-declaration.ts`; the worker session provider is `session-provider.ts`. |
| `crm` | Onboarding record and onboarding date reads. Both tasks use the same driver declaration. `read-onboarding-record` and `read-onboarding-dates` remain separate registered tasks. |
| `kuali` | Separation action search and document read; finalization probe, field staging, Save, and saved-field verification. The driver commits only through the registered Save control. Saving field values does not advance the document workflow. |
| `new-kronos` | Employee search and separation timecard reads. The timecard contract includes subject, requested range, and grid observations; downstream separation rules classify the dates. |
| `onbase`, `servicenow`, `i9`, `old-kronos`, `sharepoint` | Browser store declarations without tasks or runtime system bindings. OnBase's session provider still declares exclusivity. |
| `extraction` | Spreadsheet extraction and PDF page rendering to content-addressed artifacts. |
| `normalization` | Contact normalization rules and optional Census or Nominatim geocode advice for operator review. It does not apply changes to an HR system. |
| `ocr` | Form-page instruction construction, `ocr.extract` provider invocation, and response admission through `admitOcrExtraction`. A partial or mismatched form answer refuses. |
| `roster` | Spreadsheet mapping verification, canonical cell coercion, and subject matching. |
| `workflow:person-lookup` | Active-status fold over UCPath and CRM facts. |
| `workflow:separations` | Termination type, identity, identity approval, department option, separation plan, subject, active employment, dates, and termination receipt folds. |

The registered code owns counts, exact task IDs, capabilities, input/output shapes, and freshness.
The system's `AGENTS.md`, driver, and task contracts own operation-specific constraints.

### Shared parsing and providers

`src/backend/processing/spreadsheet/spreadsheet-grid.ts` provides `parseSpreadsheetGrid` and
`readArtifactBytes` to extraction and roster tasks. Spreadsheet readers reuse this parser rather
than branching on formats downstream.

Provider adapters are not task stores. `src/backend/app/composition/worker/run-resources.ts`
composes `geocode.census` and `geocode.nominatim` adapters from
`src/backend/processing/providers/geocode-adapters.ts`. Tasks reach them through
`ctx.providers[capability]`. Contact advice tries Census first for a US-shaped address, then
Nominatim when the first provider is unavailable or invalid. Other addresses use Nominatim.
The result distinguishes complete advice, ambiguous fields, and unavailable advice.

The worker composition does not provide an `ocr.extract` adapter. The OCR task and contract exist,
but provider availability remains a separate admission requirement.
`src/backend/processing/providers/deterministic-provider.ts` is a scripted test harness.

## 3 · Workflow consumers

`src/backend/app/registries/workflow-registry.ts` registers two workflow modules.
Their store lists are derived from compiled contract namespaces, not maintained separately.

| Workflow | Stores used | Composition |
| --- | --- | --- |
| `person-lookup` | `ucpath`, `crm`, `workflow:person-lookup` | UCPath search, CRM cross-verification, active-status fold, and conditional CRM dates. The active-status fold uses `always-rerun`; page reads use checkpoints. |
| `separations` | `kuali`, `ucpath`, `new-kronos`, `workflow:separations` | Kuali document facts, subject and employment resolution, timecard reads, date reconciliation, identity authority, pending termination sweep, termination filing, receipt validation, and Kuali field save. |

Browser task reuse does not bypass the workflow's gates, write policy, freshness, or evidence
requirements. A pure fold can still refuse; a registered task is not proof that the dashboard is
wired to that workflow.

## 4 · Not built yet

- `onbase`, `servicenow`, `i9`, `old-kronos`, and `sharepoint` have no semantic task implementations
  or runtime browser bindings.
- The worker has no `ocr.extract` adapter; the ChatGPT connection and its OCR provider wiring remain
  planned work.
- Kuali document advancement controls such as Send Back and Mark Complete are not exposed by its
  current commit path.

Start plans retain accepted run input and options without a worker count. Schema 6 removes the
`workers` field through stopped upgrade; Sessions owns explicit additions to the standing pool.

The startup flat-store backup and empty-profile migration are owned by storage admission; see
[the backup contract](clock-config-secrets.md#private-onboarding-custody). No flat data is carried into sign-up.
