# Relay enrollment interface

The provider opens `src/options.html` in the owned enrollment browser. It shows
the private draft's software security key and native Touch ID methods, alongside
controls to open Duo, start the selected method, cancel and confirm. The backend
is the authority for every state and action.

`src/relay-options.js` preserves selection, keyboard focus, pending actions and
explicit unavailable or unknown states. Unknown attempts tell the operator to
review Duo devices without repeating enrollment. Capture alone never means that
Duo accepted the device.

The interface uses the existing system font, green accent, light and dark themes,
two-column layout and local icons. `src/styles.css` owns its tokens and states;
`src/icons/autopilot.svg` is the logo. Icon licenses ship in the third-party
notices. Dashboard components keep their existing appearance.
