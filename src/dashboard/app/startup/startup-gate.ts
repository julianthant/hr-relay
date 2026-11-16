import { useEffect, useRef, useState } from "react";
import type { PublicProfileState } from "../../../models/profiles/public-profile.js";
import type { ServedOnboardingPort } from "../../surfaces/shell/onboarding-model.js";

/**
 * The startup screen shows until the session is known. A signed-out answer that is resumable
 * means a person is already signed in: resume here, so the sign-in page never mounts for them.
 */
export function useStartupGate(session: PublicProfileState | undefined, readFailed: boolean, port: ServedOnboardingPort) {
  const resumable = session?.state === "signed-out" && session.resumable === true;
  const [resume, setResume] = useState<"pending" | "refused" | "unavailable">("pending");
  const started = useRef(false);
  useEffect(() => {
    if (!resumable) { started.current = false; setResume("pending"); return; }
    if (started.current) return;
    started.current = true;
    void port.resume().then(result => { if (result.state !== "active") setResume("refused"); }, () => setResume("unavailable"));
  }, [resumable, port]);
  return {
    loading: !readFailed && (session === undefined || resumable && resume === "pending"),
    unavailable: resume === "unavailable",
  };
}
