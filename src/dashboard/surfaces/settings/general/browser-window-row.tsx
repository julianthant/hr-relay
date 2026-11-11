import { ResultRow, Select } from "../../../ds/ui.js";

const SIZES = { Small: [1280, 800], Medium: [1440, 1000], "Full screen": [1920, 1080] } as const;

export interface BrowserWindowBinding {
  readonly headless: string;
  readonly width: string;
  readonly height: string;
  readonly disabled: boolean;
  readonly error?: string;
  readonly update: (path: "browser.headless" | "display.screenWidth" | "display.screenHeight", value: string) => void;
}

function current(binding: BrowserWindowBinding): string {
  if (binding.headless === "true") return "Hidden";
  const match = (Object.keys(SIZES) as (keyof typeof SIZES)[]).find(name => String(SIZES[name][0]) === binding.width && String(SIZES[name][1]) === binding.height);
  return match ?? `${binding.width} × ${binding.height}`;
}

/** One Browser window choice over the served headless flag and window size. */
export function BrowserWindowRow({ binding }: { binding: BrowserWindowBinding }) {
  const value = current(binding);
  const custom = value !== "Hidden" && !(value in SIZES);
  const choose = (next: string): void => {
    if (next === "Hidden") { binding.update("browser.headless", "true"); return; }
    if (!(next in SIZES)) return;
    const [width, height] = SIZES[next as keyof typeof SIZES];
    binding.update("browser.headless", "false");
    binding.update("display.screenWidth", String(width));
    binding.update("display.screenHeight", String(height));
  };
  return <div className="settings-compact-row" data-settings-path="browser.headless">
    <ResultRow label="Browser window" description="Size of the browser Relay opens for workflows. Hidden keeps it out of sight."
      value={<Select aria-label="Browser window" value={value} disabled={binding.disabled} onChange={event => choose(event.target.value)}>
        <option value="Hidden">Hidden</option>
        {Object.keys(SIZES).map(name => <option key={name} value={name}>{name}</option>)}
        {custom && <option value={value}>{value}</option>}
      </Select>} />
    {binding.error !== undefined && <p role="alert">{binding.error}</p>}
  </div>;
}
