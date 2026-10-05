/** Per-attachment state; the bundle gallery never shares a failure slot between images. */
import type { DiagnosticBundleWire } from "../../../../domain/dashboard/diagnostic-bundle.js";
import { useEffect, useReducer, useRef } from "react";
import { diagnosticScreenshotBrowserLoadFailure, diagnosticScreenshotLoadFailure, type DiagnosticScreenshotLoadFailure } from "./trust-model.js";

export type DiagnosticScreenshot = DiagnosticBundleWire["contents"][number] & Readonly<{
  kind: "screenshot"; width: number; height: number; mediaType: "image/png" | "image/jpeg";
}>;

export function screenshotResourceKey(bundle: DiagnosticBundleWire, screenshot: DiagnosticScreenshot): string {
  return JSON.stringify([
    bundle.bundleId, bundle.contentDigest, screenshot.artifactId, screenshot.digest,
    screenshot.mediaType, screenshot.byteLength, screenshot.width, screenshot.height, screenshot.sensitivity,
  ]);
}

export function diagnosticScreenshots(bundle: DiagnosticBundleWire): readonly DiagnosticScreenshot[] {
  const ids = new Set<string>();
  return bundle.contents.filter((content) => content.kind === "screenshot").map((content) => {
    const { width, height, mediaType } = content;
    if (width === undefined || height === undefined || !Number.isInteger(width) || !Number.isInteger(height)
      || width <= 0 || height <= 0 || (mediaType !== "image/png" && mediaType !== "image/jpeg")) {
      throw new Error(`Diagnostic screenshot ${content.artifactId} requires positive captured width/height and PNG or JPEG mediaType`);
    }
    if (ids.has(content.artifactId)) throw new Error(`Diagnostic bundle ${bundle.bundleId} has duplicate screenshot ${content.artifactId}`);
    ids.add(content.artifactId);
    return { ...content, kind: "screenshot", width, height, mediaType };
  });
}

export type ScreenshotState = Readonly<{
  thumbnail: "deferred" | "loading" | "ready";
  lightbox: "closed" | "loading" | "ready";
  authority:
    | Readonly<{ state: "verified" }>
    | Readonly<{ state: "rechecking"; request: number }>
    | Readonly<{ state: "unavailable"; failure: DiagnosticScreenshotLoadFailure }>;
  revision: number;
}>;
type ScreenshotEvent =
  | Readonly<{ type: "admit" | "open" | "close" | "failed" }>
  | Readonly<{ type: "loaded"; view: "thumbnail" | "lightbox" }>
  | Readonly<{ type: "rechecked"; request: number; failure: DiagnosticScreenshotLoadFailure }>;

export function screenshotFilename(mediaType: "image/png" | "image/jpeg", index: number): string {
  return `diagnostic-screenshot-${String(index + 1)}.${mediaType === "image/png" ? "png" : "jpg"}`;
}

export function screenshotDownloadAllowed(state: ScreenshotState): boolean {
  switch (state.authority.state) {
    case "verified": return state.lightbox === "ready";
    case "rechecking": return false;
    case "unavailable": return state.authority.failure.kind === "browser";
  }
}

export function initialScreenshotState(): ScreenshotState {
  return { thumbnail: "deferred", lightbox: "closed", authority: { state: "verified" }, revision: 0 };
}
export function reduceScreenshot(state: ScreenshotState, event: ScreenshotEvent): ScreenshotState {
  switch (event.type) {
    case "admit": return state.thumbnail === "deferred" ? { ...state, thumbnail: "loading" } : state;
    case "open": return { ...state, lightbox: "loading" };
    // The thumbnail owns authority. Closing its child view must not cancel its recheck.
    case "close": return { ...state, lightbox: "closed" };
    case "loaded": return state.authority.state === "verified" && state[event.view] === "loading"
      ? { ...state, [event.view]: "ready" } : state;
    case "failed": return state.authority.state === "verified"
      ? { ...state, revision: state.revision + 1, authority: { state: "rechecking", request: state.revision + 1 } } : state;
    case "rechecked": return state.authority.state === "rechecking" && state.authority.request === event.request
      ? { ...state, authority: { state: "unavailable", failure: event.failure } } : state;
  }
}

export function watchScreenshotRecheck(
  bundle: DiagnosticBundleWire,
  screenshot: DiagnosticBundleWire["contents"][number],
  readBundle: (bundleId: string, signal?: AbortSignal) => Promise<DiagnosticBundleWire>,
  publish: (failure: DiagnosticScreenshotLoadFailure) => void,
): Readonly<{ cancel: () => void; settled: Promise<void> }> {
  let active = true;
  const controller = new AbortController();
  const settled = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return readBundle(bundle.bundleId, controller.signal);
  }).then(
    (reread) => { if (active) publish(diagnosticScreenshotBrowserLoadFailure(bundle, screenshot, reread)); },
    (error: unknown) => { if (active) publish(diagnosticScreenshotLoadFailure(error)); },
  );
  return { cancel: () => { active = false; controller.abort(); }, settled };
}

/** Key the component by screenshotResourceKey: a new identity receives a fresh lifetime. */
export function useDiagnosticScreenshot(
  bundle: DiagnosticBundleWire,
  screenshot: DiagnosticScreenshot,
  readBundle: (bundleId: string, signal?: AbortSignal) => Promise<DiagnosticBundleWire>,
) {
  const [state, dispatch] = useReducer(reduceScreenshot, undefined, initialScreenshotState);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = triggerRef.current;
    if (trigger === null) return;
    // No preload margin: admission means intersection with the clipped dialog viewport.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        dispatch({ type: "admit" });
        observer.disconnect();
      }
    }, { rootMargin: "0px", threshold: 0 });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, []);
  const authority = state.authority;
  useEffect(() => {
    if (authority.state !== "rechecking") return;
    const watch = watchScreenshotRecheck(bundle, screenshot, readBundle, (failure) => {
      dispatch({ type: "rechecked", request: authority.request, failure });
    });
    // Lightbox close does not change authority; parent unmount aborts the fetch and publication.
    return watch.cancel;
  }, [authority, bundle, screenshot, readBundle]);
  return { state, dispatch, triggerRef };
}
