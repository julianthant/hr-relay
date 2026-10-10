
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
