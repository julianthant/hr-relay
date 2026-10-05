import type { SuccessfulRunTiming } from './activity-view-model.js';

export function manualMinutes(value: string): number | null {
  if (!value.trim()) return null;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function successfulRunMinutes(timing: SuccessfulRunTiming): number | null {
  if (!Number.isInteger(timing.measured) || timing.measured <= 0 || !Number.isInteger(timing.unmeasured) || timing.unmeasured < 0
    || timing.totalSeconds === null || !Number.isFinite(timing.totalSeconds) || timing.totalSeconds < 0) return null;
  return timing.totalSeconds / timing.measured / 60;
}

export function estimatedSavedMinutes(manual: string, timing: SuccessfulRunTiming): number | null {
  const baseline = manualMinutes(manual);
  if (baseline === null || successfulRunMinutes(timing) === null) return null;
  return timing.measured * baseline - timing.totalSeconds! / 60;
}
