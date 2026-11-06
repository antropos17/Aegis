'use strict';

const path = require('node:path');
// Preserve cli.js dispatch precedence for ambiguous input's fixed refusal.
const HOOK_FLAGS = new Set([
  '--gemini-beforetool-exit-code',
  '--codex-pretool-hook',
  '--codex-launch-override',
  '--action-policy-hook',
  '--action-policy-after-hook',
  '--gemini-beforetool-hook',
]);
const PROFILE_SWITCH = '--user-data-dir=';

/** Select application args for the existing hook modes before GUI initialization.
 * Electron consumes its native profile switch before this JS validation. The
 * caller must validate an owned profile before launch; this is not isolation.
 * Original argv stays intact for the native bootstrap and other startup users.
 * @param {string[]} argv Process argv, including executable and optional spacer.
 * @returns {{isHook: boolean, args: string[]}} Hook-only refusal or selected args.
 * @since v0.21.0 */
function selectHookStartupArgs(argv) {
  const startup = argv.slice(1);
  const hooks = startup.filter((arg) => HOOK_FLAGS.has(arg));
  if (!hooks.length) return { isHook: false, args: argv.slice(2) };
  const refuse = () => ({
    isHook: true,
    args: [[...HOOK_FLAGS].find((flag) => hooks.includes(flag))],
  });
  if (
    hooks.length !== 1 ||
    startup.some((arg) => arg.toLowerCase().startsWith('--aegis-owned-gui-profile'))
  )
    return refuse();
  const profiles = startup.filter((arg) => arg.toLowerCase().startsWith('--user-data-dir'));
  if (profiles.length > 1) return refuse();
  if (profiles.length) {
    const option = profiles[0];
    const value = option.slice(PROFILE_SWITCH.length);
    if (
      !option.startsWith(PROFILE_SWITCH) ||
      !value ||
      value.length > 2048 ||
      // eslint-disable-next-line no-control-regex -- Native path metadata only.
      /[\x00-\x1f\x7f]/.test(value) ||
      !path.isAbsolute(value) ||
      path.resolve(value) !== value
    )
      return refuse();
  }
  const selected = profiles.length ? startup.filter((arg) => arg !== profiles[0]) : startup;
  if (selected[0]?.startsWith('-') && !HOOK_FLAGS.has(selected[0])) return refuse();
  return { isHook: true, args: HOOK_FLAGS.has(selected[0]) ? selected : selected.slice(1) };
}

module.exports = { selectHookStartupArgs };
