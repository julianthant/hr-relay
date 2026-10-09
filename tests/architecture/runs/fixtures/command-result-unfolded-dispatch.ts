
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
