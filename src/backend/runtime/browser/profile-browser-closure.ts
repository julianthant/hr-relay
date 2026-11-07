import { createProfileBrowserClosure } from "../../storage/browser-roots.js";
import { createNativeBrowserProbe } from "./native-browser.js";

export const profileBrowserClosure = createProfileBrowserClosure(createNativeBrowserProbe);
