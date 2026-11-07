export function isDuoOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'duosecurity.com' || url.hostname.endsWith('.duosecurity.com'));
  } catch { return false; }
}
