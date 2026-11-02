# Verification

The repository CI `static` job installs this package, runs `npm test` and
`npm run lint`. The offline suite generates throwaway keys and checks WebAuthn
encoding, registration, assertions, signature verification and tamper rejection.
It also covers exact credential and username matching, alias collisions,
serialized enrollment, backend signing acknowledgments, protected Chromium session
storage, scope loss and native pass-through. No real credentials are used.

The repository suites add:

- `tests/fast-duo/src/`: shared counter arithmetic, workflow bridge scope,
  enrollment UI state/focus guards and real isolated native browser behavior.
- `tests/backend/runtime/browser/fast-duo-extension*.test.ts`: complete staged
  import closure, private file custody and a real Chromium workflow extension.
- `tests/backend/runtime/browser/onboarding-duo-provider*.test.ts`: draft browser
  ownership, broker validation, native enrollment and closure.
- `tests/backend/app/composition/dashboard/compose.public-profile-shell.integration.test.ts`:
  dashboard profile enrollment composition.

CI runs the registered unit, integration and architecture suites. The assigned
lane's `common.md` owns any restriction on local checks. These fixtures do not
establish live Duo page compatibility, server acceptance, application login or
operator sign-off; those require an authorized dashboard session.
