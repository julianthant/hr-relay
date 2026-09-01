# DCA4 A3 — browser refusal oracles (prepared, not browser-verified)

2026-08-30. **Two accepted test-oracle repairs prepared; full typecheck/lint pass. Browser and
negative-control execution remain pending allocation.** No browser, parity, reference update,
coverage or Vitest command ran in this unit. No commits or staging. Writer ownership is released
after this receipt; no own command or browser remains active.

## Scope and findings

Workdir for every command and absolute edit:
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.

Only `tests/parity/archive-evidence.spec.ts` and this receipt changed. The fixture HTTP repair,
nearest AGENTS, runtime/UI, canonical fixture/PNG and references remain frozen for their reviewers.
No workers/tasks/worktrees or board writes.

Used full `/ui` and `/tdd` tests mode at the parent-confirmed two refusal-injection seams.
The UI route remains established-product Operate/hardening verification; TDD's negative-control
requirement is explicitly deferred by the allocated-browser constraint, not represented as passed.

[Independent Tests report](dca4-a4-browser-refusal-tests.md): **2 medium, both accepted**. Raw counts
are retained; these are prepared source dispositions, not independent rereview closure:

| Finding | Prepared strengthening | Current lines |
| --- | --- | --- |
| Decode override installation did not prove execution or readable image dimensions | The override records its invocation and the actual `naturalWidth`/`naturalHeight` before throwing. The test requires the marker and exact positive dimensions `1440`/`900` before accepting visible decoder refusal. A prior HTTP failure cannot provide these facts. | 303–316 |
| Registered HTTP abort did not prove interception or failed request | Route matches the exact ephemeral-server byte URL. The test retains that intercepted Request object, records completion of `abort("failed")`, and observes `requestfailed` for that same object. It asserts exact URL, GET, image type, completed abort, identity equality and Chromium's `net::ERR_FAILED`. | 267–272, 286–292, 317–332 |

The request-failure listener is installed before interception/open and removed in `finally` at line
349. The existing byte barrier remains released in `finally`. The callback snapshots dimensions
from the actual image element, not from fixture metadata or invented success values.

All existing visible-title, absent-success, frozen-metadata, Download URL and hidden-image checks
remain at lines 334–346. The other nine cases, happy captures, geometry, keyboard, themes, viewports,
masks and thresholds are unchanged. **Eleven cases remain** by unchanged test/loop declarations:
two views × two cases, desktop keyboard, narrow geometry, and five refusals. This count was inspected
statically, not newly collected by a browser runner.

No sleeps, expanded timeout/threshold, fixed port, normalization or production fallback was added.
New assertions use the unchanged default expectation bounds.

## Static gates

Executed serially, with no other own light command active:

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

| Gate | Result / exact output |
| --- | --- |
| Full typecheck, owned session 66505 | Exit **0**; `> hr-automation-rebuild@0.1.0 typecheck`, `> tsc --noEmit`; no diagnostics |
| Full lint, owned session 67276 | Exit **0**; `> hr-automation-rebuild@0.1.0 lint`, `> eslint src tests scripts --max-warnings 0`; no diagnostics, zero warnings |
| `git diff --check` | Exit **0** |
| Static diff inspection | Only type-only Request import and two refusal-oracle bodies/cleanup changed; no existing UI check removed |

## Frozen identity and exact delta

- Spec before SHA-256: `7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0`.
- Spec after SHA-256: `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1`.
- **+39 / −3 lines; 317 → 353 lines.**
- Exact incremental unified-diff SHA-256: `d25514cc56d5c4fc6adef05363f3036e819fe4be9ff5fe9fbc4594e2a093d031`.
  Computed from `diff -u -L before/tests/parity/archive-evidence.spec.ts -L after/tests/parity/archive-evidence.spec.ts - tests/parity/archive-evidence.spec.ts`,
  feeding the byte-exact received spec on stdin. Labels are fixed; no timestamps or source
  normalization. The diff below is that exact patch text (ending with one newline).
- The tracked UI aggregate remains `2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0`;
  this spec is an untracked file outside that aggregate and must be received by its own hash.
- Frozen HTTP helper `7164312f74475708a8b26ddbf354be3c2f67e0f6e57566e4d5d568945b68c072`,
  HTTP fixture test `61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f`,
  AGENTS `6b18e5483c89c44ecc7e29623a724f449a0f1bcd6b6f22c6f6d8d82d05d78379`,
  canonical fixture/PNG source `3877360ad3540f5579a47c4f4e88be8c366b29332895f4772c53145474792757`
  all match their received identities.

```diff
--- before/tests/parity/archive-evidence.spec.ts
+++ after/tests/parity/archive-evidence.spec.ts
@@ -1,5 +1,5 @@
 /** DCA4's archived-capture viewer: exact frozen metadata plus verified-byte UI. */
-import { expect, test, type Locator, type Page } from "@playwright/test";
+import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
 import { resolve } from "node:path";
 import { ArchivedCaptureResourceWireSchema } from "../../src/domain/dashboard/archive.js";
 import { WireErrorSchema } from "../../src/domain/dashboard/primitives.js";
@@ -264,6 +264,12 @@
 for (const refusal of ["missing", "corrupt", "request", "image-http", "decode"] as const) {
   test(`keeps frozen facts accessible for a visible ${refusal} refusal`, async ({ page }) => {
     const bytes = barrier();
+    let interceptedImageRequest: Request | undefined;
+    let failedImageRequest: Request | undefined;
+    let abortCompleted = false;
+    const recordImageFailure = (request: Request) => {
+      if (request === interceptedImageRequest) failedImageRequest = request;
+    };
     if (refusal === "missing" || refusal === "corrupt") {
       const response = ArchivedCaptureResourceWireSchema.parse({
         runId: RUN_ID,
@@ -278,7 +284,12 @@
         state: "error", code: "ARCHIVE_FIXTURE_UNAVAILABLE", message: "The fixture archive service is unavailable.", retryable: true,
       }) }));
     } else if (refusal === "image-http") {
-      await page.route(`**${BYTE_PATH}`, (route) => route.abort("failed"));
+      page.on("requestfailed", recordImageFailure);
+      await page.route(`${server.baseUrl}${BYTE_PATH}`, async (route) => {
+        interceptedImageRequest = route.request();
+        await route.abort("failed");
+        abortCompleted = true;
+      });
     } else {
       await page.route(`**${BYTE_PATH}`, async (route) => {
         const response = await route.fetch();
@@ -292,9 +303,33 @@
       if (refusal === "decode") {
         await dialog.locator("img").evaluate((node) => {
           if (!(node instanceof HTMLImageElement)) throw new Error("the preview is not an image");
-          node.decode = async () => { throw new Error("Fixture browser decoder refused this verified image."); };
+          node.decode = async () => {
+            node.setAttribute("data-dca4-refusal-decode-called", "true");
+            node.setAttribute("data-dca4-refusal-decode-width", String(node.naturalWidth));
+            node.setAttribute("data-dca4-refusal-decode-height", String(node.naturalHeight));
+            throw new Error("Fixture browser decoder refused this verified image.");
+          };
         });
         bytes.release();
+        await expect(dialog.locator("img")).toHaveAttribute("data-dca4-refusal-decode-called", "true");
+        await expect(dialog.locator("img")).toHaveAttribute("data-dca4-refusal-decode-width", "1440");
+        await expect(dialog.locator("img")).toHaveAttribute("data-dca4-refusal-decode-height", "900");
+      } else if (refusal === "image-http") {
+        await expect.poll(() => ({
+          url: interceptedImageRequest?.url(),
+          method: interceptedImageRequest?.method(),
+          resourceType: interceptedImageRequest?.resourceType(),
+          abortCompleted,
+          sameRequest: failedImageRequest !== undefined && failedImageRequest === interceptedImageRequest,
+          failure: failedImageRequest?.failure()?.errorText,
+        })).toEqual({
+          url: `${server.baseUrl}${BYTE_PATH}`,
+          method: "GET",
+          resourceType: "image",
+          abortCompleted: true,
+          sameRequest: true,
+          failure: "net::ERR_FAILED",
+        });
       }
       const title = {
         missing: "Capture bytes are missing", corrupt: "Capture bytes could not be verified",
@@ -311,6 +346,7 @@
         await expect(dialog.getByRole("link", { name: "Download" })).toHaveCount(0);
       }
     } finally {
+      page.off("requestfailed", recordImageFailure);
       bytes.release();
     }
   });
```

## Unexecuted negative controls and browser receive

The old **6 failed / 5 passed** scoped browser run remains the actual recorded result:
[gate receipt](dca4-a3-gates.md), [original raw output](../evidence/dca4-gates/scoped-assertion-01.log).
Its five passing refusal labels did not prove injected-fault reach. Neither the later HTTP unit
green nor this typecheck/lint green substitutes for the new browser assertions.

After parent authorization **and** allocated browser slot, the following controls can prove the
oracles. They have **not** been applied or run:

1. **Decoder false-positive control:** in only the decoder case's held image response, temporarily
   fulfill a named HTTP 404 instead of the successful byte response. Preserve the rejecting override
   and every assertion. The UI may show the same refusal, but the new invocation marker must fail
   because decode was never called. Restore the exact frozen spec, then run the real decoder case.
   Its dimensions snapshot must be `1440×900` before the induced rejection is accepted.
2. **HTTP-abort false-positive control:** temporarily replace that case's `route.abort("failed")`
   with a named HTTP 404 fulfillment, retaining the interception tracking and every assertion.
   A browser image error is insufficient: no matching failed-request event should satisfy the new
   proof tuple. Restore the exact frozen spec, then run the real abort case.

For either allocated control/rerun, retain the required lock; do not update references:

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts --grep 'visible decode refusal'
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts --grep 'visible image-http refusal'
```

Parent owns independent Tests/Correctness rereview, fresh lights, exact scheduling and the original
full eleven-case scoped rerun. No new screenshot or reference triplet is claimed. **Writer closed;
browser proof and negative controls are explicitly pending.**
