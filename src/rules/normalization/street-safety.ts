/** Read the leading house number for geocoder comparison. */

export function parseHouseNumber(street: string | null | undefined): string | null {
  const match = /^\s*(\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?)(?=\s|$)/u.exec(street ?? "");
  const captured = match?.[1];
  return captured === undefined ? null : captured;
}
