import { useState } from "react";
import { BodySection, FormGroup, Switch } from "../../../ds/ui.js";

export interface AssistantPermissionValues { readonly defaultPermissions: boolean; readonly fullAccess: boolean }

/** What the assistant may do without asking; the first section of General. */
export function AssistantPermissions({ initial = { defaultPermissions: true, fullAccess: false } }: { initial?: AssistantPermissionValues }) {
  const [permissions, setPermissions] = useState(initial);
  return <BodySection title="Permissions">
    <FormGroup label="Permissions">
      <Switch name="Default permissions" label="Default permissions" description="By default, the assistant can read runs and look people up. It asks before starting runs or saving anything." checked={permissions.defaultPermissions} onCheckedChange={defaultPermissions => setPermissions({ ...permissions, defaultPermissions })} />
      <Switch name="Full access" label="Full access" description="The assistant can start dry runs and answer run questions without asking. Live runs and saves always ask." checked={permissions.fullAccess} onCheckedChange={fullAccess => setPermissions({ ...permissions, fullAccess })} />
    </FormGroup>
  </BodySection>;
}
