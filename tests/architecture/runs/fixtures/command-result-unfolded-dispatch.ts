/**
 * A VIOLATING fixture for `command-result-exhaustive.test.ts` (D253, Track D
 * row D3).
 *
 * This module POSTS a command and never reads the answer through
 * `settleCommandResult`. It is the shape the guard's first arm cannot see: it
 * names no refusal arm at all, so "one arm without the other" is trivially
 * satisfied — and every refusal the kernel sends lands on the success path in
 * silence, which is strictly worse than the defect that arm was written for.
 *
 * It is checked in so the second arm's walker is executed against a real
 * violation; a scan that resolved nothing would pass over the whole tree and
 * report clean.
 */
interface CommandClient {
  executeCommand: (request: unknown) => Promise<{ state: string }>;
}

export function saveWithoutReadingTheAnswer(
  client: CommandClient,
  request: unknown,
  onSaved: () => void,
): void {
  void client.executeCommand(request).then(() => {
    // Applied, already-applied, conflict and rejected all arrive here.
    onSaved();
  });
}
