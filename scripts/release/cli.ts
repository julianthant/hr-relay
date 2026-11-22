import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { githubRelease } from "./github.js";
import { productionRelease } from "./production.js";
import { runRelease } from "./release.js";

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "dry-run": { type: "boolean" },
    go: { type: "boolean" },
  } });
  const [number] = positionals;
  if (positionals.length !== 1 || !/^[1-9]\d*$/u.test(number) || (values.go && values["dry-run"])) {
    throw new Error("Usage: npm run release -- <staging PR number> [--dry-run | --go]");
  }
  const report = (message: string) => process.stdout.write(`${message}\n`);
  const gh = githubRelease(number, (program, args) => execFileSync(program, args, { encoding: "utf8" }).trim(), report);
  const production = productionRelease(report);
  try {
    await runRelease(values.go !== true, {
      printPlan: () => {
        if (!values.go) report("Dry run. GitHub checks and tag discovery are read-only.");
        report([
          `1. Verify the required production checks for staging PR #${number}.`,
          "2. Wait for active production runs to finish, quit the idle dashboard, and acquire its lifetime lock.",
          "3. Merge the checked staging head into main through GitHub and publish a dated release with generated notes.",
          "4. Open or reuse the main-to-staging sync PR.",
          "5. Fetch and verify the release tag, switch the production checkout, install dependencies, and build the dashboard.",
          "6. Start the production dashboard and confirm it is ready for sign-in.",
        ].join("\n"));
      },
      verifyPromotion: () => gh.verifyPromotion(),
      stopIdleDashboard: () => production.stopIdleDashboard(),
      publish: () => gh.publish(),
      syncStaging: () => gh.syncStaging(),
      deploy: () => production.deploy(gh.target()),
      restartDashboard: () => production.restartDashboard(),
    });
  } finally {
    await production.close();
  }
} catch (error) {
  process.stderr.write(`Release stopped. ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
