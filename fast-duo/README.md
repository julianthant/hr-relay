# fast-duo

A local software WebAuthn authenticator that answers matching Duo security-key requests from a browser extension.

fast-duo is for people using their own Duo account on their own machine, where their organization permits software authenticators. The browser calls it **Duo Autopilot**. It supports separate accounts, alternate usernames, and global and per-account pause controls.

## Enrollment and consent

The user signs in normally and verifies through an existing Duo method before opening device management. They choose an account and Duo tab, then explicitly start capture. Capture accepts one registration within ten minutes, bound to that account, tab, and origin.

A generated key stays pending until the user confirms Duo accepted registration or Duo requests that exact credential ID. Matching requests are then signed automatically without a fresh approval click. An unlocked browser profile can use its connected keys. Enrollment still depends on the organization's device policy and existing authentication requirements.

## How it works

A page hook intercepts Duo's WebAuthn calls. An isolated content script passes requests to the background service, which selects a credential, signs, and returns public response data. Chrome restricts key storage to trusted extension contexts; Safari uses background-owned IndexedDB.

The engineering work includes:

- Encoding registration data with CBOR and COSE, then producing ECDSA P-256 assertions with Web Crypto and DER signatures.
- Checking the browser-observed origin and Duo relying-party ID, and signing client data containing the supplied challenge and origin.
- Matching exact credential IDs and usernames. Unknown or ambiguous requests return to normal browser authentication.
- Serializing state changes and persisting advancing signature counters before returning responses.
- Verifying Safari's copied storage before deleting the original, preserving data when migration conflicts or fails.

## Stack and verification

Plain JavaScript, HTML, CSS, Manifest V3, Web Crypto, and browser storage. Node.js drives tests and packaging; ESLint checks source. There is no runtime server or external runtime library.

Chrome 140+ is the main installation path. Safari 18+ on macOS has an Xcode packaging path. Offline tests check signatures and tamper rejection; mocked browser fixtures exercise enrollment and matching. These checks do not establish live Duo acceptance or production reliability.

## Repository snapshot

47 commits from June 5 to October 12, 2026.

Real HR data lives outside this repository. Personal credentials and browser profiles are excluded from source and clean share packages.
