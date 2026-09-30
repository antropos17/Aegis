/** Track fixture helpers before they can close, including failed-test teardown.
 * @param {{kill?: typeof process.kill, timeoutMs?: number}} [options] Test controls.
 * @returns {{track: Function, stopAndWait: Function}} Owned fixture lifecycle. @since v0.18.0 */
export function createFixtureProcesses({
  kill = process.kill.bind(process),
  timeoutMs = 1500,
} = {}) {
  const children = [];
  const alive = (pid) => {
    try {
      kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  return {
    track(child) {
      const entry = { child, closed: false };
      child.once('close', () => {
        entry.closed = true;
      });
      children.push(entry);
      return child;
    },
    async stopAndWait(pids = []) {
      for (const entry of children) if (!entry.closed) entry.child.kill('SIGKILL');
      for (const pid of pids) {
        if (alive(pid)) {
          try {
            kill(pid, 'SIGKILL');
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
      }
      const deadline = Date.now() + timeoutMs;
      while (children.some((entry) => !entry.closed) || pids.some(alive)) {
        if (Date.now() >= deadline) throw Error('fixture-processes-still-running');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
