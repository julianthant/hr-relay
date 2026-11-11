/** The design's mock frames are reachable only from the parity harness, which sets this flag before the app renders. */
export const MOCK_SURFACES_FLAG = "relayMockSurfaces";

/** A mock URL switch; always null outside the parity harness, so a served dashboard never reads one. */
export function mockParam(name: string): string | null {
  if (typeof window === "undefined" || Reflect.get(window, MOCK_SURFACES_FLAG) !== true) return null;
  return new URLSearchParams(window.location.search).get(name);
}
