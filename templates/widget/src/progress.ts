// How much of today (or of the working hours) has passed. Nothing to do with drawing, so it's a module of its own.

export interface DayProgress {
  /** 0 to 1 */
  fraction: number;
  /** Minutes left */
  remaining: number;
}

/** @param workday only 9:00–18:00 counts */
export function dayProgress(now: Date, workday: boolean): DayProgress {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = workday ? 9 * 60 : 0;
  const end = workday ? 18 * 60 : 24 * 60;
  const clamped = Math.min(Math.max(minutes, start), end);
  return { fraction: (clamped - start) / (end - start), remaining: end - clamped };
}

export function formatRemaining(minutes: number, chinese: boolean): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (chinese) {
    return hours > 0 ? `还剩 ${hours} 小时 ${rest} 分` : `还剩 ${rest} 分`;
  }
  return hours > 0 ? `${hours} hr ${rest} min left` : `${rest} min left`;
}
