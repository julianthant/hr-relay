# Running Relay on Windows

On Windows, build the production dashboard with `npm run web:build`. In Command Prompt, set
`RELAY_NODE` to the full path of your portable Node 26 `node.exe`, then run `relay.cmd` from the
checkout. The default is `tools\node\node.exe` inside the checkout. Relay opens its local dashboard
in a dedicated Edge app window. Keep the launcher console open; use `relay.cmd stop` in a second
console to wait for active work and stop the backend. You can then close the Edge window.
Running `relay.cmd` again reopens the existing app window. Failed commands print a public error
and keep the command window open until you press a key.

The launcher stores its private stop capability and Edge profile under `%LOCALAPPDATA%\Relay\launcher`.
Windows backups, restore, schema upgrades and account deletion remain unavailable. Use fresh state
for schema trials and preserve existing folders.
