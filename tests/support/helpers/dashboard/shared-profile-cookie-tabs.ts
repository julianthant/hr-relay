import assert from "node:assert/strict";

export function sharedProfileCookieTabs(base: string) {
  const cookies = new Map<string, string>();
  const tab = () => {
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(`${base}/api/v1/profile/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { origin: base, cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
          ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0]; assert.ok(pair);
        const separator = pair.indexOf("="); assert.ok(separator > 0);
        const name = pair.slice(0, separator), value = pair.slice(separator + 1);
        if (value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
      return response;
    };
    return { read: () => request("state"), post: (path: string, body: unknown) => request(path, body) };
  };
  return { tabA: tab(), tabB: tab() };
}
