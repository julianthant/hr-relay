---
name: HR Rebuild Roadmap
description: Desktop operations map for reading phase order, workstreams, dependencies, and evidence.
colors:
  map-paper: "#f3f6f8"
  raised-paper: "#ffffff"
  primary-ink: "#13202b"
  secondary-ink: "#3b4b59"
  action-cobalt: "#2457d6"
  complete-green: "#0b8f67"
  active-blue: "#1293cf"
  operator-amber: "#d97706"
typography:
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  interface:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.06em"
rounded:
  control: "6px"
  node: "8px"
spacing:
  tight: "8px"
  control: "12px"
  section: "18px"
  inspector: "20px"
components:
  control:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.control}"
    height: "34px"
  roadmap-node:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.node}"
    width: "252px"
    height: "96px"
---

# Design system: HR Rebuild Roadmap

## Overview

**Creative North Star: "The operations map"**

The roadmap is a desktop planning instrument for one operator. It presents sequence first, dependency
second, and detailed evidence on demand. It avoids both a decorative network graph and a miniature
dashboard inside every node.

The generated site preserves the plan's hierarchy and anchors. The source is
`scripts/generate-roadmap.ts`; `docs/roadmap/index.html` is never edited directly.

## Colors

Neutral paper and ink carry the map. Cobalt is reserved for actions, focus, selection, and open
dependency lines. Green means complete, blue means active, and amber means the operator must act.
Status always has a text or shape cue, so color is never the only signal. The OS preference selects a
separately composed light or dark token map.

## Typography

One system-sans family carries titles, controls, and prose. System mono is reserved for dates, decision
IDs, counts, layer codes, and status labels. Node titles use 13.5px semibold type; inspector prose uses
13px to 13.5px with a readable measure. The interface does not depend on a remote font request.

## Layout

The desktop shell is a fixed master-detail composition: command bar and plan facts above, scrollable map
at left, 420px inspector rail at right. The inspector never floats over or obscures nodes. Numbered
phases run vertically, phase parts run horizontally, and tasks stack below their part.

Blank map space leaves the selected node and returns the inspector to the guide. `Esc` does the same;
a second `Esc` collapses the inspector. Dragging blank space pans without triggering that exit.

Visible task names use deterministic hierarchy paths. A phase part is `3.1`; its tasks are `3.1.1`,
`3.1.2`, and so on. Deeper evidence cards continue the path (`3.3.4.1`). Phase 4 retains its admitted
lettered migration labels. This display convention does not replace the plan's stable source headings
or anchor IDs.

## Elevation & Depth

The map, cards, and inspector are separated by surface color and one-pixel rules. No shadow is used on
content that does not float. Selection uses a stronger cobalt stroke instead of a glow.

## Shapes

Controls use 6px corners and nodes use 8px corners. Status markers are circular because they represent a
state.

## Components

Every node prints its status in words beside the marker. Task cards summarize output progress as a
plain built/total count; the inspector carries the full output list and its engineering-layer labels.
Phase cards keep their longer roll-up chip in the inspector so it cannot collide with the status row.
Card metadata is shortened with an ellipsis before it can cross the node edge. The thin bottom rule
reports documentation-checklist progress and stays visually secondary.

Nodes whose plan status is `never` remain durable plan history but do not appear as cards. The map is an
execution view, so retired, explicitly unplanned, and won't-build-unless-asked records do not consume
space in its hierarchy.

Task-path labels use system mono and cobalt. They sit in the upper-left corner of each non-phase card,
opposite its written status, so the title can stay semantic instead of carrying an inconsistent local
prefix.

The guide is the canonical key for all visible symbols. The toolbar groups dependency and zoom controls
by task, and every control has visible hover, active, and keyboard-focus states.

## Do's and Don'ts

- Do preserve roadmap IDs, content, hierarchy, and deep links.
- Do regenerate with `npm run roadmap` and prove freshness with `npm run roadmap:check`.
- Do keep status and output progress as separate textual readings.
- Do not put node detail in a modal or floating card over the map.
- Do not dim unrelated nodes when inspecting one dependency chain.
- Do not add decorative color, glow, or motion to the planning surface.
