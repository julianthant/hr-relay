import { z } from "zod";
import { deepFreeze } from "../../rules/validation/immutability.js";
import {
  BrowserSystemIdSchema,
  DiagnosticBundleIdSchema,
  ElementIdSchema,
  ErrorCodeSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PageStateIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  ScreenIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  WriteBindingProofIdSchema,
} from "../../rules/identity/ids.js";
import { operatorFailureSentence } from "../failures/error-catalog.js";
import { WriteAuthorityReasonSchema } from "../../rules/write-safety/write-authority-reason.js";

export const WriteStateSchema = z.enum([
  "not-attempted", "prepared", "attempting", "committed", "verified", "unknown",
]);

/** Absent on durable rows written before diagnostic projection was hardened. */
export const DiagnosticSafetyVersionSchema = z.literal(1);
export const CURRENT_DIAGNOSTIC_SAFETY_VERSION = 1 as const;

export const SubjectEvidenceWireSchema = z.strictObject({
  kind: z.enum(["eid", "name", "email", "kuali-id", "file", "catalog"]),
  digest: FailureFingerprintSchema,
  displayRedacted: z.string().min(1).optional(),
});

export const FailureCauseSchema = z.strictObject({
  code: ErrorCodeSchema,
  summary: z.string().min(1),
  role: z.enum(["primary", "secondary"]),
  transient: z.boolean(),
});

export const RemediationActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("retry-when-served"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("operator-action"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("configuration"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("code-change"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("no-safe-action"), message: z.string().min(1) }),
]);

const FailureSubjectSchema = z.strictObject({
  expected: SubjectEvidenceWireSchema.optional(),
  observed: SubjectEvidenceWireSchema.optional(),
  proofRef: WriteBindingProofIdSchema.optional(),
}).superRefine((subject, context) => {
  if (subject.expected === undefined && subject.observed === undefined && subject.proofRef === undefined) {
    context.addIssue({ code: "custom", message: "failure subject cannot be empty" });
  }
});

const FailurePageSchema = z.strictObject({
  screen: ScreenIdSchema.optional(),
  state: PageStateIdSchema.optional(),
  urlRedacted: z.string().min(1).optional(),
  titleRedacted: z.string().min(1).optional(),
}).superRefine((page, context) => {
  if (Object.keys(page).length === 0) context.addIssue({ code: "custom", message: "failure page cannot be empty" });
});

const FailureActionSchema = z.strictObject({
  elementId: ElementIdSchema.optional(),
  operation: z.enum(["goto", "wait", "read", "fill", "click", "choose", "commit"]).optional(),
  sequence: PositiveIntSchema.optional(),
}).superRefine((action, context) => {
  if (Object.keys(action).length === 0) context.addIssue({ code: "custom", message: "failure action cannot be empty" });
});

export const SIGN_IN_STEPS = [
  "navigate-login-entry",
  "campus-discovery",
  "sso-form",
  "credential-fill",
  "sso-submit",
  "duo-clearance",
  "verify-landing",
] as const;
export const SignInStepSchema = z.enum(SIGN_IN_STEPS);
export type SignInStep = z.infer<typeof SignInStepSchema>;

export const SIGN_IN_CHECKS = [
  "application-route",
  "positive-evidence",
  "sign-in-form-absent",
  "evidence-system",
] as const;
export const SignInCheckSchema = z.enum(SIGN_IN_CHECKS);
export type SignInCheck = z.infer<typeof SignInCheckSchema>;

const A5_ORIGIN = "https://a5.ucsd.edu";
const DUO_PAGE_ORIGIN = "https://*.duosecurity.com";
const SAML_PROXY_ORIGIN = "https://samlproxy.ucop.edu";
const UCPATH_MAINTENANCE_ORIGIN = "https://ucpath-notifications.universityofcalifornia.edu";
const UCPATH_PORTAL_ORIGIN = "https://ucpath.universityofcalifornia.edu";
const UCPATH_CAMPUS_ORIGIN = "https://ucpath.ucsd.edu";
const UCPATH_PUBLIC_ORIGIN = "https://ucphrprdpub.universityofcalifornia.edu";
const CRM_ORIGIN = "https://act-crm.my.site.com";
const CRM_CAMPUS_ORIGIN = "https://crm.ucsd.edu";
const IDOCS_ORIGIN = "https://act-idocs.ucsd.edu";
const KUALI_ORIGIN = "https://ucsd.kualibuild.com";
const NEW_KRONOS_ORIGIN = "https://ucsd-sso.prd.mykronos.com";
const OLD_KRONOS_ORIGIN = "https://ucsd.kronos.net";
const ONBASE_ORIGIN = "https://ucsd.hylandcloud.com";
const I9_ORIGIN = "https://i9complete.ucop.edu";
const I9_APP_ORIGIN = "https://wwwe.i9complete.com";
const SERVICENOW_ORIGIN = "https://support.ucsd.edu";
const SHAREPOINT_ORIGIN = "https://ucsdcloud.sharepoint.com";

const A5_TRITON_PATH = "/tritON/profile/SAML2/Redirect/SSO";
const A5_IDP_PATH = "/idp/profile/SAML2/Redirect/SSO";
const UCPATH_MAINTENANCE_PATH = "/ucpath-maintenance.html";
const ROOT_PATH = "/";
const PEOPLESOFT_CONTENT_PREFIX = "/psc/ucphrprd/EMPLOYEE/HRMS/";
const PEOPLESOFT_PORTAL_PREFIX = "/psp/ucphrprd/EMPLOYEE/HRMS/";
const CRM_SEARCH_PATH = "/hr/ONB_SearchOnboardings";
const CRM_ENTRY_PATH = "/hr/ONB_PPSEntrySheet";
const CRM_HISTORY_PATH = "/hr/ONB_ShowOnboardingHistory";
const CRM_CAMPUS_PATH = "/hr";
const KUALI_ENTRY_PATH = "/build/space/5e47518b90adda9474c14adb";
const NEW_KRONOS_PATH = "/wfd/home";
const OLD_KRONOS_PATH = "/wfcstatic/applications/navigator/html5/dist/container/index.html";
const ONBASE_PATH = "/251ids/NavPanel.aspx";
const SERVICENOW_PATH = "/esc";

type RegistryOrigin =
  | typeof A5_ORIGIN | typeof DUO_PAGE_ORIGIN | typeof SAML_PROXY_ORIGIN | typeof UCPATH_MAINTENANCE_ORIGIN
  | typeof UCPATH_PORTAL_ORIGIN | typeof UCPATH_CAMPUS_ORIGIN | typeof UCPATH_PUBLIC_ORIGIN | typeof CRM_ORIGIN
  | typeof CRM_CAMPUS_ORIGIN | typeof IDOCS_ORIGIN | typeof KUALI_ORIGIN | typeof NEW_KRONOS_ORIGIN
  | typeof OLD_KRONOS_ORIGIN | typeof ONBASE_ORIGIN | typeof I9_ORIGIN | typeof I9_APP_ORIGIN
  | typeof SERVICENOW_ORIGIN | typeof SHAREPOINT_ORIGIN;
type RegistryPath =
  | typeof A5_TRITON_PATH | typeof A5_IDP_PATH | typeof UCPATH_MAINTENANCE_PATH | typeof ROOT_PATH
  | typeof PEOPLESOFT_CONTENT_PREFIX | typeof PEOPLESOFT_PORTAL_PREFIX | typeof CRM_SEARCH_PATH | typeof CRM_ENTRY_PATH
  | typeof CRM_HISTORY_PATH | typeof CRM_CAMPUS_PATH | typeof KUALI_ENTRY_PATH | typeof NEW_KRONOS_PATH
  | typeof OLD_KRONOS_PATH | typeof ONBASE_PATH | typeof SERVICENOW_PATH;
type SignInPathRule = { readonly kind: "exact" | "prefix"; readonly value: RegistryPath };
type SignInPageListing = {
  readonly origin: RegistryOrigin;
  readonly duo?: boolean;
  readonly paths: readonly SignInPathRule[];
};

const exact = (value: RegistryPath): SignInPathRule => ({ kind: "exact", value });
const prefix = (value: RegistryPath): SignInPathRule => ({ kind: "prefix", value });

/** Registry constants. An observed address is compared to these and never copied. */
const SIGN_IN_PAGE_LISTINGS: readonly SignInPageListing[] = deepFreeze([
  { origin: A5_ORIGIN, paths: [exact(A5_TRITON_PATH), exact(A5_IDP_PATH)] },
  { origin: DUO_PAGE_ORIGIN, duo: true, paths: [] },
  { origin: SAML_PROXY_ORIGIN, paths: [] },
  { origin: UCPATH_MAINTENANCE_ORIGIN, paths: [exact(UCPATH_MAINTENANCE_PATH)] },
  { origin: UCPATH_PORTAL_ORIGIN, paths: [exact(ROOT_PATH)] },
  { origin: UCPATH_CAMPUS_ORIGIN, paths: [exact(ROOT_PATH)] },
  { origin: UCPATH_PUBLIC_ORIGIN, paths: [prefix(PEOPLESOFT_CONTENT_PREFIX), prefix(PEOPLESOFT_PORTAL_PREFIX)] },
  { origin: CRM_ORIGIN, paths: [exact(CRM_SEARCH_PATH), exact(CRM_ENTRY_PATH), exact(CRM_HISTORY_PATH)] },
  { origin: CRM_CAMPUS_ORIGIN, paths: [exact(CRM_CAMPUS_PATH)] },
  { origin: IDOCS_ORIGIN, paths: [exact(ROOT_PATH)] },
  { origin: KUALI_ORIGIN, paths: [exact(KUALI_ENTRY_PATH)] },
  { origin: NEW_KRONOS_ORIGIN, paths: [exact(NEW_KRONOS_PATH)] },
  { origin: OLD_KRONOS_ORIGIN, paths: [exact(OLD_KRONOS_PATH)] },
  { origin: ONBASE_ORIGIN, paths: [exact(ONBASE_PATH)] },
  { origin: I9_ORIGIN, paths: [exact(ROOT_PATH)] },
  { origin: I9_APP_ORIGIN, paths: [exact(ROOT_PATH)] },
  { origin: SERVICENOW_ORIGIN, paths: [exact(SERVICENOW_PATH)] },
  { origin: SHAREPOINT_ORIGIN, paths: [exact(ROOT_PATH)] },
]);

export const SIGN_IN_PAGE_ORIGINS = deepFreeze([
  "unlisted", "not-read", "unreadable",
  A5_ORIGIN, DUO_PAGE_ORIGIN, SAML_PROXY_ORIGIN, UCPATH_MAINTENANCE_ORIGIN, UCPATH_PORTAL_ORIGIN, UCPATH_CAMPUS_ORIGIN,
  UCPATH_PUBLIC_ORIGIN, CRM_ORIGIN, CRM_CAMPUS_ORIGIN, IDOCS_ORIGIN, KUALI_ORIGIN, NEW_KRONOS_ORIGIN, OLD_KRONOS_ORIGIN,
  ONBASE_ORIGIN, I9_ORIGIN, I9_APP_ORIGIN, SERVICENOW_ORIGIN, SHAREPOINT_ORIGIN,
] as const);
export const SignInPageOriginSchema = z.enum(SIGN_IN_PAGE_ORIGINS);
export type SignInPageOrigin = z.infer<typeof SignInPageOriginSchema>;

export const SIGN_IN_PAGE_PATHS = deepFreeze([
  A5_TRITON_PATH, A5_IDP_PATH, UCPATH_MAINTENANCE_PATH, ROOT_PATH, PEOPLESOFT_CONTENT_PREFIX, PEOPLESOFT_PORTAL_PREFIX,
  CRM_SEARCH_PATH, CRM_ENTRY_PATH, CRM_HISTORY_PATH, CRM_CAMPUS_PATH, KUALI_ENTRY_PATH, NEW_KRONOS_PATH, OLD_KRONOS_PATH,
  ONBASE_PATH, SERVICENOW_PATH,
] as const);
export const SignInPagePathSchema = z.enum(SIGN_IN_PAGE_PATHS);
export type SignInPagePath = z.infer<typeof SignInPagePathSchema>;

function duoHost(hostname: string): boolean {
  return hostname === "duosecurity.com" || hostname.endsWith(".duosecurity.com");
}

function listedPath(listing: SignInPageListing, pathname: string): RegistryPath | undefined {
  return listing.paths.find(path => path.kind === "prefix" ? pathname.startsWith(path.value) : pathname === path.value)?.value;
}

/** Selects a registry origin and path. The observed text is not returned. */
export function signInPage(observedUrl: string): { pageOrigin: SignInPageOrigin; pagePath?: SignInPagePath } {
  if (observedUrl === "") return { pageOrigin: "not-read" };
  const url = URL.parse(observedUrl);
  if (url === null) return { pageOrigin: "unreadable" };
  if (url.protocol === "https:" && url.port === "" && duoHost(url.hostname)) return { pageOrigin: DUO_PAGE_ORIGIN };
  const listing = SIGN_IN_PAGE_LISTINGS.find(candidate => candidate.origin === url.origin);
  if (listing === undefined) return { pageOrigin: "unlisted" };
  const path = listedPath(listing, url.pathname);
  if (path === undefined) return { pageOrigin: listing.origin };
  return { pageOrigin: listing.origin, pagePath: path };
}

/** Which check refused a sign-in, and which registry page that check saw. */
export const SignInRefusalSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  step: SignInStepSchema,
  check: SignInCheckSchema.optional(),
  pageOrigin: SignInPageOriginSchema,
  pagePath: SignInPagePathSchema.optional(),
}).superRefine((refusal, context) => {
  if (refusal.pagePath === undefined) return;
  const listing = SIGN_IN_PAGE_LISTINGS.find(candidate => candidate.origin === refusal.pageOrigin);
  if (listing?.paths.some(path => path.value === refusal.pagePath) !== true) {
    context.addIssue({ code: "custom", message: "sign-in page path is not listed for its origin" });
  }
});

export const FailureRecordSchema = z.strictObject({
  diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
  failureId: FailureIdSchema,
  fingerprint: FailureFingerprintSchema,
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  attempt: PositiveIntSchema,
  workflowId: WorkflowIdSchema,
  nodeId: NodeIdSchema.optional(),
  taskId: TaskIdSchema.optional(),
  code: ErrorCodeSchema,
  summary: z.string().min(1),
  transient: z.boolean(),
  writeState: WriteStateSchema,
  subject: FailureSubjectSchema.optional(),
  page: FailurePageSchema.optional(),
  action: FailureActionSchema.optional(),
  causeChain: z.array(FailureCauseSchema).min(1).max(12),
  diagnosticBundleId: DiagnosticBundleIdSchema.optional(),
  debug: z.strictObject({
    stack: z.string(), causes: z.array(z.string()).max(12),
    originalBytes: z.number().int().nonnegative(), omittedBytes: z.number().int().nonnegative(),
    signInRefusal: SignInRefusalSchema.optional(),
  }).optional(),
  remediation: z.array(RemediationActionSchema).min(1),
  /** Authority-only; every operator projection removes this classified evidence reference. */
  writeAuthorityReason: WriteAuthorityReasonSchema.optional(),
  occurredAt: IsoInstantSchema,
}).superRefine((failure, context) => {
  const primary = failure.causeChain.filter(({ role }) => role === "primary");
  if (primary.length !== 1) {
    context.addIssue({ code: "custom", path: ["causeChain"], message: "failure cause chain requires exactly one primary cause" });
  }
  if (primary[0]?.transient !== failure.transient) {
    context.addIssue({ code: "custom", path: ["transient"], message: "failure transient flag must match the primary cause" });
  }
  if ((failure.writeState === "attempting" || failure.writeState === "unknown") && failure.action?.operation !== "commit") {
    context.addIssue({ code: "custom", path: ["action"], message: "attempting or unknown write state requires a commit action" });
  }
});

export type FailureRecord = z.infer<typeof FailureRecordSchema>;

/** A failure's causes for an operator: catalog codes and class names only; stack text, paths, URLs and values stay in the record. */
export function failureCauseNames(failure: Pick<FailureRecord, "causeChain" | "debug">) {
  return {
    codes: failure.causeChain.map(({ code }) => code),
    classes: (failure.debug?.causes ?? []).flatMap(text => /^([A-Za-z_$][\w$]*)(?::|\s|$)/u.exec(text)?.[1] ?? []),
  };
}

/** What a failure says was written: a write this run settled (committed, or found already present) makes it a failure after that write. */
export function settledWriteState(intents: readonly Readonly<{ status: string }>[]): "not-attempted" | "committed" | "verified" {
  const settled = intents.filter(({ status }) => status === "committed" || status === "observed-present");
  return settled.length === 0 ? "not-attempted" : settled.some(({ status }) => status === "observed-present") ? "verified" : "committed";
}

function subjectEvidence(evidence: z.infer<typeof SubjectEvidenceWireSchema>) {
  return { kind: evidence.kind, digest: evidence.digest };
}

/** Catalog sentence for the code. Protected input drops raw diagnostic text. */
export function projectFailureForOperator(failureInput: unknown, protectedInput = false): FailureRecord {
  const failure = FailureRecordSchema.parse(failureInput);
  const summary = operatorFailureSentence(failure.code);
  if (!protectedInput) return FailureRecordSchema.parse({ ...failure, summary });
  const subject = failure.subject === undefined ? undefined : {
    ...(failure.subject.expected === undefined ? {} : { expected: subjectEvidence(failure.subject.expected) }),
    ...(failure.subject.observed === undefined ? {} : { observed: subjectEvidence(failure.subject.observed) }),
    ...(failure.subject.proofRef === undefined ? {} : { proofRef: failure.subject.proofRef }),
  };
  const page = failure.page === undefined ? undefined : {
    ...(failure.page.screen === undefined ? {} : { screen: failure.page.screen }),
    ...(failure.page.state === undefined ? {} : { state: failure.page.state }),
  };
  return FailureRecordSchema.parse({
    ...(failure.diagnosticSafetyVersion === undefined ? {} : { diagnosticSafetyVersion: failure.diagnosticSafetyVersion }),
    failureId: failure.failureId,
    fingerprint: failure.fingerprint,
    runId: failure.runId,
    traceId: failure.traceId,
    attempt: failure.attempt,
    workflowId: failure.workflowId,
    ...(failure.nodeId === undefined ? {} : { nodeId: failure.nodeId }),
    ...(failure.taskId === undefined ? {} : { taskId: failure.taskId }),
    code: failure.code,
    summary,
    transient: failure.transient,
    writeState: failure.writeState,
    ...(subject === undefined || Object.keys(subject).length === 0 ? {} : { subject }),
    ...(page === undefined || Object.keys(page).length === 0 ? {} : { page }),
    ...(failure.action === undefined ? {} : { action: failure.action }),
    causeChain: failure.causeChain.map(cause => ({ ...cause, summary })),
    remediation: failure.remediation.map(action => ({ ...action, message: summary })),
    occurredAt: failure.occurredAt,
  });
}
