# Duo Autopilot

Relay loads this Manifest V3 extension into its owned Chromium sessions to answer Duo WebAuthn assertions for `duosecurity.com`. Full Chromium is required because the separate headless shell cannot load extensions. Relay can run full Chromium headed or headless.

This automates a Duo factor. Use it only for an account and environment you are authorized to operate, and follow the institution's authentication policy.

## Provisioning

Relay reads and validates the protected credential file configured by `paths.duoCredential` (`duoWebauthnCredential`). It loads the extension from `paths.duoExtensionDir`, then writes the credential records to the extension's `chrome.storage.session` for each owned browser session. Relay restricts that storage to trusted extension contexts and verifies the stored records. It refuses to provision if a credential copy already exists in `chrome.storage.local`.

The extension does not enroll keys or import a packaged credential file. Its Options page shows the active session's credential status and signing counters; it cannot add or replace credentials. Set the credential through Relay's machine credential file.

## Assertion flow

On `*.duosecurity.com`, `inpage.js` intercepts `navigator.credentials.get()` only when the WebAuthn relying-party ID is `duosecurity.com`. `content.js` relays the challenge to `background.js`. The service worker signs it with the provisioned private key, advances the signing counter in session storage, and returns the assertion. The page and content script never receive the private key. If signing is disabled or no matching credential is available, the browser handles the request normally.

The extension does not override `navigator.credentials.create()`. Duo device registration uses the browser's normal WebAuthn flow.

When enabled, the trust-click setting selects Duo's affirmative "Yes, this is my device" or "Yes, trust browser" control after approval. It does not select the refusal control.

## Options

The extension Options page provides these controls:

| Control | Behavior |
|---|---|
| **Autopilot** | Enables or disables automatic assertion signing. |
| **Trust this device** | Enables or disables the affirmative trust-device click. |
| **Show toast** | Enables or disables the on-page approval notice. |
| **Clear credentials** | Removes the credential records from the current browser session. Relay provisions them again when it starts a new owned session. |

All three toggles default to on. Clearing credentials affects only the current browser session.

## Offline test

From the repository root, run:

```bash
npm --prefix duo-autopilot test
```

The test uses a generated throwaway P-256 key and verifies the byte-exact assertion data and signature. It does not read the configured credential.
