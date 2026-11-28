/** The design system's own dialog at each size, plain and banded: what `dialogs-share-shape` holds every dialog to.
 * Never part of the catalogue. */
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, type DsDialogSize } from "../../../../../../src/dashboard/ds/ui.js";
import { defineSurface, DIALOG_REFERENCE_SURFACE, DIALOG_REFERENCE_VARIANTS, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const SIZES = { sm: "sm", md: "md", lg: "lg" } as const satisfies Record<DsDialogSize, DsDialogSize>;

function reference(variant: string): Story {
  const size = Object.values(SIZES).find(candidate => variant === candidate || variant === `${candidate}-band`);
  if (size === undefined) throw new Error(`No design-system dialog size matches the reference "${variant}".`);
  return {
    title: `The design system's ${variant} dialog`,
    ready: '[role="dialog"]',
    render: () => <StoryFrame><Dialog open><DialogContent title="Title" description="Description" size={size} band={variant.endsWith("-band")}>
      <DialogBody><p>Body</p></DialogBody>
      <DialogFooter><Button>Close</Button></DialogFooter>
    </DialogContent></Dialog></StoryFrame>,
  };
}

export const DIALOG_REFERENCE_ENTRIES = defineSurface(DIALOG_REFERENCE_SURFACE, {
  dialog: Object.fromEntries(DIALOG_REFERENCE_VARIANTS.map(variant => [variant, reference(variant)])),
});
