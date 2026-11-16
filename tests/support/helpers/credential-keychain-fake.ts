export class FakeKeyringEntry {
  private static readonly secrets = new Map<string, string>(JSON.parse(process.env.RELAY_TEST_KEYCHAIN ?? "[]") as [string, string][]);
  private readonly account: string;
  constructor(service: string, account: string) { this.account = `${service}:${account}`; }
  getPassword(): string | null { return FakeKeyringEntry.secrets.get(this.account) ?? null; }
  static snapshot(): [string, string][] { return [...FakeKeyringEntry.secrets]; }
  static import(entries: [string, string][]): void {
    for (const [account, secret] of entries) FakeKeyringEntry.secrets.set(account, secret);
    process.env.RELAY_TEST_KEYCHAIN = JSON.stringify(FakeKeyringEntry.snapshot());
  }
  setPassword(secret: string): void { FakeKeyringEntry.import([[this.account, secret]]); }
  deletePassword(): boolean {
    const deleted = FakeKeyringEntry.secrets.delete(this.account);
    process.env.RELAY_TEST_KEYCHAIN = JSON.stringify(FakeKeyringEntry.snapshot());
    return deleted;
  }
}

export { FakeKeyringEntry as Entry };

export function credentialKeychainTestEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const preload = new URL("./credential-keychain-process-preload.mjs", import.meta.url).href;
  return { ...environment, NODE_OPTIONS: `${environment.NODE_OPTIONS ?? ""} --import=${preload}`,
    RELAY_TEST_KEYCHAIN: JSON.stringify(FakeKeyringEntry.snapshot()) };
}
