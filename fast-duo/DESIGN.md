# Relay enrollment interface

The provider opens `src/options.html` in the owned enrollment browser. It shows
the Security key and Touch ID methods. Touch ID uses Relay's protected emulated
platform authenticator on macOS and Windows. The panel shows one title, one
instruction and one primary action for the selected method. Return to Relay
activates the originating app window; Close tab closes only this tab. Both sit in
the top bar. Cancel setup appears only while a method is pending.
The backend is the authority for every state and action.

`src/relay-options.js` preserves selection, keyboard focus, pending actions and
explicit unavailable or unknown states. Unknown attempts tell the operator to
review Duo devices and start that method over. Creating a key alone never means
that Duo accepted the device: a method completes when Duo shows its success heading
or the operator confirms it.

The interface uses the existing system font, green accent, light and dark themes,
two-column layout and local icons. `src/styles.css` owns its tokens and states;
`src/icons/autopilot.svg` is the logo. Icon licenses ship in the third-party
notices. Dashboard components keep their existing appearance.
