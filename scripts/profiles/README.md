# Staging and development copies

Run the profile command from a Relay checkout other than the copy you are updating.

| Command | Worktree | Source | Backend / frontend |
| --- | --- | --- | --- |
| `npm run profile:staging` | `~/Projects/hr-relay-staging` | `origin/staging` | 3941 / 5175 |
| `npm run profile:development` | `~/Projects/hr-relay-dev` | `origin/development` | 3940 / 5176 |

1. Run the command for the desired profile. It fetches the branch, checks out its exact commit in
   a detached worktree, installs dependencies, and prints the profile, ref, SHA, ports, and start
   command. The branch must contain its isolated dashboard launcher.
2. Start the copy using the printed command. Complete Relay signup and Duo in that copy, then quit
   the dashboard without signing out.
3. Run the same profile command with `-- --source-person <production profile UUID>` to import the
   workbook library into the selected isolated person. Use that same argument on subsequent
   refreshes. For example, the staging command is
   `npm run profile:staging -- --source-person <production profile UUID>`.

The isolated dashboard must be stopped for setup or refresh. The command holds its lifetime lock
through checkout, dependency installation, and import and refuses dirty or unrelated worktrees.

Production can keep running. The store imports from the chosen person's newest verified backup
and checks the backup's identity, contents, and schema. If production prunes that backup during the
import, rerun the command. Allow production to take a new in-session backup if none is available.
The import refreshes local workbook content and workbook types and preserves edits made in the
copy. Only the workbook library crosses environments. Each copy has its own signup and Duo.
