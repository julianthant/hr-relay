/** D341 usage lines for `cli test-data`; the composition lives in `src/server/test-data/compose.ts`. */
export const TEST_DATA_USAGE = [
  "test-data check --json [--subject <label> [--workflow <id>]] [--file <name>]  report shared test data, private input presence and one subject's readiness by name only",
  "test-data migrate --from-credentials [--plan] --json  move the two retired canary entries from the credential document into config/test-data.local.json",
] as const;
