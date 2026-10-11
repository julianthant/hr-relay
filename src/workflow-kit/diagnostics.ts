// Capture redacts; terminal persistence prevents dangling diagnostic bundle IDs.
import type { BrowserScreenshotEvidence } from "./session.js";
import type { DiagnosticBundle } from "../models/trust/diagnostic.js";
import type { FailureRecord } from "../models/trust/failure.js";

export interface RunDiagnosticCaptureContext {
  readonly failure: FailureRecord;
  readonly configFingerprint: string;
  readonly descriptorFingerprint: string;
}

export interface RunDiagnosticCapture {
  captureForFailure(context: RunDiagnosticCaptureContext): Promise<DiagnosticBundle>;
  persist(bundle: DiagnosticBundle): DiagnosticBundle;
  discard(bundle: DiagnosticBundle): void;
}

/** A capture selected on the immutable run envelope, taken while a lease still owns its page. */
export interface RunBrowserScreenshotCapture {
  capture(context: Readonly<{
    runId: string;
    descriptorFingerprint: string;
    configFingerprint: string;
    system: string;
    leaseOutcome: "succeeded" | "failed";
    screenshot: BrowserScreenshotEvidence;
  }>): Promise<void>;
}
