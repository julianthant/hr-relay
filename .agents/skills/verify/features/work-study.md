# Work Study

Opens UCPath PayPath Actions for each Employee ID, plans the work-study transaction (effective date, reason JRL, pool F, matching comments) and, with Dry run off, fills it and Saves.

## Sub-features

- Employee IDs typed in the Run dialog: one run per ID, separated by commas, semicolons or new lines.
- One shared Effective date per start, typed as MM/DD/YYYY; missing or invalid is refused with "Choose a valid effective date."
- Dry run stops after the form is filled and read back; nothing is saved.

## How to get to it (user POV)

Run → Work Study → type Employee IDs → type the Effective date → Dry run on → Confirm → Start.

## Driving it with playwright-cli

Headless only; never sign in (the operator's session is used). Check `test-data check --json` for a Work Study canary first; none is declared today, so a missing subject is `blocked: needs work-study canary`, never `failed`. Fill the ID from the operator-provided value; never echo it into evidence. Compare the Run dialog and Logs with the mock at the served mock URL, screenshots side by side.

Pass list for the dialog:
1. Work Study is in the rail under Work Study and in the Run picker.
2. The dialog shows Employee IDs and Effective date; no Hire mode or other switch for the date.
3. An invalid or empty date shows "Choose a valid effective date." and Start stays unavailable.
4. Dry run can be switched on and the Confirm step lists the dates and the dry run state (the dialog starts with Dry run off today; the brief wants it on by default — record the difference).

## Passing dry run

Run reaches Done with a planned outcome. Logs show "Sign in to UCPath" and "Submit work-study transaction". `explain run` shows no Save attempt and no write intent.

## Gotchas

- Stale backend after a workflow edit refuses the run; restart per hr-manage.
- A differing date across one start is refused for every entry; one date per start.
- An unknown Save outcome is never repeated; Retry is not offered.
