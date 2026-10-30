export const closeFixtures: (() => void | Promise<void>)[] = [];

export async function closeDuoCeremonyFixtures(): Promise<void> {
  const failures: unknown[] = [];
  for (const close of closeFixtures.splice(0).reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Duo fixture cleanup failed");
}
