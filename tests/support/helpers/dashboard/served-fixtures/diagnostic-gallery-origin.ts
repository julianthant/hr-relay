/** Gallery-only network binding: raw browser URLs stay stable; served bytes stay real. */
export function diagnosticGalleryOrigin(fixtureServerBaseUrl: string): Readonly<{
  baseUrl: string;
  forwardUrl: (requestUrl: string) => string;
}> {
  const target = new URL(fixtureServerBaseUrl);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.port === ""
    || target.port === "0" || target.origin !== fixtureServerBaseUrl) {
    throw new Error("diagnostic gallery requires the exact ephemeral HTTP loopback fixture-server origin");
  }
  const baseUrl = "http://dca2-gallery.localhost";
  return {
    baseUrl,
    forwardUrl(requestUrl) {
      const request = new URL(requestUrl);
      if (request.origin !== baseUrl || request.username !== "" || request.password !== "" || request.hash !== "") {
        throw new Error("diagnostic gallery can forward only its own credential-free, fragment-free request URLs");
      }
      return `${target.origin}${request.pathname}${request.search}`;
    },
  };
}
