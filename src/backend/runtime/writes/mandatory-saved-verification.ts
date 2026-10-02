/** A settled commit callback must reach its saved-effect verifier despite diagnostic I/O failure. */
export async function runMandatorySavedVerification<T>(input: Readonly<{
  diagnosticFailure?: unknown;
  diagnosticIsProgramFailure: (error: unknown) => boolean;
  reportDeliveryFailure: () => void;
  verifySavedEffect: () => Promise<T>;
  onProgramFailure: (error: unknown) => never;
}>): Promise<T> {
  const failure = input.diagnosticFailure;
  if (failure !== undefined && !input.diagnosticIsProgramFailure(failure)) {
    try { input.reportDeliveryFailure(); } catch { /* health reporting cannot override the external outcome */ }
  }
  const proof = await input.verifySavedEffect();
  if (failure !== undefined && input.diagnosticIsProgramFailure(failure)) input.onProgramFailure(failure);
  return proof;
}

/** One protected occurrence: fenced callback and verifier, durable settlement, then non-authoritative notification. */
export async function completeProtectedWrite<Verified, Settled, Existing, Result>(input: Readonly<{
  performCommitAndVerify: () => Promise<Readonly<{ state: "new"; proof: Verified }> | Readonly<{ state: "existing"; result: Existing }>>;
  settleVerified: (proof: Verified) => Promise<Settled> | Settled;
  onSettled: (settlement: Settled, proof: Verified) => void;
  reportDeliveryFailure: () => void;
  projectSettled: (settlement: Settled) => Result;
}>): Promise<Result | Existing> {
  const performed = await input.performCommitAndVerify();
  if (performed.state === "existing") return performed.result;
  const settlement = await input.settleVerified(performed.proof);
  try { input.onSettled(settlement, performed.proof); }
  catch {
    try { input.reportDeliveryFailure(); } catch { /* health reporting cannot override settlement */ }
  }
  return input.projectSettled(settlement);
}
