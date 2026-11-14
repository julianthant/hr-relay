import type { SharePointBrowserTransport } from "../../../../models/systems/sharepoint/workbook-download.js";
import type { JSHandle } from "playwright";
import { resolveSystemLoginUrl } from "../../../../models/config/instance.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { assertDuoCeremonyLeaseToken } from "../../../../workflow-kit/duo-ceremony-lease.js";
import { defineVerifiedLoginRecipe } from "../../browser-shared/authenticated-application.js";
import { BrowserLoginError, type AuthenticationProbe, type SystemLoginContext } from "../../browser-shared/login-contract.js";
import { submitPinnedUcsdSsoCredentials, waitForAuthenticatedLanding, waitForSsoForm } from "../../browser-shared/ucsd-sso.js";

type DownloadCode = "SHAREPOINT_LINK_UNSUPPORTED" | "SHAREPOINT_DOWNLOAD_FAILED" | "SHAREPOINT_DOWNLOAD_TOO_LARGE";
export class SharePointDownloadError extends Error {
  constructor(readonly code: DownloadCode) {
    super(ERROR_CATALOG[code].text);
    this.name = "SharePointDownloadError";
  }
}

export interface SharePointWorkbookTarget {
  readonly origin: string;
  readonly siteUrl: string;
  readonly serverRelativePath: string;
  readonly metadataUrl: string;
}
const targets = new WeakSet<object>();
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const LOGIN_CONTROLS = 'input[type="password"], input[name="loginfmt"], #ssousername, input[name="urn:mace:ucsd.edu:sso:username"], input[name="username"], #i0116, #idSIButton9';
const SSO_PATHS = new Set(["/tritON/profile/SAML2/Redirect/SSO", "/idp/profile/SAML2/Redirect/SSO"]);
const extension = (name: string): "xlsx" | "csv" | undefined => /\.xlsx$/iu.test(name) ? "xlsx" : /\.csv$/iu.test(name) ? "csv" : undefined;

function cleanUrl(raw: string): URL {
  const url = URL.parse(raw);
  const spelling = /^https:\/\/([^/]+)(\/.*)?$/u.exec(raw);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== ""
    || spelling === null || spelling[1].includes(":") || (spelling[2] ?? "/") !== url.pathname
    || url.hash !== "" || url.search !== "" || raw.includes("#") || raw.includes("?")) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  return url;
}

export function parseSharePointWorkbookLink(link: string, configuredEntry: string): Readonly<SharePointWorkbookTarget> {
  const configured = cleanUrl(configuredEntry), url = cleanUrl(link);
  if (!/^[a-z0-9-]+\.sharepoint\.com$/u.test(configured.hostname) || url.origin !== configured.origin) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  let path: string, configuredPath: string;
  try { path = decodeURIComponent(url.pathname); configuredPath = decodeURIComponent(configured.pathname); }
  catch { throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED"); }
  const segments = path.split("/");
  if (!extension(path) || [...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\")
    || segments.some(segment => segment === "." || segment === "..")
    || /%2f|%5c/iu.test(url.pathname) || path.includes("//") || /^\/(?::[^/]+:|guestaccess|_layouts|_api)(?:\/|$)/iu.test(path)
    || segments.some(segment => /^(?:_layouts|_api)$/iu.test(segment))) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  const site = /^\/(?:sites|teams)\/[^/]+(?=\/)/u.exec(path)?.[0];
  const configuredSite = configuredPath.replace(/\/$/u, "");
  if (configuredSite !== "" && !/^\/(?:sites|teams)\/[^/]+$/u.test(configuredSite)) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  const sitePath = site ?? configuredSite;
  if (sitePath !== "" && !path.startsWith(`${sitePath}/`)) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  const siteUrl = `${url.origin}${sitePath.split("/").map(segment => encodeURIComponent(segment)).join("/")}`;
  const alias = encodeURIComponent(`'${path.replaceAll("'", "''")}'`).replaceAll("'", "%27");
  const target = Object.freeze({ origin: url.origin, siteUrl, serverRelativePath: path,
    metadataUrl: `${siteUrl}/_api/web/GetFileByServerRelativePath(decodedUrl=@path)?@path=${alias}&$select=UniqueId,Name,Length` });
  targets.add(target);
  return target;
}

function current(context: SystemLoginContext): void {
  context.assertCurrent();
  context.signal.throwIfAborted();
}
function signInFailed(options?: ErrorOptions): BrowserLoginError {
  return new BrowserLoginError("sharepoint", "verify-landing", "SharePoint authentication could not be proved", "", options);
}

async function transfer(context: SystemLoginContext, target: SharePointWorkbookTarget, url: string,
  kind: "json" | "xlsx" | "csv", transport: SharePointBrowserTransport): Promise<Buffer> {
  current(context);
  let controller: JSHandle<AbortController> | undefined;
  let aborting: Promise<"aborted" | "failed"> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const cleanupFailures: SharePointDownloadError[] = [];
  let browserCleanupFailed = false;
  const failures: unknown[] = [];
  let bytes: Buffer | undefined;
  const abort = () => {
    if (controller !== undefined && aborting === undefined) aborting = controller.evaluate(value => value.abort())
      .then(() => "aborted" as const, () => "failed" as const);
  };
  try {
    controller = await context.page.evaluateHandle(() => new AbortController());
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    current(context);
    const remaining = context.acquisitionRemainingMs?.() ?? context.config.timeouts.sessionAcquireMs;
    timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(1, Math.min(remaining, context.config.timeouts.sessionAcquireMs)));
    const result = await context.page.evaluate(transport, { controller, origin: target.origin, url, kind, limit: kind === "json" ? MAX_JSON_BYTES : MAX_FILE_BYTES });
    browserCleanupFailed = result.cleanupFailed;
    current(context);
    if (result.failed) failures.push(new SharePointDownloadError(result.tooLarge ? "SHAREPOINT_DOWNLOAD_TOO_LARGE" : "SHAREPOINT_DOWNLOAD_FAILED"));
    if (failures.length === 0 && !browserCleanupFailed) {
      if (timedOut) throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED");
      current(context);
      bytes = Buffer.concat(result.chunks.map(chunk => Buffer.from(chunk, "base64")));
    }
  } catch {
    try { current(context); failures.push(new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED")); }
    catch (error) { failures.push(error); }
    abort();
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", abort);
    if (browserCleanupFailed) cleanupFailures.push(new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED"));
    if (await aborting === "failed") cleanupFailures.push(new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED"));
    try { await controller?.dispose(); } catch { cleanupFailures.push(new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED")); }
  }
  if (cleanupFailures.length !== 0 || failures.length > 1) throw new AggregateError([...failures, ...cleanupFailures], "SharePoint transfer and resource cleanup failed");
  if (failures.length === 1) throw failures[0];
  if (bytes === undefined) throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED");
  return bytes;
}

function expectedIdentity(userId: string): string {
  const value = userId.toLowerCase();
  if (/^[a-z0-9._-]+$/u.test(value)) return `${value}@ucsd.edu`;
  if (/^[a-z0-9._-]+@ucsd\.edu$/u.test(value)) return value;
  throw signInFailed();
}

async function verify(context: SystemLoginContext, target: SharePointWorkbookTarget, expected: string, transport: SharePointBrowserTransport): Promise<AuthenticationProbe> {
  current(context);
  if (URL.parse(context.page.url())?.origin !== target.origin) return { authenticated: false, reason: "SharePoint origin is absent", check: "application-route" };
  try {
    if (await context.page.locator(LOGIN_CONTROLS).count() !== 0) return { authenticated: false, reason: "Sign-in controls are present", check: "sign-in-form-absent" };
    const bytes = await transfer(context, target, `${target.siteUrl}/_api/web/currentuser?$select=Id,LoginName`, "json", transport);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    const record = typeof value === "object" && value !== null && "d" in value ? value.d : value;
    if (typeof record !== "object" || record === null || !("Id" in record) || !("LoginName" in record)
      || typeof record.Id !== "number" || !Number.isSafeInteger(record.Id) || record.Id <= 0 || typeof record.LoginName !== "string") throw signInFailed();
    const login = record.LoginName.toLowerCase();
    if (login !== expected && login !== `i:0#.f|membership|${expected}`) throw signInFailed();
    current(context);
    if (URL.parse(context.page.url())?.origin !== target.origin || await context.page.locator(LOGIN_CONTROLS).count() !== 0) throw signInFailed();
    return { authenticated: true, evidence: { system: "sharepoint", url: target.origin,
      positive: "SharePoint current-user identity matches the configured account", negative: "Sign-in controls are absent" } };
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    current(context);
    throw signInFailed({ cause: error });
  }
}

function onSso(raw: string): boolean {
  const url = URL.parse(raw);
  return url !== null && url.origin === "https://a5.ucsd.edu" && SSO_PATHS.has(url.pathname) && url.username === "" && url.password === "" && url.hash === "";
}

export async function downloadSharePointWorkbook(context: SystemLoginContext, target: SharePointWorkbookTarget, transport: SharePointBrowserTransport): Promise<Readonly<{ name: string; bytes: ArrayBuffer }>> {
  current(context);
  if (!targets.has(target)) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  const configured = resolveSystemLoginUrl(context.config, "sharepoint", context.instance, context.label);
  const checked = parseSharePointWorkbookLink(`${target.origin}${target.serverRelativePath.split("/").map(segment => encodeURIComponent(segment)).join("/")}`, configured);
  if (checked.metadataUrl !== target.metadataUrl) throw new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED");
  const expected = expectedIdentity(context.credentials.userId);
  const verifier = () => verify(context, target, expected, transport);
  const recipe = defineVerifiedLoginRecipe({
    system: "sharepoint", verify: verifier,
    navigate: async () => {
      current(context);
      await context.page.goto(target.siteUrl, { waitUntil: "domcontentloaded", timeout: context.config.timeouts.navigationMs });
      current(context);
    },
    ceremony: async (_context, token) => {
      current(context);
      assertDuoCeremonyLeaseToken(token, { system: "sharepoint" });
      const { page, config } = context;
      if (URL.parse(page.url())?.origin === "https://login.microsoftonline.com") {
        if (await page.locator('input[name="loginfmt"]').count() !== 1) throw signInFailed();
        current(context);
        if (URL.parse(page.url())?.origin !== "https://login.microsoftonline.com") throw signInFailed();
        await page.locator('input[name="loginfmt"]').fill(expected, { timeout: config.timeouts.navigationMs });
        current(context);
        if (URL.parse(page.url())?.origin !== "https://login.microsoftonline.com") throw signInFailed();
        await page.locator('#idSIButton9').click({ timeout: config.timeouts.navigationMs });
        await page.waitForURL(url => onSso(url.href), { timeout: config.timeouts.navigationMs });
      }
      if (!onSso(page.url())) throw signInFailed();
      await waitForSsoForm("sharepoint", context, token);
      if (!onSso(page.url())) throw signInFailed();
      const path = new URL(page.url()).pathname;
      if (path !== "/tritON/profile/SAML2/Redirect/SSO" && path !== "/idp/profile/SAML2/Redirect/SSO") throw signInFailed();
      await submitPinnedUcsdSsoCredentials(page, async () => {
        current(context);
        assertDuoCeremonyLeaseToken(token, { system: "sharepoint" });
        return context.credentials;
      }, () => { current(context); assertDuoCeremonyLeaseToken(token, { system: "sharepoint" }); }, config.timeouts.navigationMs, path);
      await waitForAuthenticatedLanding("sharepoint", context, token,
        raw => URL.parse(raw)?.origin === target.origin || URL.parse(raw)?.origin === "https://login.microsoftonline.com", config.timeouts.duoApprovalSeconds * 1000);
      current(context);
      if (URL.parse(page.url())?.origin === "https://login.microsoftonline.com") {
        if (await page.getByText("Stay signed in?", { exact: true }).count() !== 1 || await page.locator('#idBtn_Back').count() !== 1) throw signInFailed();
        current(context);
        if (URL.parse(page.url())?.origin !== "https://login.microsoftonline.com") throw signInFailed();
        await page.locator('#idBtn_Back').click({ timeout: config.timeouts.navigationMs });
        await page.waitForURL(url => url.origin === target.origin, { timeout: config.timeouts.navigationMs });
      }
    },
  });
  try { await recipe(context); }
  catch (error) {
    if (error instanceof AggregateError) throw error;
    current(context);
    throw signInFailed({ cause: error });
  }
  const metadataBytes = await transfer(context, target, target.metadataUrl, "json", transport);
  let metadata: unknown;
  try { metadata = JSON.parse(metadataBytes.toString("utf8")); } catch { throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED"); }
  if (typeof metadata === "object" && metadata !== null && "d" in metadata) metadata = metadata.d;
  if (typeof metadata !== "object" || metadata === null || !("UniqueId" in metadata) || !("Name" in metadata) || !("Length" in metadata)
    || typeof metadata.UniqueId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(metadata.UniqueId)
    || typeof metadata.Name !== "string" || metadata.Name !== target.serverRelativePath.split("/").at(-1) || !extension(metadata.Name)
    || (typeof metadata.Length !== "string" && typeof metadata.Length !== "number") || !/^\d+$/u.test(String(metadata.Length))) throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED");
  const length = Number(metadata.Length);
  if (!Number.isSafeInteger(length) || length <= 0) throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED");
  if (length > MAX_FILE_BYTES) throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_TOO_LARGE");
  const proof = await verifier();
  if (!proof.authenticated) throw signInFailed();
  context.recordEvidence(proof.evidence);
  const bytes = await transfer(context, target, `${target.siteUrl}/_api/web/GetFileById('${metadata.UniqueId}')/$value`, extension(metadata.Name)!, transport);
  if (bytes.byteLength !== length) throw new SharePointDownloadError("SHAREPOINT_DOWNLOAD_FAILED");
  return { name: metadata.Name, bytes: Uint8Array.from(bytes).buffer };
}
