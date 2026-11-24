# Staging and development copies

Run the profile command from a Relay checkout other than the copy you are updating.

| Command | Worktree | Source | Backend / frontend |
| --- | --- | --- | --- |
| `npm run profile:staging` | `~/Projects/hr-relay-staging` | `origin/staging` | 3941 / 5175 |
| `npm run profile:development` | `~/Projects/hr-relay-dev` | `origin/development` | 3940 / 5176 |

1. Run the command for the desired profile. It fetches the branch, checks out its exact commit in
   a detached worktree, installs dependencies, and prints the profile, ref, SHA, ports, and start
   command. The branch must contain its isolated dashboard launcher.
2. [Sign in to the copy](#sign-in), then quit the dashboard without signing out.
3. Run the same profile command with `-- --source-person <production profile UUID>` to import the
   workbook library and run history into the selected isolated person. Use that same argument on subsequent
   refreshes. For example, the staging command is
   `npm run profile:staging -- --source-person <production profile UUID>`.

The isolated dashboard must be stopped for setup or refresh. The command holds its lifetime lock
through checkout, dependency installation, and import and refuses dirty or unrelated worktrees.

Production can keep running. The store imports from the chosen person's newest verified backup
and checks the backup's identity, contents, and schema. If production prunes that backup during the
import, rerun the command. Allow production to take a new in-session backup if none is available.
The dashboard shows the imported runs alongside runs created in the copy. Steps, logs, timeline
events, notifications, and analytics use history from the same backup. Runs that were active or
waiting at backup time appear as discarded, with an explanation. Terminal runs keep their outcome.
Workers, gates, and the write sequencer use the copy's own operational store. An imported
confirmation uses its archived attempt, checkpoint, and write proof.

Each refresh replaces the selected person's imported history as a unit and preserves runs created
in the copy. If the histories share an identifier for a run or its evidence, refresh reports
the collision and preserves the previous archive. Refresh also updates local workbook content and types and preserves workbook edits
made in the copy. The command imports database history only. Browser profiles, credentials, Duo
keys, and artifact files stay with their original installation.

## Sign in

From the copy checkout, run `npx tsx scripts/profiles/copy-signin.ts development` or use
`staging` for the staging copy. Stop any running copy dashboard before using this launcher.
The command opens a dashboard window and keeps the copy running until you close the window
or press Ctrl+C. Use the same command to resume that window's session when you haven't
signed out.

Create `~/.config/relay/operator-signin.env` with mode `600` and the four entries
`RELAY_EMAIL`, `RELAY_PASSWORD`, `UCPATH_USERNAME`, and `UCPATH_PASSWORD`.
The copy uses the normal encrypted Relay settings for its own sign-up and keeps the
UCPath values in memory for Duo setup. If Duo requires confirmation on an existing
device, the launcher prints `approve the Duo request on your phone`. The final line
reports whether the copy signed in or resumed and how many phone approvals it needed.
