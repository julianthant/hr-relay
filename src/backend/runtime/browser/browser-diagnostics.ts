import type { Page, ConsoleMessage, Request, Response } from "playwright";
import type { Clock } from "../../../rules/time/clock.js";
import type { BrowserScreenshotEvidence } from "../../../workflow-kit/session.js";

/** Unclassified page text is omitted; method/status/error class remain useful and secret-free. */
export function attachBrowserDiagnostics(page: Page, clock: Clock, observeEvent: () => Readonly<{ state: "current" | "revoked" }>) {
  let active = false;
  let omitted = 0;
  const consoleRows: { kind: string; at: string }[] = [];
  const networkRows: { kind: string; method: string; status?: number; at: string }[] = [];
  const keep = <T>(rows: T[], row: T) => { if (observeEvent().state === "revoked" || !active) return; if (rows.length === 128) { omitted++; return; } rows.push(row); };
  const consoleMessage = (message: ConsoleMessage) => keep(consoleRows, { kind: message.type(), at: clock.now().toISOString() });
  const pageError = () => keep(consoleRows, { kind: "pageerror", at: clock.now().toISOString() });
  const requestFailed = (request: Request) => keep(networkRows, { kind: "requestfailed", method: request.method(), at: clock.now().toISOString() });
  const response = (response: Response) => { if (response.status() >= 400) keep(networkRows, { kind: "error-response", method: response.request().method(), status: response.status(), at: clock.now().toISOString() }); };
  page.on("console", consoleMessage); page.on("pageerror", pageError);
  page.on("requestfailed", requestFailed); page.on("response", response);
  return Object.freeze({
    begin() { consoleRows.length = 0; networkRows.length = 0; omitted = 0; active = true; },
    end() { active = false; },
    snapshot(): NonNullable<BrowserScreenshotEvidence["diagnosticAttachments"]> {
      return [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode(JSON.stringify({ records: consoleRows, omitted, textOmitted: true })) },
        { kind: "network-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode(JSON.stringify({ records: networkRows, omitted, bodiesHeadersUrlsOmitted: true })) }];
    },
    dispose() { active = false; page.off("console", consoleMessage); page.off("pageerror", pageError); page.off("requestfailed", requestFailed); page.off("response", response); },
  });
}
