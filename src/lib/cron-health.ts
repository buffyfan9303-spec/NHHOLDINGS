import deployment from '../../vercel.json';

const schedule = deployment.crons.find(cron => cron.path === '/api/cron')?.schedule ?? null;
const interval = /^\*\/([1-9]\d?) \* \* \* \*$/.exec(schedule ?? '');
const intervalMinutes = interval ? Number(interval[1]) : null;
// Allow two scheduled intervals and the cron route's three-minute execution limit.
const staleAfter = intervalMinutes === null ? null : (2 * intervalMinutes + 3) * 60_000;
type Execution = {ok?: unknown; finishedAt?: unknown; lastSuccessAt?: unknown};

function readTime(value: unknown, now: number) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now ? new Date(timestamp).toISOString() : null;
}

export function summarizeCronStatus(execution: Execution | null, now = Date.now()) {
  const finishedAt = readTime(execution?.finishedAt, now);
  const lastSuccessAt = readTime(execution?.lastSuccessAt, now) ?? (execution?.ok === true ? finishedAt : null);
  const details = {schedule, intervalMinutes, finishedAt, lastSuccessAt};

  if (schedule === null) return {...details, status: 'unconfigured' as const};
  if (!execution) return {...details, status: 'unobserved' as const};
  if (execution.ok === false) return {...details, status: 'failed' as const};
  if (!finishedAt || execution.ok !== true || staleAfter === null) return {...details, status: 'unknown' as const};
  if (now - Date.parse(finishedAt) > staleAfter) return {...details, status: 'stale' as const};
  return {...details, status: 'healthy' as const};
}
