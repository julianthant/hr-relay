# Production release

Subaru runs this on the operator’s go, from a checkout containing this tooling on the release Mac. Use an authenticated GitHub CLI account permitted to merge the production promotion and create releases. The production checkout is the clean HR Relay clone under `Projects/hr-relay` in the current user’s home directory.

```sh
npm run release -- <staging-to-main PR number> --dry-run
npm run release -- <staging-to-main PR number> --go
```

The default is dry run. It prints every step, reads GitHub’s merge status and required checks, and shows the planned tag. The tag date uses the Mac’s local date. The second release of a day adds `.2`.

If the production dashboard is already open, run the release from an interactive terminal. The operator must enter their Relay sign-in email and password before the command can stop and restart the dashboard. Password input is hidden. The command waits for all unfinished runs, including paused runs and parked writes, to resolve. Finish or resolve them in Relay, or use Ctrl+C to leave the release pending. Relay checks the empty run set again when accepting the quit command and holds admission during shutdown.

After the dashboard stops, the command holds Relay’s lifetime lock through deployment. It merges the approved staging head in GitHub, publishes generated release notes at the merge commit, and opens or reuses the main-to-staging sync PR. It verifies the fetched tag before checking it out, installing dependencies, rebuilding, and restarting the dashboard. Sign back in once the command reports readiness.

If publishing fails after the command stops the idle dashboard, the dashboard can remain stopped even if GitHub never merged the promotion. If a step fails after GitHub merges the promotion, inspect the failed step and rerun the same PR number while that merge remains the main tip. The command reuses a published tag and any open sync PR. A failed build or startup leaves the dashboard stopped or startup unconfirmed. Inspect the private startup log path printed by the command before retrying.
