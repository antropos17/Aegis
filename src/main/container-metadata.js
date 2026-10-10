/** Strict projected container metadata; image matches are candidates only. */
'use strict';

const MAX_OUTPUT_BYTES = 524288;
const MAX_ROWS = 1024;
// Exact runnable repositories, shared by Docker and Podman:
// https://github.com/agent0ai/agent-zero/blob/main/docs/setup/installation.md
// https://docs.openclaw.ai/install/docker
// https://github.com/OpenHands/OpenHands/blob/main/README.md
const IMAGES = new Map([
  ['docker.io/agent0ai/agent-zero', 'Agent Zero'],
  ['ghcr.io/openclaw/openclaw', 'OpenClaw'],
  ['docker.io/openclaw/openclaw', 'OpenClaw'],
  ['ghcr.io/openhands/agent-canvas', 'OpenHands'],
]);
const PODMAN_STATES = new Set([
  'created',
  'initialized',
  'running',
  'stopped',
  'paused',
  'exited',
  'removing',
  'stopping',
  'unknown',
]);

/** Resolve an exact repository without matching lookalikes or registry ports.
 * @param {string} image Reported image reference.
 * @returns {string} Canonical registry/repository or empty for invalid input.
 */
function repository(image) {
  const parts = image.split('@');
  if (parts.length > 2 || (parts.length === 2 && !/^sha256:[a-f0-9]{64}$/.test(parts[1])))
    return '';
  let name = parts[0];
  const colon = name.lastIndexOf(':');
  if (colon > name.lastIndexOf('/')) {
    if (!/^[\w][\w.-]{0,127}$/.test(name.slice(colon + 1))) return '';
    name = name.slice(0, colon);
  }
  if (!/^[a-z0-9][a-z0-9._:/-]*$/.test(name)) return '';
  const first = name.split('/')[0];
  if (first === 'index.docker.io') return name.replace(/^index\.docker\.io\//, 'docker.io/');
  const explicitRegistry = name.includes('/') && (/[.:]/.test(first) || first === 'localhost');
  return explicitRegistry ? name : `docker.io/${name}`;
}

/** Detect ASCII controls.
 * @param {string} value Metadata field.
 * @returns {boolean} Whether an ASCII control occurs.
 * @since 0.19.2-beta
 */
function hasControl(value) {
  return [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

/** Retain Docker's first non-link name and discard aliases.
 * https://github.com/docker/cli/blob/master/cli/command/formatter/container.go
 * @param {unknown} value Projected Names field.
 * @returns {string|null} Canonical name or null for malformed output.
 */
function dockerName(value) {
  if (typeof value !== 'string' || value.length > 8192 || hasControl(value)) return null;
  const names = value.split(',');
  if (
    names.length > 32 ||
    names.some((name) => {
      const parts = name.split('/');
      return (
        parts.length > 2 || parts.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(part))
      );
    })
  )
    return null;
  return names.find((name) => !name.includes('/')) ?? null;
}

/** Validate an entire projected page before accepting any candidate.
 * @param {unknown} output CLI stdout, containing only the fixed projected fields.
 * @param {'docker'|'podman'} runtime Namespace and strict runtime-specific schema.
 * @returns {Array<object>|null} Sorted candidates or null for an unread observation.
 * @since 0.19.2-beta
 */
function parseContainerOutput(output, runtime) {
  if (
    !['docker', 'podman'].includes(runtime) ||
    typeof output !== 'string' ||
    Buffer.byteLength(output) > MAX_OUTPUT_BYTES
  )
    return null;
  const lines = output.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > MAX_ROWS) return null;
  const keys = runtime === 'podman' ? ['ID', 'Image', 'Names', 'State'] : ['ID', 'Image', 'Names'];
  const seen = new Set();
  const candidates = [];
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      return null;
    }
    const name =
      runtime === 'docker'
        ? dockerName(row?.Names)
        : typeof row?.Names === 'string' &&
            !hasControl(row.Names) &&
            /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(row.Names)
          ? row.Names
          : null;
    if (
      !row ||
      Array.isArray(row) ||
      Object.keys(row).length !== keys.length ||
      !Object.keys(row).every((key) => keys.includes(key)) ||
      typeof row.ID !== 'string' ||
      row.ID.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(row.ID) ||
      seen.has(row.ID) ||
      name === null ||
      typeof row.Image !== 'string' ||
      !row.Image ||
      row.Image.length > 512 ||
      /\s/.test(row.Image) ||
      hasControl(row.Image) ||
      (runtime === 'podman' && !PODMAN_STATES.has(row.State))
    )
      return null;
    seen.add(row.ID);
    if (runtime === 'podman' && row.State !== 'running') continue;
    const agent = IMAGES.get(repository(row.Image));
    if (agent)
      candidates.push({
        id: `${runtime}:${row.ID}`,
        containerId: row.ID,
        name,
        image: row.Image,
        agent,
        match: 'image',
        runtime,
      });
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { MAX_OUTPUT_BYTES, hasControl, parseContainerOutput };
