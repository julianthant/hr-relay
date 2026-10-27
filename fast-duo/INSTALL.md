# Install Duo Autopilot

These steps are for Chrome 140+. Safari users need the Safari app package and
its included INSTALL.md. Both browsers use the same personal enrollment flow.

Licensed under the MIT License. See LICENSE and THIRD_PARTY_NOTICES.md.
Use only your own Duo account on your own machine.

1. Unzip `duo-autopilot-share.zip` into a permanent folder.
2. Open `chrome://extensions`, enable Developer mode, and choose Load unpacked.
3. Select the folder containing `manifest.json`. Keep the folder in place.
4. The setup page opens. Add your exact Duo username and, optionally, your organization's sign-in link.
5. Sign in normally. At Duo, open Other options → Manage devices and authenticate with an existing method.
6. In Autopilot, select your account, refresh the Duo tab list, select that tab and the device type, then click Start capture.
7. In that Duo tab, choose Add a device and the selected type. Autopilot creates your key locally when Duo starts registration. Capture expires after ten minutes.
8. Finish in Duo. Once Duo confirms the device was added, confirm in Autopilot. A test login that requests the captured key also activates it automatically.

Repeat for each separate key set. To reuse one account’s keys under another Duo username, open Manage → Alternate usernames, enter the names separated by commas, and save. Aliases share keys and counters; Duo must already accept the key for those usernames. Your organization must allow the chosen device type and self-service device management. Duo may supply an email address as its registration username; use that exact name in Autopilot. The enrollment cannot skip your organization's existing authentication requirements.

Use the toolbar icon to pause or open settings. Keys stay in local extension storage. There is no cloud synchronization, analytics, or automatic backup. Removing the extension removes its browser storage; keep another Duo method available.

This package contains no pre-enrolled credentials. Enroll only your own account. Never share a personal installation folder containing `credentials/`. An unlocked browser profile can use all of its connected accounts.

Matching uses Duo's credential IDs and exact visible username fields. Unknown or ambiguous requests fall through to normal browser authentication. Username detection depends on the Duo page exposing a supported field; it does not read SSO pages on other domains.

This is an independent personal extension, not a Cisco Duo product. Chrome Web Store publication is separate and has not occurred. A store listing would provide standard one-click installation and updates after approval.

References:
- https://guide.duo.com/universal-enrollment
- https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
- https://developer.chrome.com/docs/extensions/how-to/distribute
