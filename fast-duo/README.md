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
  or confirm an enrollment through the backend-owned browser broker.

Workflow sessions and non-macOS enrollment use full Playwright Chromium
(`channel: "chromium"`); the headless shell cannot load extensions. macOS
enrollment and its closure probes use installed, signed Google Chrome
(`channel: "chrome"`) so native Touch ID can access its entitled keychain group.
The owned enrollment context loads only its staged extension with
`Extensions.loadUnpacked` over Playwright's private DevTools pipe. Chrome must be
installed; a launch or load failure refuses setup without changing browser. Both
manifests require Chromium 140 or later.

## Credentials and enrollment

The backend owns durable credentials, signing and the advancing signature counter
shared across sessions. Enrollment's Chromium `storage.session` is restricted to
`TRUSTED_CONTEXTS`; it keeps public descriptors and one-shot capture state, never
private signing keys or counters. Session writes are serialized and read back
before success. Closing setup clears that state.

Enrollment binds the exact account, tab, frame, document, Duo origin and RP ID.
Software registration waits for backend persistence and ceremony acknowledgments.
Platform discovery prepares the verified top-level Duo page before replying to
Duo's availability check. Native Touch ID passes through with software interception disabled. When a successful platform
probe reports no authenticator, or the host is not macOS, Relay uses Chromium’s virtual internal authenticator
and retains its key in canonical encrypted custody. A failed probe or native ceremony
never triggers an emulated retry. A captured
key becomes usable only after the required confirmation or exact credential
request; request aborts, timeouts and scoped refusals retain UNKNOWN before another
capture can start. Redacted hop events use the profile debug timeline and its
development terminal mirror; an uncertain enrollment must not be repeated.

## Development

From `fast-duo/`, run `npm ci`, `npm test` and `npm run lint`. The repository CI
`static` job runs these alongside the app's static checks. See
[VERIFICATION.md](VERIFICATION.md) for coverage and limits, and [DESIGN.md](DESIGN.md)
for the retained enrollment interface. [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) accompany each staged runtime.
