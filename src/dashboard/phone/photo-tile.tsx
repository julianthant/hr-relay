/**
 * One photographed page.
 *
 * The tile is a SHEET: the product's card plane, a hairline, and the photograph
 * inside a frame at the real proportion of US Letter (`--ds-aspect-page`, 612 ×
 * 792pt, measured from the packet the OCR fixtures are built on). A phone
 * photograph of a form arrives in whatever crop the camera gave it, so the
 * frame letterboxes rather than fills — a cover crop would hide the top of the
 * page, which is exactly where the form's identity is printed.
 *
 * THE NUMBER IS THE POINT. Order is meaning here: the schema enforces
 * contiguous ordinals and the bundle is assembled in that order, so page 3
 * becoming page 2 changes what the document says. The ordinal is therefore a
 * large real numeral in its own column, not a badge in a corner — it is the
 * first thing read on the tile and the thing the move controls act on.
 *
 * Reordering is EXPLICIT BUTTONS, never drag. A touch drag inside a page that
 * also scrolls is the classic failure: the list scrolls when the operator meant
 * to drag, the tile drops somewhere they did not intend, and the only signal is
 * the order silently changing. Buttons are also the only version of this a
 * keyboard and a screen reader can reach at all.
 */
import { ChevronDown, ChevronUp, ImageOff, Trash2 } from "lucide-react";
import type { CapturePhotoWire } from "../../domain/capture-surface.js";
import { cn } from "../lib/utils.js";
import { dsRadius } from "../ds/tokens.js";
import { PhoneButton, PhoneIconButton } from "./phone-controls.js";

/** What the tile knows about its own photograph's bytes. */
export type PhotoPreview =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly url: string }
  /** Loud on purpose: a blank frame is indistinguishable from a blank page. */
  | { readonly state: "failed"; readonly message: string };

export function PhotoTile({
  photo,
  position,
  total,
  preview,
  reordering,
  busyControl,
  enter,
  onMove,
  onRemove,
}: {
  photo: CapturePhotoWire;
  /** 1-based, from the session's own ordinals — never the array index. */
  position: number;
  total: number;
  preview: PhotoPreview;
  /** Review shows the move and remove controls; capture is resting. */
  reordering: boolean;
  /** The id of the control currently in flight, so only IT is disabled. */
  busyControl: string | null;
  /** The one authored moment — see `phone.css`. */
  enter: "from" | "to";
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const photoId = String(photo.photoId);
  const removeKey = `remove:${photoId}`;
  const moveKey = `move:${photoId}`;
  const label = `Page ${String(position)} of ${String(total)}`;

  return (
    <li
      data-phone-enter={enter}
      data-phone-photo-id={photoId}
      className={cn(
        "phone-settle flex flex-col gap-[var(--ds-phone-gap)]",
        "border bg-[var(--ds-surface-1)] border-[color:var(--ds-border)]",
        "p-[var(--ds-phone-gap)]",
        dsRadius.lg,
      )}
    >
      <div className="flex items-start gap-[var(--ds-phone-gap)]">
        <span
          aria-hidden
          className="phone-numeral w-[2ch] shrink-0 text-right font-semibold text-[color:var(--ds-fg)]"
        >
          {position}
        </span>

        <div
          className={cn(
            // 112px, not 88: the thumbnail is what answers the only question
            // this tile exists for — did that page photograph legibly — and
            // the space it takes was otherwise blank to the right of a
            // four-word label.
            "w-[112px] shrink-0 overflow-hidden border",
            "aspect-[var(--ds-aspect-page)] bg-[var(--ds-recess-bg)] border-[color:var(--ds-recess-border)]",
            dsRadius.sm,
          )}
        >
          {preview.state === "ready" && (
            <img
              src={preview.url}
              alt={`${label}, as photographed`}
              className="size-full object-contain"
            />
          )}
          {preview.state === "failed" && (
            <span className="flex size-full flex-col items-center justify-center gap-[var(--ds-space-tight)] p-[var(--ds-space-tight)] text-center text-[color:var(--ds-danger)]">
              <ImageOff aria-hidden className="size-5" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
          {/* The numeral above is aria-hidden; this is the tile's real name.
              There is deliberately no byte count beside it: the operator is
              checking that a page arrived and is legible, which the thumbnail
              answers and "285 B" does not. A number nobody can act on is
              console habit leaking onto a surface with six words of room. */}
          <span className="phone-text-lead font-semibold text-[color:var(--ds-fg)]">{label}</span>
          {preview.state === "failed" && (
            <span role="alert" className="phone-text text-[color:var(--ds-danger)]">
              {preview.message}
            </span>
          )}
        </div>
      </div>

      {reordering && (
        <div className="flex items-center gap-[var(--ds-phone-gap)]">
          <PhoneIconButton
            label={`Move ${label} earlier`}
            icon={<ChevronUp aria-hidden className="size-6" />}
            disabled={position === 1 || busyControl === moveKey}
            onClick={() => onMove("up")}
          />
          <PhoneIconButton
            label={`Move ${label} later`}
            icon={<ChevronDown aria-hidden className="size-6" />}
            disabled={position === total || busyControl === moveKey}
            onClick={() => onMove("down")}
          />
          {/* QUIET, not danger. Three red buttons down a three-page list is
              the loudest thing on the screen — louder than Send — which
              inverts the attention ladder the token file is explicit about.
              Removing a page here costs one more photograph; the red is
              reserved for Discard, which throws the whole bundle away. */}
          <PhoneButton
            tone="quiet"
            className="ml-auto"
            icon={<Trash2 aria-hidden className="size-5" />}
            busy={busyControl === removeKey}
            onClick={onRemove}
          >
            Remove
          </PhoneButton>
        </div>
      )}
    </li>
  );
}
