export function isLoopbackHost(value: string | undefined): boolean {
  if (value === undefined) return false;
  const match = /^(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/iu.exec(value);
  if (match === null) return false;
  const port = match[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
}

type LoopbackOriginInspection = Readonly<
  | { state: "allowed" }
  | { state: "malformed" }
  | { state: "forbidden" }
>;

export function inspectLoopbackOrigin(value: string | undefined): LoopbackOriginInspection {
  if (value === undefined) return { state: "allowed" };
  if (!URL.canParse(value)) return { state: "malformed" };
  const origin = new URL(value);
  return (origin.protocol === "http:" || origin.protocol === "https:")
    && (origin.hostname === "127.0.0.1" || origin.hostname === "localhost")
    && origin.username === ""
    && origin.password === ""
    && origin.pathname === "/"
    && origin.search === ""
    && origin.hash === ""
    ? { state: "allowed" }
    : { state: "forbidden" };
}
