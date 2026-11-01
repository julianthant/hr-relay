import { z } from "zod";
import { LocalOperatorActorSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../rules/identity/ids.js";
import type { ProviderCapabilityId } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { ordinarySettingsObject } from "./catalog.js";

const UrlSchema = z.url();

/** Fully qualified path. Browser-safe: the dashboard imports this model. Drive-relative (`C:foo`) and a current-drive root (`\foo`) stay rejected. */
function isAbsolutePath(value: string): boolean {
  if (value.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/u.test(value)) return true;
  return value.startsWith("\\\\") && value.length > 2 && value[2] !== "\\" && value[2] !== "/";
}

export const AbsolutePathSchema = z.string().min(1).refine(isAbsolutePath, "path must be absolute");
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
    /* The UCPath SSO entry portal: deep PeopleSoft routes are not reachable unauthenticated, so login starts here. */
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
  return z.strictObject({ prod: routes });
}

export const AnnualDateEntrySchema = z.strictObject({
  jobEndDate: UsDateSchema,
  kronosDefaultEndDate: UsDateSchema.optional(),
  kronosDefaultStartDate: UsDateSchema.optional(),
});

export const ProviderInvocationConfigSchema = z.strictObject({ timeoutMs: z.number().int().positive() });
export const ProviderInvocationSettingsSchema = z.strictObject({
  geocodeCensus: ProviderInvocationConfigSchema,
  geocodeNominatim: ProviderInvocationConfigSchema,
}).default({ geocodeCensus: { timeoutMs: 15_000 }, geocodeNominatim: { timeoutMs: 15_000 } });

export const PROVIDER_CAPABILITY_CONFIG_KEYS = deepFreeze({
  "geocode.census": "geocodeCensus",
  "geocode.nominatim": "geocodeNominatim",
} as const satisfies Record<Exclude<ProviderCapabilityId, "ocr.extract">, keyof z.output<typeof ProviderInvocationSettingsSchema>>);

/** The absolute filesystem locations the runtime reads and writes — pure contract with no default, because a browser has no working directory to resolve against. */
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
  /** Fast Duo source folder staged for workflow browser sessions. */
  duoExtensionDir: AbsolutePathSchema,
});

/** The headless fallback viewport; a host that reports a primary display never sees it. */
export const DEFAULT_DISPLAY = Object.freeze({ screenWidth: 2560, screenHeight: 1440 });

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
      /* The bound on ACQUIRING a usable driver for one system — launching or attaching the browser context plus that system's login recipe — deliberately distinct from `taskMs`. */
    sessionAcquireMs: z.number().int().positive(),
      /* The Duo ceremony lease's TTL is `sessionAcquireMs` PLUS this grace, so a waiter cannot take the lease while the holder runs its proven cleanup. */
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
  // The CONTRACT default, used only for a host with no display to report; the runtime default
  // is the host's primary display.
  display: z.strictObject({ screenWidth: z.number().int().positive(), screenHeight: z.number().int().positive() })
    .default(DEFAULT_DISPLAY),
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
    /* Worker browser-session launch policy; `closeProofMs` bounds the teardown that must PROVE page and context closure. */
  browser: z.strictObject({
    headless: z.boolean(),
    closeProofMs: z.number().int().positive(),
  }).default({ headless: true, closeProofMs: 15_000 }),
  concurrency: z.strictObject({ defaultWorkers: z.number().int().positive() }).default({ defaultWorkers: 4 }),
  daemon: z.strictObject({ idleMs: z.number().int().positive(), idleRepollMs: z.number().int().positive() })
    .default({ idleMs: 900_000, idleRepollMs: 30_000 }),
  features: z.strictObject({ debugScreenshots: z.boolean(), duoWebAuthn: z.boolean() })
    .default({ debugScreenshots: false, duoWebAuthn: true }),
  providers: ProviderInvocationSettingsSchema,
});

/** Resolve the current timeout for one connected capability. */
export function providerInvocationConfig(
  config: { readonly providers: z.output<typeof ProviderInvocationSettingsSchema> },
  capability: Exclude<ProviderCapabilityId, "ocr.extract">,
): z.output<typeof ProviderInvocationConfigSchema> {
  const key = PROVIDER_CAPABILITY_CONFIG_KEYS[capability];
  return ProviderInvocationConfigSchema.parse(config.providers[key]);
}

function partialEndpoints<Shape extends z.ZodRawShape>(routes: z.ZodObject<Shape>) {
  return z.strictObject({ prod: routes.optional(), test: routes.partial().optional() });
}

/** The catalog selects the ordinary members; templates supply their existing value schemas. */
export const SettingsOverrideSchema = ordinarySettingsObject("", z.strictObject({
  actor: ordinarySettingsObject("actor", ConfigSchema.shape.actor.unwrap()).partial().optional(),
  urls: ordinarySettingsObject("urls", z.strictObject({
    kuali: partialEndpoints(KualiRoutesSchema).optional(),
    newKronos: partialEndpoints(NewKronosRoutesSchema).optional(),
    crm: partialEndpoints(CrmRoutesSchema).optional(),
    onbase: partialEndpoints(OnBaseRoutesSchema).optional(),
    ucpath: partialEndpoints(UcpathRoutesSchema).optional(),
    i9: partialEndpoints(I9RoutesSchema).optional(),
    oldKronos: partialEndpoints(OldKronosRoutesSchema).optional(),
    servicenow: partialEndpoints(ServiceNowRoutesSchema).optional(),
    sharepoint: partialEndpoints(SharePointRoutesSchema).optional(),
  })).optional(),
  timeouts: ordinarySettingsObject("timeouts", ConfigSchema.shape.timeouts.unwrap()).partial().optional(),
  paths: ordinarySettingsObject("paths", ConfigPathsSchema).partial().optional(),
  annualDates: z.record(FiscalYearKeySchema, AnnualDateEntrySchema).optional(),
  display: ordinarySettingsObject("display", ConfigSchema.shape.display.unwrap()).optional(),
  performance: ordinarySettingsObject("performance", ConfigSchema.shape.performance.unwrap()).partial().optional(),
  ocr: ordinarySettingsObject("ocr", ConfigSchema.shape.ocr.unwrap()).partial().optional(),
  browserHealth: ordinarySettingsObject("browserHealth", ConfigSchema.shape.browserHealth.unwrap()).partial().optional(),
  browser: ordinarySettingsObject("browser", ConfigSchema.shape.browser.unwrap()).partial().optional(),
  concurrency: ordinarySettingsObject("concurrency", ConfigSchema.shape.concurrency.unwrap()).partial().optional(),
  daemon: ordinarySettingsObject("daemon", ConfigSchema.shape.daemon.unwrap()).partial().optional(),
  features: ordinarySettingsObject("features", ConfigSchema.shape.features.unwrap()).partial().optional(),
  providers: ordinarySettingsObject("providers", ConfigSchema.shape.providers.unwrap()).partial().optional(),
}));

/** The resolver and persisted document have the same closed catalog-generated boundary. */
export const EditableSettingsOverrideSchema = SettingsOverrideSchema;

export const SettingsOverrideInputSchema = SettingsOverrideSchema.optional().default({});

export type Config = z.output<typeof ConfigSchema>;
export type ConfigPaths = z.output<typeof ConfigPathsSchema>;
export type SettingsOverride = z.output<typeof SettingsOverrideSchema>;
export type EditableSettingsOverride = z.output<typeof EditableSettingsOverrideSchema>;
export type AnnualDateEntry = z.output<typeof AnnualDateEntrySchema>;
export type ProviderInvocationConfig = z.output<typeof ProviderInvocationConfigSchema>;
