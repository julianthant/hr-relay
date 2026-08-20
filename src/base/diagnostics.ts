/**
 * Ref operator-trust §2.2's capture port, narrowed to what the interpreter can honestly
 * supply at the moment a run's failure becomes durable.
 *
 * It lives in `base/` beside the other injected-capability contracts because
 * BOTH of its sides are outside `core/`: `core` injects it and a `services/`
 * adapter implements it, and a service may never import core. `captureForFailure`
 * redacts and writes attachments but touches NO authority row; `persist` is the
 * synchronous insert the interpreter runs inside its terminal transaction, so
 * the failure's `diagnosticBundleId` forward reference can never dangle.
 */
import type { DiagnosticBundle } from "../domain/trust/diagnostic.js";
import type { FailureRecord } from "../domain/trust/failure.js";

export interface RunDiagnosticCaptureContext {
  readonly failure: FailureRecord;
  readonly configFingerprint: string;
  readonly descriptorFingerprint: string;
}

export interface RunDiagnosticCapture {
  captureForFailure(context: RunDiagnosticCaptureContext): Promise<DiagnosticBundle>;
  persist(bundle: DiagnosticBundle): DiagnosticBundle;
}
