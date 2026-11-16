/** Keeps the start and the end of a long path. */
export const middle = (path: string, head = 14, tail = 12) => path.length <= head + tail + 1 ? path : `${path.slice(0, head)}…${path.slice(-tail)}`;
