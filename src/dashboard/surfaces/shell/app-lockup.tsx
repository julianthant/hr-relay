import { appSymbolSvg } from "./app-logo.js";

export function AppLockup() {
  return <><span className="flex text-ui-info" dangerouslySetInnerHTML={{ __html: appSymbolSvg(24) }} />Relay</>;
}
