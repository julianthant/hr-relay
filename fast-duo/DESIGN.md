# Relay enrollment interface

The provider opens `src/options.html` in the owned enrollment browser. It shows
the Security key and Touch ID methods. Touch ID uses Relay's protected emulated
platform authenticator on macOS and Windows. Numbered steps cover choosing a
method, opening Duo and adding the device, with one primary action. Return to
Relay activates the originating app window; Close setup tab closes only this tab.
The backend is the authority for every state and action.

`src/relay-options.js` preserves selection, keyboard focus, pending actions and
explicit unavailable or unknown states. Unknown attempts tell the operator to
review Duo devices without repeating enrollment. Creating a key alone never means that
Duo accepted the device.

The interface uses the existing system font, green accent, light and dark themes,
two-column layout and local icons. `src/styles.css` owns its tokens and states;
`src/icons/autopilot.svg` is the logo. Icon licenses ship in the third-party
notices. Dashboard components keep their existing appearance.
