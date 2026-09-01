import { z } from "zod";
import { LocalOperatorActorSchema, LOCAL_OPERATOR_ACTOR_ID } from "../ids.js";
import type { ProviderCapabilityId } from "../ids.js";
import { deepFreeze } from "../immutability.js";

const UrlSchema = z.url();
export const AbsolutePathSchema = z.string().min(1).refine((value) => value.startsWith("/"), "path must be absolute");
export const FiscalYearKeySchema = z.string().regex(/^FY\d{4}$/, "fiscal-year key must be FY<year>");
export const UsDateSchema = z.string().regex(
  /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4}$/,
  "date must be M/D/YYYY or MM/DD/YYYY",
);

export const KualiRoutesSchema = z.strictObject({ entry: UrlSchema });
export const NewKronosRoutesSchema = z.strictObject({ entry: UrlSchema });
export const CrmRoutesSchema = z.strictObject({
  entry: UrlSchema,
  onboardingSearch: UrlSchema,
  ucPathEntrySheet: UrlSchema,
  onboardingHistory: UrlSchema,
  idocsViewer: UrlSchema,
});
export const OnBaseRoutesSchema = z.strictObject({ entry: UrlSchema });
export const UcpathRoutesSchema = z.strictObject({
  /**
   * The UCPath SSO entry portal ("Log in to UCPath" → campus discovery →
   * Shibboleth). Deep PeopleSoft routes are NOT reachable unauthenticated, so
   * login starts here. Ported from legacy
   * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
   * src/infra/auth/login.ts (ucpathNavigateAndFill).
   */
  login: UrlSchema,
  smartHr: UrlSchema,
  jobSummary: UrlSchema,
  personalData: UrlSchema,
  personProfile: UrlSchema,
});
export const I9RoutesSchema = z.strictObject({ entry: UrlSchema, app: UrlSchema });
export const OldKronosRoutesSchema = z.strictObject({ entry: UrlSchema });
export const ServiceNowRoutesSchema = z.strictObject({ entry: UrlSchema });
export const SharePointRoutesSchema = z.strictObject({ entry: UrlSchema });

export const CONFIG_ROUTE_SCHEMAS = {
  kuali: KualiRoutesSchema,
  newKronos: NewKronosRoutesSchema,
  crm: CrmRoutesSchema,
  onbase: OnBaseRoutesSchema,
  ucpath: UcpathRoutesSchema,
  i9: I9RoutesSchema,
  oldKronos: OldKronosRoutesSchema,
  servicenow: ServiceNowRoutesSchema,
  sharepoint: SharePointRoutesSchema,
} as const;

export const CONFIG_ROUTE_KEYS = {
  kuali: KualiRoutesSchema.keyof().options,
  newKronos: NewKronosRoutesSchema.keyof().options,
  crm: CrmRoutesSchema.keyof().options,
  onbase: OnBaseRoutesSchema.keyof().options,
  ucpath: UcpathRoutesSchema.keyof().options,
  i9: I9RoutesSchema.keyof().options,
  oldKronos: OldKronosRoutesSchema.keyof().options,
  servicenow: ServiceNowRoutesSchema.keyof().options,
  sharepoint: SharePointRoutesSchema.keyof().options,
} as const satisfies { readonly [Key in keyof typeof CONFIG_ROUTE_SCHEMAS]: readonly string[] };

function endpoints<Shape extends z.ZodRawShape>(routes: z.ZodObject<Shape>) {
  return z.strictObject({ prod: routes, test: routes.partial().optional() });
}

export const AnnualDateEntrySchema = z.strictObject({
  jobEndDate: UsDateSchema,
  kronosDefaultEndDate: UsDateSchema,
  kronosDefaultStartDate: UsDateSchema,
});

export const ProviderBudgetSchema = z.strictObject({
  timeoutMs: z.number().int().positive(),
  concurrency: z.number().int().positive(),
  requestsPerMinute: z.number().int().positive(),
  dailyRequestLimit: z.number().int().positive(),
  costLimitUsdMicros: z.number().int().nonnegative(),
});

export const ProviderBudgetConfigSchema = z.strictObject({
  ocrExtract: ProviderBudgetSchema,
  geocodeCensus: ProviderBudgetSchema,
  geocodeNominatim: ProviderBudgetSchema,
  aiAdvisory: ProviderBudgetSchema,
}).default({
  ocrExtract: { timeoutMs: 120_000, concurrency: 4, requestsPerMinute: 10, dailyRequestLimit: 250, costLimitUsdMicros: 0 },
  geocodeCensus: { timeoutMs: 15_000, concurrency: 2, requestsPerMinute: 30, dailyRequestLimit: 5_000, costLimitUsdMicros: 0 },
  geocodeNominatim: { timeoutMs: 15_000, concurrency: 1, requestsPerMinute: 1, dailyRequestLimit: 1_000, costLimitUsdMicros: 0 },
  aiAdvisory: { timeoutMs: 90_000, concurrency: 2, requestsPerMinute: 10, dailyRequestLimit: 250, costLimitUsdMicros: 0 },
});

export const PROVIDER_CAPABILITY_CONFIG_KEYS = deepFreeze({
  "ocr.extract": "ocrExtract",
  "geocode.census": "geocodeCensus",
  "geocode.nominatim": "geocodeNominatim",
  "ai.advisory": "aiAdvisory",
} as const satisfies Record<ProviderCapabilityId, keyof z.output<typeof ProviderBudgetConfigSchema>>);

/**
 * The absolute filesystem locations the runtime reads and writes (ref clock-config-secrets §4).
 *
 * PURE CONTRACT, NO DEFAULT — deliberately. This module also carries the
 * settings-override contract that `src/domain/commands.ts`, and through it the
 * dashboard bundle, depends on, so it is imported into the BROWSER. A path
 * default can only be produced by resolving a repo-relative literal against a
 * working directory, which is `node:path` work; a browser has no working
 * directory to resolve against and no business inventing one. So the defaults
 * live in the server-only `./runtime-paths.ts`, which `./resolve.ts` — the ONE
 * `env > settings.json > default` resolver — supplies at parse time. A caller
 * that hands `ConfigSchema` no `paths` gets a loud zod error naming the missing
 * leaf, never a fabricated path.
 */
export const ConfigPathsSchema = z.strictObject({
  reportsDir: AbsolutePathSchema,
  downloadsDir: AbsolutePathSchema,
  onboardingDocsDir: AbsolutePathSchema,
  i9CheckTrackerPath: AbsolutePathSchema,
  stateRoot: AbsolutePathSchema,
  artifactRoot: AbsolutePathSchema,
  /** Every worker browser profile is namespaced BENEATH this root. */
  browserProfileRoot: AbsolutePathSchema,
  duoCredential: AbsolutePathSchema,
  /** The unpacked Duo Autopilot MV3 extension loaded into every browser session. */
  duoExtensionDir: AbsolutePathSchema,
});

export const ConfigSchema = z.strictObject({
  actor: LocalOperatorActorSchema
    .default({ id: LOCAL_OPERATOR_ACTOR_ID, label: "Local operator" }),
  urls: z.strictObject({
    kuali: endpoints(KualiRoutesSchema),
    newKronos: endpoints(NewKronosRoutesSchema),
    crm: endpoints(CrmRoutesSchema),
    onbase: endpoints(OnBaseRoutesSchema),
    ucpath: endpoints(UcpathRoutesSchema),
    i9: endpoints(I9RoutesSchema),
    oldKronos: endpoints(OldKronosRoutesSchema),
    servicenow: endpoints(ServiceNowRoutesSchema),
    sharepoint: endpoints(SharePointRoutesSchema),
  }).default({
    kuali: { prod: { entry: "https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb" } },
    newKronos: { prod: { entry: "https://ucsd-sso.prd.mykronos.com/wfd/home" } },
    crm: { prod: {
      entry: "https://crm.ucsd.edu/hr",
      onboardingSearch: "https://act-crm.my.site.com/hr/ONB_SearchOnboardings",
      ucPathEntrySheet: "https://act-crm.my.site.com/hr/ONB_PPSEntrySheet",
      onboardingHistory: "https://act-crm.my.site.com/hr/ONB_ShowOnboardingHistory",
      idocsViewer: "https://act-idocs.ucsd.edu",
    } },
    onbase: { prod: { entry: "https://ucsd.hylandcloud.com/251ids/NavPanel.aspx" } },
    ucpath: { prod: {
      login: "https://ucpath.ucsd.edu",
      smartHr: "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/NUI_FRAMEWORK.PT_AGSTARTPAGE_NUI.GBL?CONTEXTIDPARAMS=TEMPLATE_ID%3aPTPPNAVCOL&scname=ADMN_UC_ADMIN_LOC_HIRE_NAVCOLL&PanelCollapsible=Y&PTPPB_GROUPLET_ID=UC_HIRE_TASKS_TILE_FL&CRefName=UC_HIRE_TASKS_TILE_FL&AJAXTRANSFER=Y",
      jobSummary: "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/ADMINISTER_WORKFORCE_(GBL).WF_JOB_SUMMARY.GBL",
      personalData: "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/ADMINISTER_WORKFORCE_(GBL).EMERGENCY_CONTACT.GBL?NavColl=true&uc_deep_link=1",
      personProfile: "https://ucphrprdpub.universityofcalifornia.edu/psp/ucphrprd/EMPLOYEE/HRMS/c/SETUP_PROFILE_MANAGEMENT.JPM_PERSON_PROFILE.GBL",
    } },
    i9: { prod: { entry: "https://i9complete.ucop.edu", app: "https://wwwe.i9complete.com" } },
    oldKronos: { prod: { entry: "https://ucsd.kronos.net/wfcstatic/applications/navigator/html5/dist/container/index.html?version=8.1.18.502#/" } },
    servicenow: { prod: { entry: "https://support.ucsd.edu/esc?id=sc_cat_item&table=sc_cat_item&sys_id=d8af3ae8db4fe510b3187d84f39619bf" } },
    sharepoint: { prod: { entry: "https://ucsdcloud.sharepoint.com" } },
  }),
  timeouts: z.strictObject({
    navigationMs: z.number().int().positive(),
    longNavigationMs: z.number().int().positive(),
    ukgNavigationMs: z.number().int().positive(),
    taskMs: z.number().int().positive(),
    /**
     * D125 — the bound on ACQUIRING a usable driver for one system: launching
     * or attaching the browser context, plus that system's login recipe. It is
     * deliberately distinct from, and much shorter than, `taskMs`.
     *
     * Why it exists: `taskMs` bounds a whole task once a driver is in hand, so
     * it has to be generous (the UCPath person-org read is ~22s of real work,
     * a Kuali fill→save→reload→verify cycle is 8–10s). A login recipe is a
     * CHAIN of individually-bounded steps — each `navigationMs`, plus the Duo
     * window — and nothing bounded the chain, so a dead CRM session on the
     * live exit run burned 262.9s inside `withDriver` before anything noticed.
     * Acquisition is not the slow part of a healthy run: authentication is
     * live-verified at ~17s (UCPath) and ~12s (CRM) with Duo Autopilot
     * clearing the ceremony hands-off (charter §9), so 60s is >3x the measured
     * worst case and cannot fail a legitimately slow READ — reads happen after
     * acquisition, under `taskMs`.
     *
     * A deployment that reverts to a HANDS-ON Duo approval must raise this
     * above `duoApprovalSeconds`, because the inner Duo wait would otherwise
     * outlive its own envelope. The refusal names both leaves so an operator
     * who hits it knows exactly which one to move.
     */
    sessionAcquireMs: z.number().int().positive(),
    /**
     * D267 (ref execution-and-sessions §10.3): the Duo ceremony lease's TTL is
     * `sessionAcquireMs` PLUS this grace. A TTL equal to the envelope would let
     * a waiter take the lease at the instant the holder is running its proven
     * cleanup; the grace covers that cleanup (`browser.closeProofMs`, 15 000 ms,
     * plus margin). A waiter's budget is its remaining envelope MINUS this
     * grace, so the lease refuses by name before the envelope fires. It is a
     * post-baseline leaf: generation 3 in `snapshot-generations.ts`, so a
     * stored `config_snapshots` row without it still parses (D133).
     */
    duoCeremonyLeaseGraceMs: z.number().int().positive(),
    transactionMs: z.number().int().positive(),
    duoApprovalSeconds: z.number().int().positive(),
    duoApprovalCrmSeconds: z.number().int().positive(),
    retryDelayMs: z.number().int().positive(),
  }).default({
    navigationMs: 15_000,
    longNavigationMs: 30_000,
    ukgNavigationMs: 60_000,
    taskMs: 180_000,
    sessionAcquireMs: 60_000,
    duoCeremonyLeaseGraceMs: 20_000,
    transactionMs: 300_000,
    duoApprovalSeconds: 180,
    duoApprovalCrmSeconds: 60,
    retryDelayMs: 5_000,
  }),
  // REQUIRED, not defaulted: `./runtime-paths.ts` owns the filesystem defaults
  // and `./resolve.ts` supplies them. See `ConfigPathsSchema`.
  paths: ConfigPathsSchema,
  annualDates: z.record(FiscalYearKeySchema, AnnualDateEntrySchema).default({}),
  operator: z.strictObject({ timekeeperName: z.string() }).default({ timekeeperName: "" }),
  display: z.strictObject({ screenWidth: z.number().int().positive(), screenHeight: z.number().int().positive() })
    .default({ screenWidth: 2560, screenHeight: 1440 }),
  performance: z.strictObject({
    navigationRetries: z.number().int().positive(),
    separationTerminationWindowDays: z.number().int().positive(),
  }).default({ navigationRetries: 10, separationTerminationWindowDays: 14 }),
  ocr: z.strictObject({
    secondOpinionMax: z.number().int().positive(),
    pageMaxWaitMs: z.number().int().positive(),
    tier1PatienceMs: z.number().int().positive(),
    pageConcurrency: z.number().int().nonnegative(),
    disambigConcurrency: z.number().int().positive(),
    suggestConcurrency: z.number().int().positive(),
    backoffBaseMs: z.number().int().positive(),
    backoffCapMs: z.number().int().positive(),
    maxValidationRetries: z.number().int().nonnegative(),
  }).default({
    secondOpinionMax: 5,
    pageMaxWaitMs: 120_000,
    tier1PatienceMs: 90_000,
    pageConcurrency: 0,
    disambigConcurrency: 4,
    suggestConcurrency: 4,
    backoffBaseMs: 2_000,
    backoffCapMs: 60_000,
    maxValidationRetries: 1,
  }),
  browserHealth: z.strictObject({
    monitorTickMs: z.number().int().positive(),
    maxAutoRefresh: z.number().int().nonnegative(),
    maxReopen: z.number().int().nonnegative(),
  }).default({ monitorTickMs: 30_000, maxAutoRefresh: 10, maxReopen: 3 }),
  /**
   * Worker browser-session launch policy. `headless` is the runtime default
   * because Duo Autopilot answers the MFA ceremony in-page (no OS dialog);
   * `closeProofMs` bounds the teardown that must PROVE page/context closure —
   * an unprovable close poisons the resource rather than being assumed clean.
   */
  browser: z.strictObject({
    headless: z.boolean(),
    closeProofMs: z.number().int().positive(),
  }).default({ headless: true, closeProofMs: 15_000 }),
  concurrency: z.strictObject({ defaultWorkers: z.number().int().positive() }).default({ defaultWorkers: 4 }),
  daemon: z.strictObject({ idleMs: z.number().int().positive(), idleRepollMs: z.number().int().positive() })
    .default({ idleMs: 900_000, idleRepollMs: 30_000 }),
  features: z.strictObject({ debugScreenshots: z.boolean(), duoWebAuthn: z.boolean() })
    .default({ debugScreenshots: false, duoWebAuthn: true }),
  providers: ProviderBudgetConfigSchema,
});

/**
 * Takes only the `providers` group, not the whole `Config`: a DURABLE snapshot
 * read forward (`./snapshot-generations.ts`) is legitimately narrower than
 * today's `Config`, and a budget lookup has no business demanding leaves the
 * captured run never carried.
 */
export function providerBudget(
  config: { readonly providers: z.output<typeof ProviderBudgetConfigSchema> },
  capability: ProviderCapabilityId,
): z.output<typeof ProviderBudgetSchema> {
  const key = PROVIDER_CAPABILITY_CONFIG_KEYS[capability];
  return ProviderBudgetSchema.parse(config.providers[key]);
}

function partialEndpoints<Shape extends z.ZodRawShape>(routes: z.ZodObject<Shape>) {
  return z.strictObject({ test: routes.partial().optional() });
}

export const SettingsOverrideSchema = z.strictObject({
  actor: z.strictObject({ label: z.string().min(1).optional() }).optional(),
  urls: z.strictObject({
    kuali: partialEndpoints(KualiRoutesSchema).optional(),
    newKronos: partialEndpoints(NewKronosRoutesSchema).optional(),
    crm: partialEndpoints(CrmRoutesSchema).optional(),
    onbase: partialEndpoints(OnBaseRoutesSchema).optional(),
    ucpath: partialEndpoints(UcpathRoutesSchema).optional(),
    i9: partialEndpoints(I9RoutesSchema).optional(),
    oldKronos: partialEndpoints(OldKronosRoutesSchema).optional(),
    servicenow: partialEndpoints(ServiceNowRoutesSchema).optional(),
    sharepoint: partialEndpoints(SharePointRoutesSchema).optional(),
  }).optional(),
  timeouts: ConfigSchema.shape.timeouts.unwrap().partial().optional(),
  paths: ConfigPathsSchema.partial().optional(),
  annualDates: z.record(FiscalYearKeySchema, AnnualDateEntrySchema.partial()).optional(),
  operator: ConfigSchema.shape.operator.unwrap().partial().optional(),
  display: ConfigSchema.shape.display.unwrap().partial().optional(),
  performance: ConfigSchema.shape.performance.unwrap().partial().optional(),
  ocr: ConfigSchema.shape.ocr.unwrap().partial().optional(),
  browserHealth: ConfigSchema.shape.browserHealth.unwrap().partial().optional(),
  browser: ConfigSchema.shape.browser.unwrap().partial().optional(),
  concurrency: ConfigSchema.shape.concurrency.unwrap().partial().optional(),
  daemon: ConfigSchema.shape.daemon.unwrap().partial().optional(),
  features: ConfigSchema.shape.features.unwrap().partial().optional(),
  providers: ConfigSchema.shape.providers.unwrap().partial().optional(),
});

/**
 * The closed set the dashboard settings command may persist. This is
 * deliberately narrower than `SettingsOverrideSchema`: that broader schema is
 * the resolver's input contract and includes leaves owned by deployment
 * environment or credential/runtime-path composition. Adding an editable leaf
 * is therefore an explicit server change, never an accidental consequence of
 * widening `ConfigSchema` or the resolver.
 */
export const EditableSettingsOverrideSchema = z.strictObject({
  actor: z.strictObject({ label: z.string().min(1).optional() }).optional(),
  urls: z.strictObject({
    crm: z.strictObject({
      test: CrmRoutesSchema.omit({ entry: true }).partial().optional(),
    }).optional(),
    ucpath: z.strictObject({
      test: UcpathRoutesSchema.omit({ smartHr: true }).partial().optional(),
    }).optional(),
    i9: z.strictObject({
      test: I9RoutesSchema.omit({ entry: true }).partial().optional(),
    }).optional(),
  }).optional(),
  timeouts: ConfigSchema.shape.timeouts.unwrap().omit({ ukgNavigationMs: true }).partial().optional(),
  paths: ConfigPathsSchema.pick({ reportsDir: true }).partial().optional(),
  display: ConfigSchema.shape.display.unwrap().partial().optional(),
  ocr: ConfigSchema.shape.ocr.unwrap().pick({
    pageConcurrency: true,
    maxValidationRetries: true,
  }).partial().optional(),
  concurrency: ConfigSchema.shape.concurrency.unwrap().pick({ defaultWorkers: true }).partial().optional(),
  browser: ConfigSchema.shape.browser.unwrap().partial().optional(),
  providers: ConfigSchema.shape.providers.unwrap().partial().optional(),
});

export const SettingsOverrideInputSchema = SettingsOverrideSchema.optional().default({});

export type Config = z.output<typeof ConfigSchema>;
export type ConfigPaths = z.output<typeof ConfigPathsSchema>;
export type SettingsOverride = z.output<typeof SettingsOverrideSchema>;
export type EditableSettingsOverride = z.output<typeof EditableSettingsOverrideSchema>;
export type AnnualDateEntry = z.output<typeof AnnualDateEntrySchema>;
export type ProviderBudget = z.output<typeof ProviderBudgetSchema>;
