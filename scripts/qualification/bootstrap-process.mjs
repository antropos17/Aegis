import { spawn } from 'node:child_process';

/**
 * Run only the compiled fixed supervisor, keeping its cancellation input open.
 * Bound every pipe and deadline; killing this owner closes its private Job.
 * @param {string} executable Collector-owned compiled fixture.
 * @param {string} mode Validated fixed case.
 * @param {Buffer} input Ephemeral framed binding, erased after the write.
 * @param {object} options Collector-owned working directory/environment.
 * @returns {Promise<string>} Bounded stdout after a confirmed supervisor exit.
 * @since v0.17.0
 */
export function runBootstrapProcess(executable, mode, input, options) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, ['--fixture', mode], {
        ...options,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      input.fill(0);
      reject(new Error('native-bootstrap-process-unavailable'));
      return;
    }
    let failure = false;
    let ended = false;
    let outputBytes = 0;
    let errorBytes = 0;
    const chunks = [];
    const errors = [];
    let reapTimer;
    const finish = (code) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearTimeout(reapTimer);
      child.stdin.destroy();
      input.fill(0);
      if (failure || code !== 0 || errorBytes !== 0) {
        const diagnostic = Buffer.concat(errors).toString('utf8');
        const safePhase = /^native-bootstrap-unavailable:([a-z0-9-]{1,40})\r?\n$/.exec(
          diagnostic,
        )?.[1];
        reject(
          new Error('native-bootstrap-process-unavailable' + (safePhase ? ':' + safePhase : '')),
        );
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const stop = () => {
      if (ended || failure) return;
      failure = true;
      child.kill();
      // If termination cannot be confirmed, cleanup must fail rather than pass.
      reapTimer = setTimeout(() => finish(null), 3000);
    };
    const timer = setTimeout(stop, 10000);
    child.on('error', stop);
    child.on('close', finish);
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 16384) stop();
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errorBytes += chunk.length;
      if (errorBytes > 1024) stop();
      else errors.push(chunk);
    });
    child.stdin.on('error', stop);
    child.stdin.write(input, (error) => {
      input.fill(0);
      if (error) stop();
    });
  });
}
