/**
 * The Relay app logo, Baton: two bars in adjacent lanes tilted 30°, the front bar ahead of the back one, the moment one runner
 * hands on to the next. Plain SVG strings on a 24 grid, so the sign-up and login title and the favicon and app icon sources share one source.
 * At 24 px and below the bars thicken so the 16 px favicon still shows both.
 */
/** App icon plate: the light-theme accent, fixed in both themes like any app icon. */
export const APP_ICON_PLATE = "#245d9e";

const svg = (size: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;

function glyph(color: string, small: boolean): string {
  const bar = (from: number, to: number, y: number, opacity?: number) => `<path d="M${from} ${y}H${to}" stroke="${color}" stroke-width="${small ? 5 : 4.6}" stroke-linecap="round"${opacity === undefined ? "" : ` stroke-opacity="${opacity}"`}/>`;
  return `<g transform="rotate(-30 12 12)">${bar(3.25, 13.75, 15, 0.5)}${bar(10.25, 20.75, 9)}</g>`;
}

/** The symbol; `currentColor` unless a colour is given. */
export function appSymbolSvg(size: number, color = "currentColor"): string {
  return svg(size, glyph(color, size <= 24));
}

/**
 * The app icon: the symbol in white on the accent plate. `macos` keeps Apple's 1024 grid (plate inset 100, corner 22.37%);
 * otherwise the plate fills the square, for the favicon and the Windows .ico sizes. At 24 px and below the glyph grows to 84%
 * of the plate.
 */
export function appIconSvg(size: number, macos = false): string {
  const small = size <= 24, inset = macos ? 2.34 : 0, plate = 24 - inset * 2, scale = plate * (small ? 0.84 : 0.62) / 24, offset = 12 - 12 * scale;
  return svg(size, `<rect x="${inset}" y="${inset}" width="${plate}" height="${plate}" rx="${plate * 0.2237}" fill="${APP_ICON_PLATE}"/>`
    + `<g transform="translate(${offset} ${offset}) scale(${scale})">${glyph("#ffffff", small)}</g>`);
}
