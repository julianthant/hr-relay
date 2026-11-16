export function testProcessImport(): string {
  const inherited = process.execArgv.indexOf("--import");
  const loader = process.env.RELAY_TEST_PROCESS_IMPORT
    ?? (inherited === -1 ? undefined : process.execArgv[inherited + 1]);
  if (loader === undefined) throw new Error("test-process-precompile-setup-required");
  return loader;
}
