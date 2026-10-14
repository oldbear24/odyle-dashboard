// Background jobs. The cronAdd calls of main.pb.js run through here, so the superuser
// dashboard's Odyle → Background jobs page shows when each job last ran, how long it
// took, what it did and its last failure. Like packets this lives in server memory
// only: a restart clears it. Superusers can also start the routine jobs by hand; the
// account clean-up only runs on its schedule.
//
// Each job answers { done, failed, error } or { skipped: 'paused' | 'off' }.
const settings = require(__hooks + '/lib/settings.cjs');
const accounts = () => require(__hooks + '/lib/accounts.cjs');
const prefix = 'odyle.job.', lockPrefix = 'odyle.jobRunning.';
const jobs = {
  'odyle-expiry': { manual: true, work: () => accounts().cleanup() },
  'odyle-portraits': { manual: true, pause: 'portraitsPaused', work: () => accounts().refreshPortraits() },
  'odyle-reminders': { manual: true, pause: 'remindersPaused', work: () => accounts().remindRuns() },
  'odyle-retention': { manual: false, work: () => accounts().retention() },
};
function remember(store, name, result, ms, manual) {
  store.setFunc(prefix + name, raw => {
    const last = raw ? JSON.parse(raw) : { runs: 0, failedRuns: 0, totalDone: 0 }, at = new Date().toISOString(), failed = (result.failed || 0) > 0;
    const next = { ...last, lastRunAt: at, ms, byHand: manual, done: result.done || 0, failed: result.failed || 0, error: result.error || '', skipped: result.skipped || '', runs: last.runs + 1, failedRuns: last.failedRuns + (failed ? 1 : 0), totalDone: last.totalDone + (result.done || 0) };
    // The last failure stays listed after later runs succeed.
    if (failed) { next.lastFailureAt = at; next.lastError = next.error || 'Failed without a message.'; }
    return JSON.stringify(next);
  });
}
// Runs one job and records it. A job still running (a manual start during its cron run,
// or the other way round) is not started twice; a lock older than ten minutes is ignored.
function run(app, name, manual = false) {
  const job = jobs[name], store = app.store(), lock = lockPrefix + name; let mine = false;
  store.setFunc(lock, since => { if (since && Date.now() - since < 600000) return since; mine = true; return Date.now(); });
  if (!mine) return { skipped: 'running' };
  const started = Date.now(); let result;
  try { result = job.work() || {}; } catch (error) { result = { failed: 1, error: String(error.message || error) }; console.log('Odyle job ' + name + ' failed: ' + result.error); }
  finally { store.remove(lock); }
  remember(store, name, result, Date.now() - started, manual);
  return result;
}
function list(app) {
  const store = app.store(), current = settings.read(app);
  return Object.keys(jobs).map(name => {
    const job = jobs[name], state = job.pause && current[job.pause] ? 'paused' : name === 'odyle-retention' && !current.inactiveAccountDays ? 'off' : 'active';
    // The job's own fields come last, so a run record can never hide them.
    return { name, ...(store.has(prefix + name) ? JSON.parse(store.get(prefix + name)) : {}), manual: job.manual, state, running: store.has(lockPrefix + name) };
  });
}
module.exports = { jobs, run, list };
