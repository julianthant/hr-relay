export type EffortBaseline = Readonly<{ manual: string; assisted: string }>;

export function estimatedSavedMinutes(completed: number, baseline: EffortBaseline): number | null {
  if (!baseline.manual.trim() || !baseline.assisted.trim()) return null;
  const manual = Number(baseline.manual), assisted = Number(baseline.assisted);
  if (!Number.isFinite(manual) || !Number.isFinite(assisted) || manual < 0 || assisted < 0 || assisted > manual) return null;
  return completed * (manual - assisted);
}
