# src/stores/crm lessons

Historical evidence moved from the instruction pair on 2026-09-04. Search by the affected
seam or decision and read matching entries before changing it. Current contracts and current
source win over historical status. Record requested lessons here; keep the entry point concise.

## Lessons learned

- **2026-08-02: CRM fuzzy search must terminate in displayed-EID proof, and history owns invitation/completion.** Fresh read-only Playwright verification showed the broad result-row recipe includes one two-cell auxiliary row around exact five-cell data rows. The record page's verified Visualforce `th → following td` recipe resolved first name, last name, UCPath EID, and First Day exactly once. The history page contained one five-`th` header and five-`td` transition rows; only the New Value column of `ProcessStageText` is authoritative. Do not reintroduce the unverified broader field fallbacks, treat `Date Signed` as completion, or turn malformed selector/date states into blanks.
- **2026-08-03: CRM's login is a separate auth system with a security-key Duo factor.** The recipe
  lives in `session.ts` (a raw-browser owner) and is ported from legacy
  `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc` `src/infra/auth/login.ts`
  (blob `c8e6656de394b52aebd174e2a243c9464a1678e6`) and `src/infra/auth/sso-fields.ts`
  (blob `e331e8a12523f3e824f89d7e151d02bbcdf54269`). Salesforce Communities sits in front of the same
  UCSD AD realm, so it shares the credential and Duo but not the session, and its Duo prompt fires a
  SECURITY-KEY ceremony — Duo Autopilot needs that credential enrolled specifically, not just the
  platform authenticator the other systems use. The login-type `<select>` is often absent (a valid
  rendering, so absence is not a failure) but a PRESENT control that cannot be set to Active
  Directory fails loud: submitting under the wrong login type authenticates against the wrong realm.
  `act-crm.my.site.com` alone is not a landing — the Communities login page lives on the same host.
- **2026-08-03: TritON defaults to Business Systems, and the picker must be read AFTER the form
  renders.** A cold live CRM login failed at `duo-clearance` after burning the whole 60s Duo window.
  It never reached Duo: `ensureActiveDirectorySelected` probed `select` straight after `goto`, while
  the browser was still redirecting into `a5.ucsd.edu`, so `count()` was 0 and the legitimate
  "picker absent" rendering swallowed the real page — the credentials went in under **Business
  Systems** and Shibboleth answered "The username you entered cannot be identified." The comparison
  was broken too: `inputValue()` returns the option VALUE, so `.includes("Active Directory")` could
  never match. Live-verified 2026-08-03: `select#authtype[name="authtype"]` with
  `_eventId_authn/PasswordRACF` (Business Systems, the DEFAULT), `_eventId_authn/PasswordAD` (Active
  Directory) and `_eventId_authn/PasswordKrb` (Student SSO); changing it re-posts the form to a new
  `execution=` step. The recipe now waits for the SSO form first, matches the VALUE, re-waits for
  the rebuilt form, and refuses to type a credential unless the realm is confirmed Active Directory.
  The Duo security-key note above stands as a legacy record but was NOT what failed here — after the
  login-type fix Duo Autopilot cleared CRM unattended in ~12s from a cold profile.
- **2026-08-03: the label identifies the REALM, not the field.** TritON renders the same
  `#ssousername` under "Account ID or email address" (Business Systems), "User name (or email
  address)" (Active Directory) and "Username" (UCPath's entry). A label-first locator chain
  therefore silently tracks whichever realm the page happens to be showing; `id`/`name` first, every
  observed label behind it.

## Provenance

Ported from legacy commit `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`:

- `src/systems/crm/onboarding-records.ts` — blob `71e0195f358f7e27afbb5cb43f8e6e390c8918e8`
- `src/workflows/person-lookup/crm-search.ts` — blob `2ef1508b05c77a56ebd0b134e9fbcb6204ca3265`
- `src/systems/crm/extract.ts` — blob `46028e7ad1c40adc6d3d367c2fd727bc30a8f872`
- `src/systems/crm/history.ts` — blob `20b97bdfe25f01fc2569afdf4e9d2ecb33057ba7`
- `src/systems/crm/selectors.ts` — blob `e63530d375478dd330d07460c740f2027dbd7bdd`
- `src/infra/auth/login.ts` — blob `c8e6656de394b52aebd174e2a243c9464a1678e6`
