# Interface direction

Mode: Operate. Refine the existing native settings vocabulary into an account-first
extension. Keep the system font, restrained green, light and dark themes, and plain
language. The primary path is account → Duo tab → capture → confirmation.

A compact header and top navigation lead to the account list on the left and a
contextual setup panel on the right. Existing account details collapse so the
actual enrollment steps are visible immediately. At 768px and below, the panel
moves below the account list. The toolbar popup provides status, pause and settings.

Tokens: background #f7f8fa, surface #ffffff, text #192b35, secondary #586771,
accent #176851, borders #dce3e7. Dark equivalents live in styles.css under
prefers-color-scheme. Use a 15px system font base, 30px page headings, 17px section
headings, and smaller supporting labels. Spacing follows 4px increments. Group
containers use 16px corners, status panels 12px, controls 8px, and avatars circles.
Functional icons are local Lucide SVGs, with their license included.

Account status distinguishes connected, paused, missing setup, and pending Duo
confirmation. A generated key is not claimed to be registered until the user
confirms Duo's success or Duo requests its exact credential ID. No decorative
motion, remote fonts, analytics, or external runtime libraries.

## Logo source and exports

`src/icons/autopilot.svg` is the single logo source: a forest-green rounded square
with a white vector `d.` mark. The options header and popup use the SVG directly,
without theme filters or CSS backgrounds. Chrome icons are RGBA PNG exports at
exactly 16, 32, 48 and 128 pixels. Outside the rounded silhouette is transparent;
there is no padded rectangle around it.

To regenerate, serve only the public source directory in one terminal:

```
python3 -m http.server 8769 --bind 127.0.0.1 --directory src
```

From the project root, use another terminal:

```
playwright-cli -s=duo-icons open http://127.0.0.1:8769/icons/autopilot.svg
playwright-cli -s=duo-icons run-code --filename=scripts/render-icons.js
playwright-cli -s=duo-icons close
npm run package
```

Stop the temporary HTTP server afterward. Render on a transparent HTML document;
screenshotting a logo within the app bakes the app background into its corners.
