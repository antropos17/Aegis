import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { classifyRun } from './verification-contract.mjs';

const { values } = parseArgs({
  options: { pr: { type: 'string' }, repo: { type: 'string', default: 'antropos17/Aegis' } },
});
if (!/^[1-9]\d*$/.test(values.pr ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
  throw new Error(
    'Usage: node tools/development/pr-readiness.mjs --pr <number> [--repo owner/name]',
  );
const api = (route) =>
  JSON.parse(
    execFileSync('gh', ['api', `repos/${values.repo}/${route}`], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }),
  );
const pr = api(`pulls/${values.pr}`);
const runs = api(
  `actions/workflows/ci.yml/runs?event=pull_request&head_sha=${encodeURIComponent(pr.head.sha)}&per_page=100`,
);
const eligible = runs.workflow_runs.filter(
  (run) =>
    run.head_sha === pr.head.sha &&
    run.pull_requests?.some((linked) => linked.number === pr.number),
);
eligible.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
const run = eligible[0] ?? null;
const current = api(`pulls/${values.pr}`);
const state = current.head.sha !== pr.head.sha ? 'head-changed-during-read' : classifyRun(run);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      pr: pr.html_url,
      prState: current.state,
      head: pr.head.sha,
      currentHead: current.head.sha,
      state,
      run: run
        ? {
            id: run.id,
            url: run.html_url,
            head: run.head_sha,
            status: run.status,
            conclusion: run.conclusion,
            attempt: run.run_attempt,
            actor: run.actor?.login,
            triggeringActor: run.triggering_actor?.login,
          }
        : null,
      next:
        state === 'approval-required'
          ? 'Review the current diff, then approve this workflow run in the PR UI with write access.'
          : state === 'missing-head-run'
            ? 'Inspect event filters and PR/run association; absence is not success.'
            : state === 'head-changed-during-read'
              ? 'Read the new head before making a readiness decision.'
              : 'Inspect the current run and required check contexts.',
      mergeAuthorized: false,
      releaseQualified: false,
      limitation:
        'Read-only diagnosis of the latest associated CI run among up to 100 results; not a required-check or release gate.',
    },
    null,
    2,
  ),
);
