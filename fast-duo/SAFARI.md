# Safari on Mac

Requires Safari 18 or later on macOS 13 or later. This build is for Mac; it does not install on iPhone or iPad.

Use only your own Duo account. This project is licensed under the MIT License;
see LICENSE. Third-party material retains its licenses in THIRD_PARTY_NOTICES.md.

## Install locally

1. Open **Duo Autopilot.app**. Keep the app in a permanent folder, such as your Applications folder.
2. In Safari → Settings → Advanced, enable **Show features for web developers**.
3. In Safari's Develop menu → Developer Settings (or Settings → Developer), enable **Allow unsigned extensions**. This is needed because this local build is ad-hoc signed, not signed with an Apple Developer certificate. Safari may require enabling this again after restarting.
4. In Safari → Settings → Extensions, enable **Duo Autopilot Extension**.
5. Allow website access for your Duo site under **Edit Websites**. Reload open Duo pages after granting permission.
6. Open the toolbar icon → Settings. The personal build includes your previously configured accounts and keys. A share build starts empty.

If Safari shows the old startup error, quit and reopen Safari after replacing the app. Chrome extension folders cannot be installed directly as permanent Safari extensions.

## Build

Install full Xcode and finish its first-launch setup. The build uses `DEVELOPER_DIR` if set; otherwise it uses `/Applications/Xcode.app/Contents/Developer`. It does not change the system's selected developer directory.

```
npm ci
npm run package:safari           # clean app + share ZIP
npm run package:safari:personal  # private app with existing local credentials
```

Outputs:

- `dist/safari-share/Duo Autopilot.app` and `dist/duo-autopilot-safari-share.zip`: clean local setup with no accounts or keys.
- `dist/safari-personal/Duo Autopilot.app`: private installation. Never share it, its generated Xcode project, or its extension folder.

Xcode projects are also generated inside those output directories. Builds contain both Apple Silicon and Intel binaries. The converter may warn about `world` and `type`; Safari supports main-world scripts starting in Safari 18 and module background workers starting in Safari 16.4. Those fields are required and intentionally retained.

## Accounts and storage

Safari stores keys in the extension background's IndexedDB database. Content scripts do not get the keys. Chrome continues using local extension storage restricted to trusted contexts. Safari migration copies and verifies old extension data before removing the old copy; a conflict or failed copy blocks startup and preserves the data.

Safari and Chrome keep independent account state and signature counters. Changes in one browser do not sync to the other. Prefer enrolling separate devices per browser when your organization's policy permits it. Manage → Alternate usernames links additional names to the same account and keys, with shared counters. Duo must recognize those keys. Guided enrollment accepts an exact primary or alternate username and uses an existing Duo verification method.

## Clean package

The clean ZIP contains no personal credentials. Include LICENSE and
THIRD_PARTY_NOTICES.md when redistributing it. Local installation requires
enabling this development build and enrolling your own keys. A standard installation without developer
settings requires Apple Developer signing and notarization or App Store
distribution; this project has not been published.

References: [Apple packaging](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari), [running Safari extensions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension), [Safari 16.4 modules](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Safari 18 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes).
