# Fast Duo for Relay

Fast Duo is the Duo authenticator extension that Relay stages into its owned
Playwright Chromium sessions on macOS and Windows. It is shipped with the desktop
app; the operator manages sign-in and enrollment through the dashboard.

## Runtime entry points

`src/backend/runtime/browser/fast-duo-extension.ts` stages an explicit file
allowlist into each owned browser profile and writes the selected source manifest
as `manifest.json`:

- `workflow-manifest.json` loads the workflow background, main-world hook,
  isolated content bridge and username observer. It has no storage permission or
  extension UI. `workflow-duo-provider.ts` brokers public assertions from the
  backend under the current profile, worker and ceremony scope.
- `relay-manifest.json` loads the enrollment background, page bridges and native
  credential observer. `onboarding-duo-provider.ts` opens `src/options.html` for
  the private profile draft. Its controls request state, open Duo, start, cancel
  or confirm an enrollment through the backend-owned browser broker. Return to Relay
  activates the original app/window captured before the setup browser opens; Close
  setup tab closes only that extension tab.

All enrollment, login and closure-probe sessions use full bundled Playwright Chromium
(`channel: "chromium"`); the headless shell cannot load extensions. No installed
Chrome dependency is required. Both manifests require Chromium 140 or later.

## Credentials and enrollment

The backend owns durable credentials, signing and the advancing signature counter
shared across sessions. Enrollment's Chromium `storage.session` is restricted to
`TRUSTED_CONTEXTS`; it keeps public descriptors and one-shot capture state, never
private signing keys or counters. Session writes are serialized and read back
before success. Closing setup clears that state.

Enrollment binds the exact account, tab, frame, document, Duo origin and RP ID.
Software registration waits for backend persistence and ceremony acknowledgments.
Platform discovery prepares the verified top-level Duo page before replying to
Duo's availability check. Touch ID uses Chromium's emulated internal platform
authenticator on macOS and Windows. Its key and observed registration counter
enter canonical encrypted custody. Each login re-adds ready internal keys through
the owned private CDP pipe. Native signatures are disabled after enrollment and
for login replicas; the backend signer and current ceremony lease retain counter
and assertion authority. No hardware probe or native-to-emulated retry is used.
A captured
key becomes usable only after the required confirmation or exact credential
request; request aborts, timeouts and scoped refusals retain UNKNOWN before another
capture can start. Redacted hop events use the profile debug timeline and its
development terminal mirror; an uncertain enrollment must not be repeated.

Show and Open keep in-browser focus and activate the exact owned browser process
at the OS level: AppKit on macOS, foreground-window activation on Windows. Failed
activation refuses visibly; it does not confirm or retry enrollment.

## Development

From `fast-duo/`, run `npm ci`, `npm test` and `npm run lint`. The repository CI
`static` job runs these alongside the app's static checks. See
[VERIFICATION.md](VERIFICATION.md) for coverage and limits, and [DESIGN.md](DESIGN.md)
for the retained enrollment interface. [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) accompany each staged runtime.
