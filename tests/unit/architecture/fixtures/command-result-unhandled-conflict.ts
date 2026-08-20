/**
 * A VIOLATING fixture for `command-result-exhaustive.test.ts` (D253).
 *
 * This is the exact shape the Context rail and the notification bell both
 * shipped: one refusal arm tested, the other left to fall through into the
 * success path. It is checked in so the guard's walker is executed against a
 * real violation — a scan that resolved nothing would pass over the whole tree
 * and report clean.
 */
type Result =
  | { state: "applied" }
  | { state: "conflict"; currentVersion: number; message: string }
  | { state: "rejected"; message: string };

export function saveAndSilentlySucceed(
  result: Result,
  report: (problem: string) => void,
  succeed: () => void,
): void {
  if (result.state === "rejected") {
    report(result.message);
    return;
  }
  // `conflict` lands here: refused by the kernel, reported as saved.
  succeed();
}
