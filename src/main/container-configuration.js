/** Bounded container configuration projections. These observations do not establish isolation. */
'use strict';
const { hasControl } = require('./container-metadata');

const MAX_CONFIGURATION_CANDIDATES = 8;
const CONFIGURATION_TIMEOUT_MS = 3000;
const CONFIGURATION_OUTPUT_BYTES = 4096;
// https://docs.docker.com/reference/cli/docker/container/inspect/
const CONFIGURATION_FORMAT =
  '{"ID":{{json .Id}},"Running":{{json .State.Running}},"Privileged":{{json .HostConfig.Privileged}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"NetworkMode":{{json .HostConfig.NetworkMode}},"PidMode":{{json .HostConfig.PidMode}}}';
// https://docs.podman.io/en/latest/markdown/podman-container-inspect.1.html
const PODMAN_CONFIGURATION_FORMAT = CONFIGURATION_FORMAT.replace('.Id', '.ID');
const KEYS = ['ID', 'Running', 'Privileged', 'ReadonlyRootfs', 'NetworkMode', 'PidMode'];

/** Validate an exact projection and discard custom namespace names and container references.
 * @param {unknown} output Projected CLI stdout.
 * @param {string} id Exact candidate container ID.
 * @param {number} observedAt Successful observation time.
 * @returns {object|null} Sanitized configuration or null for unread output.
 * @since 0.19.2-beta
 */
function parseConfiguration(output, id, observedAt) {
  if (
    !/^[a-f0-9]{64}$/.test(id) ||
    typeof output !== 'string' ||
    Buffer.byteLength(output) > CONFIGURATION_OUTPUT_BYTES ||
    !Number.isFinite(observedAt)
  )
    return null;
  let row;
  try {
    row = JSON.parse(output);
  } catch {
    return null;
  }
  if (
    !row ||
    Array.isArray(row) ||
    Object.keys(row).length !== KEYS.length ||
    !Object.keys(row).every((key) => KEYS.includes(key)) ||
    row.ID !== id ||
    !['Running', 'Privileged', 'ReadonlyRootfs'].every((key) => typeof row[key] === 'boolean') ||
    !['NetworkMode', 'PidMode'].every(
      (key) =>
        typeof row[key] === 'string' &&
        row[key].length <= 256 &&
        !hasControl(row[key]) &&
        !/\s/.test(row[key]),
    )
  )
    return null;
  return {
    status: 'observed',
    observedAt,
    running: row.Running,
    privileged: row.Privileged,
    readOnlyRootFilesystem: row.ReadonlyRootfs,
    networkMode: ['bridge', 'host', 'none'].includes(row.NetworkMode) ? row.NetworkMode : 'other',
    pidMode:
      row.PidMode === 'host'
        ? 'host'
        : ['', 'private'].includes(row.PidMode)
          ? 'private'
          : /^container:[a-f0-9]{64}$/.test(row.PidMode)
            ? 'container'
            : 'other',
  };
}

module.exports = {
  MAX_CONFIGURATION_CANDIDATES,
  CONFIGURATION_TIMEOUT_MS,
  CONFIGURATION_OUTPUT_BYTES,
  CONFIGURATION_FORMAT,
  PODMAN_CONFIGURATION_FORMAT,
  parseConfiguration,
};
