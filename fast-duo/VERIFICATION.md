# Verification

Run the offline gates from the project root:

```sh
npm ci
npm test
npm run lint
npm run test:coverage
npm run package
```

The crypto self-test generates throwaway keys and checks byte encoding,
registration, assertions, signature verification, and tamper rejection.
Account and service tests cover exact matching, alias collisions, account
isolation, counter persistence, storage failures, migration, removal, imports,
and opt-in one-shot enrollment bound to an account, tab, origin, and expiry.
Username extraction uses synthetic document fixtures.

For browser checks, use playwright-cli with an isolated Chromium profile and
the clean extension loaded. Block outbound requests and fulfill the fixture
host through Playwright routing.

1. Open `src/options.html` through the extension URL. Verify that the clean
   bootstrap starts with no accounts or keys.
2. Add the synthetic account `demouser` and leave its editor open. Run
   `scripts/browser-flow.js` through `playwright-cli run-code --filename=...`.
3. In a fresh profile, add `demo-user`, save `demouser` as an alternate username,
   and leave its editor open. Run `scripts/browser-alias-flow.js` the same way.
4. Inspect pending and connected states, pause behavior, the help page, and the
   popup. Close the owned browser and remove its disposable profile.

Both scripts generate keys locally and intercept HTTPS on the fixture Duo
host. They verify enrollment, the public response bridge, exact credential
selection, automatic activation, and shared alias use without a Duo server.
Keep profiles, screenshots, and logs outside the committed tree.

Inspect every decompressed clean-package entry. The package must contain an
empty bootstrap, LICENSE, third-party notices, installation instructions, and
only the runtime allowlist. Personal builds are private and are never release
artifacts.

Before publication, scan the exact committed export, its commit metadata, and
any proposed release artifacts. Explain each synthetic fixture finding
individually; do not suppress an entire test directory. Pin the commit and tree
SHA reviewed by the owner. Any change invalidates that publication scan.

Unit coverage describes imported modules, not complete browser behavior.
Mocked checks do not verify live Duo page layouts, server acceptance, successful
application logins, or institutional policy. Browser-store publication and
visibility changes are separate owner decisions.
