# Sign-up

Creating a Relay profile: Duo enrollment of Touch ID and Security key at `duo.ucsd.edu`, then Finish. Not the Onboarding workflow.

## Sub-features

- Two required enrollments; Finish unavailable until both verify; Unknown shows as Unknown.
- Reopen browser refocuses the owned setup window without a new attempt.
- Cancel sign-up (confirmed) removes the unfinished profile.

## How to get to it (user POV)

Fresh dashboard with no profile, or the profile menu's sign-up entry.

## Driving it with playwright-cli

Reach the sign-up Details and Duo screens and screenshot each. Enrollment, login and Duo are the operator's. Never press Finish or create a profile in a store the operator owns unless they say so in this session; Cancel sign-up leaves nothing behind.

## Passing dry run

Both method chips show their state on one line; Finish is disabled until both read Verified; Cancel confirms, then the dashboard returns to signed-out with no profile left.

## Gotchas

- Hardware-unavailable shows Chromium's virtual platform authenticator for Touch ID; it never substitutes for Security key.
- A lost cancellation response blocks another attempt for that draft; restart the runtime.
