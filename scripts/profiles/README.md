# Staging and development copies

`npm run profile:staging` and `npm run profile:development` set up or update a copy. Run them from the production checkout while production keeps running; they only read production's verified backup files.

Each run:

1. Refuses while the profile's own dashboard (staging 3941/5175, development 3940/5176) has an active run.
2. Fetches, then moves the copy's worktree to the newest `origin/cut/*` (`~/Projects/hr-relay-staging`) or `origin/development` (`~/Projects/hr-relay-dev`); creates it first when missing; refuses a dirty worktree.
3. Copies each person's newest verified authority backup (database and manifest, checked against the manifest's size and SHA-256) into the profile's data folder. Backups hold no credentials or tokens; nothing else is copied.
4. Prints the profile, ref and SHA, ports, backups copied and the start command.

## Live setup after merge (operator steps marked)

1. Production must have taken a verified backup (it does so hourly while running).
2. `npm run profile:staging`, then `npm run profile:development`.
3. In each copy's worktree: `npm ci && npm run dashboard:<profile>`.
4. **Operator:** sign in with Duo in each copy, and load the copied backup through the dashboard's storage restore (the first live setup confirms the exact step). Credentials are never copied, so each copy needs its own sign-in.
5. **Operator:** repeat step 2 to refresh a copy; stop that copy's dashboard first if it reports an active run.
