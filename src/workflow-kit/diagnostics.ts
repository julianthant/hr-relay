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

/** A run-selected capture taken while the worker lease still owns its page. */
export interface RunBrowserScreenshotCapture {
  capture(context: Readonly<{
    runId: string;
    descriptorFingerprint: string;
    configFingerprint: string;
    system: string;
    trigger: Readonly<{ kind: "task-point"; nodeId: string; attempt: number; boundary?: "step" | "before-submit" | "after-submit" }> | Readonly<{ kind: "lease-end"; outcome: "succeeded" | "failed" }>;
    screenshot: BrowserScreenshotEvidence;
    sampleLabels?: readonly string[];
  }>): Promise<void>;
}
