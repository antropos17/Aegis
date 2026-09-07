/**
 * @file bench/lib/oracles/sysmon.js
 * @module bench/lib/oracles/sysmon
 * @description The Sysmon oracle adapter for one bench run (sub-block B2.3).
 *
 *   Sysmon is the independent source the catalogue is confirmed against. It is
 *   kernel-backed and shares no failure mode with Electron, chokidar or
 *   `tasklist`, which is the whole reason a disagreement between it and the
 *   sensor is a finding rather than two user-mode pollers agreeing.
 *
 *   Nothing here imports from `src/`, and nothing here imports
 *   `bench/lib/observed.js` either: that module is the SENSOR side, and an oracle
 *   that shared code with the thing it confirms would stop being independent. The
 *   two path helpers below are therefore a deliberate duplication.
 *
 *   What IS shared is `bench/lib/paths.js`, through `bench/lib/catalogue.js`: the
 *   recording rewrite that turns the developer's clone root and OS account name
 *   into the neutral ones every committed artefact carries. It belongs to neither
 *   column — it decides what is written down, not what was observed — and it has
 *   to be the same transform on both sides or the catalogue and this oracle would
 *   name one file with two different strings and no path key would ever match. See
 *   {@link toOracleRecord} and {@link writeLoss}.
 *
 *   ## Three layers, and where each one stands
 *
 *   **RAW — LIVE-UNVALIDATED.** A real `Microsoft-Windows-Sysmon/Operational`
 *   channel, read by Windows into EventRecord XML. {@link readChannelXml} is the
 *   ONE function that crosses it, it is injectable, and no test in this
 *   repository has ever executed it: the machine this was written on runs
 *   Windows 11 Home with no Sysmon installed. Nothing here may be read as a claim
 *   that EVTX ingestion works. It is proven when it runs in a guest against an
 *   installed binary, and not before.
 *
 *   **NORMALIZER — proven offline.** EventRecord XML → a canonical oracle record.
 *   {@link parseEventXml} and {@link select} are pure, take strings, and are
 *   tested against clearly-labelled SYNTHETIC XML. No binary `.evtx` file is
 *   fabricated anywhere in this repository: a synthetic EVTX container would test
 *   our imitation of the Windows Event Log rather than Windows.
 *
 *   **DERIVED — built, and no stronger than the layer above it.** Matching the
 *   oracle against the catalogue, and every metric over the result, lives in
 *   `bench/lib/metrics.js` and `bench/score.js`. **This file scores nothing and
 *   compares nothing**, and that is a boundary rather than a stage it has not
 *   reached yet: it collects, normalizes and accounts for one channel read, and a
 *   separate entrypoint reads what it wrote. A confirmation figure derived from
 *   these records is bounded by the RAW layer above — a metric over records nobody
 *   has ever collected from an installed binary is arithmetic, not evidence.
 *
 *   ## What is retained, and what is refused
 *
 *   A normalized record keeps only fields the Sysmon event actually carried. The
 *   `bench` block holds the observational facts ECS has no home for, and follows
 *   the B2.2 convention: a field the event did not expose is **omitted**, never
 *   nulled. Above all, three refusals:
 *
 *   - **`ProcessGuid` is opaque.** It is retained verbatim and compared only for
 *     EQUALITY between Sysmon events. It is never parsed, never decoded, never
 *     turned into a timestamp, and never transformed into an AEGIS `instanceId`.
 *     Community reverse-engineering of its bit layout is not an API.
 *   - **The two timestamps are never mixed.** `System/TimeCreated@SystemTime` and
 *     EventData `UtcTime` are two different representations written by two
 *     different layers. Both are retained, separately labelled; NO delta between
 *     them is computed here and no tolerance for one is declared. `@timestamp` is
 *     `SystemTime` and nothing else, and a `SystemTime` that is not UTC is
 *     REFUSED rather than converted — an offset silently applied is how a
 *     four-hour local-time skew becomes a latency figure.
 *   - **Nothing is copied between events.** EID 5 carries no command line, no
 *     parent and no exit code; the EID 1 that shares its `ProcessGuid` does. They
 *     are not merged. Lifecycle correlation is stated as correlation, in the
 *     `oracle-loss.json` accounting, and never by writing EID 1's fields into an
 *     EID 5 record where they would read as raw observations of it.
 *
 *   ## The event set
 *
 *   RESEARCH-BASELINE section 10's oracle column, 1/2/3/5/11/22, plus **26
 *   FileDeleteDetected**, added by ratification on 2026-08-14. Four of them have
 *   a shape in the catalogue's ECS subset (1, 5, 11, 26); the rest are real
 *   observations with no shape in it and are tallied rather than dropped, exactly
 *   as `observed.js` tallies what the audit records that the subset cannot hold.
 *
 *   **EID 23 FileDelete is not EID 26.** 23 archives the deleted file into
 *   `ArchiveDirectory`; 26 logs the deletion and saves nothing. The bench config
 *   enables 26 and never 23, so a 23 arriving at this parser means the running
 *   configuration is not the one the manifest names — it is recorded as that
 *   finding and is never accepted as a deletion observation.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const catalogue = require('../catalogue');
const manifest = require('../manifest');
// The recording rewrite, from the module that owns it. Not a second copy: two
// spellings of one transform are exactly the pair that drifts, and a drift here
// puts the catalogue and the oracle in different path spaces (ai-mistakes #24).
const { neutralizeRecorded } = require('../paths');

/** @type {string} Oracle id, as scenarios name it in their `oracles` array. */
const ORACLE_ID = 'sysmon';

/** @type {string} Normalized oracle records inside a run directory. */
const ORACLE_FILENAME = 'oracle-sysmon.ndjson';

/** @type {string} Collection and loss accounting inside a run directory. */
const LOSS_FILENAME = 'oracle-loss.json';

/** @type {number} Shape version of `oracle-loss.json`. */
const LOSS_SCHEMA_VERSION = 1;

/**
 * `bench.source` on every line this module writes, in the `<source>-<form>`
 * kebab-case the harness already uses (`aegis-audit` in `bench/lib/observed.js`,
 * `derived-model` in the replay fixtures).
 *
 * It names the acquisition boundary that is actually implemented: the
 * `Microsoft-Windows-Sysmon/Operational` **Event Log channel**, read through
 * `Get-WinEvent` and rendered by `EventRecord.ToXml()`. It deliberately does
 * **not** say `evtx`. This module never opens, exports or ingests an `.evtx`
 * file, and a label saying otherwise would put a claim about a file format into
 * every record — where a later reader would take it for provenance rather than
 * for the aspiration it was. `.evtx` ingestion remains LIVE-UNVALIDATED and
 * unimplemented; see {@link readChannelXml}.
 * @type {string}
 */
const SOURCE = 'sysmon-eventlog-xml';

/** @type {string} The channel Sysmon writes to on Vista and higher. */
const CHANNEL = 'Microsoft-Windows-Sysmon/Operational';

/** @type {string} The only provider whose records are oracle evidence. */
const PROVIDER = 'Microsoft-Windows-Sysmon';

/**
 * The bench config, absolute. There is deliberately no second constant holding
 * the repository-relative form: {@link manifestBlock} derives it with
 * `path.relative`, and two hand-maintained spellings of one path are exactly the
 * pair that drifts (memory-bank/ai-mistakes.md #24).
 * @type {string}
 */
const CONFIG_PATH = path.join(manifest.ROOT, 'bench', 'oracles', 'sysmon-bench.xml');

/**
 * Event ids by name, so no number below is a bare literal.
 * @type {Readonly<Object<string, number>>}
 */
const EVENT_IDS = Object.freeze({
  PROCESS_CREATE: 1,
  FILE_CREATE_TIME: 2,
  NETWORK_CONNECT: 3,
  PROCESS_TERMINATE: 5,
  FILE_CREATE: 11,
  DNS_QUERY: 22,
  FILE_DELETE_ARCHIVED: 23,
  FILE_DELETE_DETECTED: 26,
  SYSMON_ERROR: 255,
});

/**
 * The event ids `bench/oracles/sysmon-bench.xml` asks Sysmon to emit: the
 * RESEARCH-BASELINE section 10 oracle column plus the ratified 26. **23 is not
 * in it and must never be added to it** — see the file docblock.
 * @type {ReadonlyArray<number>}
 */
const CANONICAL_EVENT_IDS = Object.freeze([
  EVENT_IDS.PROCESS_CREATE,
  EVENT_IDS.FILE_CREATE_TIME,
  EVENT_IDS.NETWORK_CONNECT,
  EVENT_IDS.PROCESS_TERMINATE,
  EVENT_IDS.FILE_CREATE,
  EVENT_IDS.DNS_QUERY,
  EVENT_IDS.FILE_DELETE_DETECTED,
]);

/**
 * Which event ids have a shape in the catalogue's ECS subset. An id that is not
 * here is not unknown and not lost — it is a real observation the subset has no
 * room for, and it is counted.
 * @type {Readonly<Object<number, string>>}
 */
const SHAPED_EVENT_IDS = Object.freeze({
  [EVENT_IDS.PROCESS_CREATE]: 'process.start',
  [EVENT_IDS.PROCESS_TERMINATE]: 'process.end',
  [EVENT_IDS.FILE_CREATE]: 'file.creation',
  [EVENT_IDS.FILE_DELETE_DETECTED]: 'file.deletion',
});

/**
 * EventData fields a shaped record cannot be written without.
 *
 * Deliberately short. Microsoft's prose for EID 5 names exactly `UtcTime`,
 * `ProcessGuid` and `ProcessId`, and that is the leanest Sysmon event there is —
 * so those three are the floor, plus the target path for a file event, which has
 * no shape without one. Everything richer (`Image`, `CommandLine`, the parent
 * block) is retained WHERE THE EVENT EXPOSES IT and omitted where it does not.
 * Requiring a field the published schema does not guarantee would refuse real
 * records; inventing one would be worse.
 * @type {Readonly<Object<number, ReadonlyArray<string>>>}
 */
const REQUIRED_DATA = Object.freeze({
  [EVENT_IDS.PROCESS_CREATE]: Object.freeze(['UtcTime', 'ProcessGuid', 'ProcessId']),
  [EVENT_IDS.PROCESS_TERMINATE]: Object.freeze(['UtcTime', 'ProcessGuid', 'ProcessId']),
  [EVENT_IDS.FILE_CREATE]: Object.freeze(['UtcTime', 'ProcessGuid', 'ProcessId', 'TargetFilename']),
  [EVENT_IDS.FILE_DELETE_DETECTED]: Object.freeze([
    'UtcTime',
    'ProcessGuid',
    'ProcessId',
    'TargetFilename',
  ]),
});

/**
 * `System/TimeCreated@SystemTime` as Windows renders it: an ISO-8601 instant with
 * up to seven fractional digits and a literal `Z`. The `Z` is not optional here
 * — see {@link normalizeSystemTime}.
 * @type {RegExp}
 */
const SYSTEM_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/;

/**
 * How many records one read may take off the channel.
 *
 * A bound rather than "everything", because the channel is machine-wide and a
 * long-lived host's can be enormous. Reaching it is itself a finding and is
 * recorded: the read may have stopped short of the window's start.
 * @type {number}
 */
const MAX_EVENTS_READ = 20000;

/**
 * Frames one event XML document from the next in the reader's stdout.
 *
 * `EventRecord.ToXml()` may contain newlines inside a `Data` value, so a
 * line-per-record assumption is not safe. The sentinel is part of the
 * LIVE-UNVALIDATED boundary, not of the record format.
 * @type {string}
 */
const RECORD_DELIMITER = '<<<AEGIS-SYSMON-RECORD-BOUNDARY>>>';

/**
 * An oracle failure the caller must not paper over. Carries a machine-readable
 * `stage`, the same convention `bench/lib/observed.js` uses.
 */
class SysmonError extends Error {
  /**
   * @param {string} stage - One of `config-unreadable`, `reader-failed`,
   *   `window-invalid`.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'SysmonError';
    this.stage = stage;
  }
}

/**
 * SHA-256 over a file's exact bytes — never over its decoded text and never over
 * its path. The digest names what a run was measured under, so it has to be a
 * digest of the thing itself.
 * @param {string} file - Absolute path.
 * @returns {string} Hex-encoded SHA-256.
 */
function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Split a path into name and directory WITHOUT touching the filesystem: the file
 * a deletion event names is gone by definition.
 *
 * The separator is read off the string rather than off the running platform, so
 * the tests can run on a POSIX CI machine over Windows paths. Duplicated from
 * `bench/lib/observed.js` on purpose — see the file docblock.
 * @param {string} value - The path exactly as Sysmon recorded it.
 * @returns {{name: string, directory: string}}
 */
function splitPath(value) {
  const flavour = /\\/.test(value) || /^[A-Za-z]:/.test(value) ? path.win32 : path.posix;
  return { name: flavour.basename(value), directory: flavour.dirname(value) };
}

/**
 * Decode the five XML predefined entities and numeric character references.
 *
 * `&amp;` is resolved LAST so that `&amp;lt;` decodes to the literal text
 * `&lt;` rather than to `<`.
 * @param {string} value - Raw text between two XML tags.
 * @returns {string}
 */
function decodeXmlText(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

/**
 * Parse one rendered EventRecord XML document into the two blocks Windows gives
 * it: the `System` header and the provider's `EventData`.
 *
 * A scanner rather than a general XML parser, and strict on purpose. It knows one
 * document shape — the one the Windows Event Log renders — and refuses anything
 * else by name instead of returning a half-read record that a later count would
 * treat as an observation. No XML dependency is added for it: the shape is
 * closed, and the refusals are required by the loss accounting anyway.
 * @param {string} xml - One `<Event>…</Event>` document.
 * @returns {{system: {eventId: number, eventRecordId: number|null, version: number|null,
 *   timeCreated: string, channel: string|null, computer: string|null, provider: string|null},
 *   data: Object<string, string>}}
 * @throws {Error} Naming what was missing or ambiguous.
 */
function parseEventXml(xml) {
  const refuse = (why) => {
    throw new Error(`sysmon: refusing an event record — ${why}`);
  };
  if (typeof xml !== 'string' || xml.trim() === '') refuse('it is empty');
  if (!/<Event[\s>]/.test(xml)) refuse('it has no <Event> element');

  const systemBlock = xml.match(/<System[^>]*>([\s\S]*?)<\/System>/);
  if (!systemBlock) refuse('it has no <System> block, so it carries no event identity');
  const system = systemBlock[1];

  /**
   * @param {string} tag
   * @returns {string|null}
   */
  const text = (tag) => {
    const m = system.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? decodeXmlText(m[1]).trim() : null;
  };

  const rawEventId = text('EventID');
  if (rawEventId === null) refuse('its <System> block carries no <EventID>');
  const eventId = Number.parseInt(rawEventId, 10);
  if (!Number.isSafeInteger(eventId) || String(eventId) !== rawEventId) {
    refuse(`its <EventID> is "${rawEventId}", which is not an event id`);
  }

  const timeMatch = system.match(/<TimeCreated[^>]*\bSystemTime="([^"]*)"/);
  if (!timeMatch) refuse(`EventID ${eventId} carries no <TimeCreated SystemTime="…">`);
  const timeCreated = decodeXmlText(timeMatch[1]).trim();

  const providerMatch = system.match(/<Provider[^>]*\bName="([^"]*)"/);
  const rawRecordId = text('EventRecordID');
  const recordId = rawRecordId === null ? null : Number.parseInt(rawRecordId, 10);
  if (rawRecordId !== null && (!Number.isSafeInteger(recordId) || recordId < 0)) {
    refuse(`EventID ${eventId} carries <EventRecordID>${rawRecordId}</EventRecordID>`);
  }
  const rawVersion = text('Version');
  const version = rawVersion === null ? null : Number.parseInt(rawVersion, 10);

  /** @type {Object<string, string>} */
  const data = {};
  const dataBlock = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/);
  if (dataBlock) {
    const entry = /<Data\b[^>]*\bName="([^"]*)"\s*(?:\/>|>([\s\S]*?)<\/Data>)/g;
    let m;
    while ((m = entry.exec(dataBlock[1])) !== null) {
      const name = decodeXmlText(m[1]);
      if (Object.prototype.hasOwnProperty.call(data, name)) {
        refuse(
          `EventID ${eventId} carries two <Data Name="${name}"> entries — which of the two is ` +
            'the observation cannot be decided here',
        );
      }
      data[name] = m[2] === undefined ? '' : decodeXmlText(m[2]);
    }
  }

  return {
    system: {
      eventId,
      eventRecordId: rawRecordId === null ? null : recordId,
      version: Number.isSafeInteger(version) ? version : null,
      timeCreated,
      channel: text('Channel'),
      computer: text('Computer'),
      provider: providerMatch ? decodeXmlText(providerMatch[1]) : null,
    },
    data,
  };
}

/**
 * `System/TimeCreated@SystemTime` reduced to the catalogue's instant format, and
 * refused outright when it is not UTC.
 *
 * Two decisions, both about the same trap. **Truncation, never rounding:**
 * Windows writes seven fractional digits and the catalogue speaks three, and
 * rounding could move an instant across a millisecond boundary that a later join
 * reads as ordering. **A non-`Z` value is refused, never converted:** the offset
 * arithmetic that would turn `…T08:00:00-04:00` into `…T12:00:00Z` is exactly the
 * arithmetic that turns a reader's local-time slip into four hours of apparent
 * latency, so it does not exist in this module. If a future live reader ever
 * hands local instants over, this fails loudly at the first record instead of
 * producing a plausible number.
 *
 * The original string is retained unmodified as `bench.timeCreatedSystemTime`;
 * nothing here overwrites it.
 * @param {string} raw - The attribute value, verbatim.
 * @returns {string} `YYYY-MM-DDTHH:MM:SS.mmmZ`.
 * @throws {Error} On anything that is not a UTC instant.
 */
function normalizeSystemTime(raw) {
  const m = SYSTEM_TIME.exec(raw);
  if (!m) {
    throw new Error(
      `sysmon: refusing SystemTime "${raw}" — it is not a UTC instant ending in Z. A local or ` +
        'offset-bearing timestamp is not converted here: applying an offset is how a reader ' +
        "running in another zone turns its own clock into the oracle's latency",
    );
  }
  return `${m[1]}.${`${m[2] || ''}000`.slice(0, 3)}Z`;
}

/**
 * A non-empty EventData value, or `undefined` when the event did not expose one.
 * @param {Object<string, string>} data
 * @param {string} key
 * @returns {string|undefined}
 */
function exposed(data, key) {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * A pid Windows could have handed out, or `undefined`.
 * @param {Object<string, string>} data
 * @param {string} key
 * @returns {number|undefined}
 */
function pidField(data, key) {
  const raw = exposed(data, key);
  if (raw === undefined) return undefined;
  const pid = Number.parseInt(raw, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * The `bench` block: where the row came from, plus every observational fact ECS
 * has no field for. Absent fields are omitted, never nulled (the B2.2 convention).
 *
 * `processGuid` rides here and NOT in an identity field, because it is opaque:
 * two records carrying the same string describe the same process generation, and
 * that is the whole of what may be read out of it.
 * @param {Object} parsed - From {@link parseEventXml}.
 * @param {string} scenario - Scenario id.
 * @returns {Object}
 */
function benchBlock(parsed, scenario) {
  const { system, data } = parsed;
  /** @type {Object} */
  const block = {
    scenario,
    source: SOURCE,
    oracle: ORACLE_ID,
    eventId: system.eventId,
    // The raw attribute, unrounded and unconverted. `@timestamp` is derived from
    // it; this is the observation that derivation was made from.
    timeCreatedSystemTime: system.timeCreated,
    // Sysmon's OWN representation, in Sysmon's own format. Kept verbatim and
    // never parsed: it is not the same clock reading as SystemTime, and no delta
    // between the two is computed anywhere in this module.
    utcTime: data.UtcTime,
    processGuid: data.ProcessGuid,
  };
  if (system.eventRecordId !== null) block.eventRecordId = system.eventRecordId;
  if (system.version !== null) block.eventVersion = system.version;
  if (system.channel) block.channel = system.channel;
  if (system.computer) block.computer = system.computer;
  if (system.provider) block.provider = system.provider;

  // Which rule of bench/oracles/sysmon-bench.xml let this event through. The
  // config names every rule, so a record with no RuleName — or with someone
  // else's — came from a configuration this run does not describe.
  const ruleName = exposed(data, 'RuleName');
  if (ruleName !== undefined && ruleName !== '-') block.ruleName = ruleName;

  const parentGuid = exposed(data, 'ParentProcessGuid');
  if (parentGuid !== undefined) block.parentProcessGuid = parentGuid;
  const creation = exposed(data, 'CreationUtcTime');
  if (creation !== undefined) block.creationUtcTime = creation;
  const hashes = exposed(data, 'Hashes');
  if (hashes !== undefined) block.hashes = hashes;
  // EID 26 states whether the file was archived. Retained because it is the
  // observation that separates 26's behaviour from 23's, and never inferred.
  const archived = exposed(data, 'Archived');
  if (archived !== undefined) block.archived = archived;
  const user = exposed(data, 'User');
  if (user !== undefined) block.user = user;
  return block;
}

/**
 * The ECS fields for one shaped event, built from THAT event's own data.
 *
 * Nothing is carried across events. An EID 5 record gets no command line, no
 * parent and no exit code, because Sysmon's process-terminate event has none —
 * Microsoft's prose gives it `UtcTime`, `ProcessGuid` and `ProcessId`. Whether a
 * given binary's schema also exposes `Image` there is not settled by the
 * documentation, so it is written when present and left out when not.
 *
 * `process.name` is `basename(Image)` — a string derivation of an observed field,
 * and the image name the product's own audit never persists. `process.start` is
 * deliberately NOT written: the instant Sysmon has for it is `UtcTime`, in
 * Sysmon's own format, and putting that in an ECS date field would invite a
 * later subtraction across two representations.
 * @param {number} eventId
 * @param {Object<string, string>} data - The event's EventData.
 * @returns {Object} ECS field groups.
 */
function ecsFields(eventId, data) {
  const image = exposed(data, 'Image');
  /** @type {Object} */
  const process = {};
  const pid = pidField(data, 'ProcessId');
  if (pid !== undefined) process.pid = pid;
  if (image !== undefined) {
    process.executable = image;
    process.name = splitPath(image).name;
  }

  if (eventId === EVENT_IDS.PROCESS_CREATE) {
    const commandLine = exposed(data, 'CommandLine');
    if (commandLine !== undefined) process.command_line = commandLine;
    /** @type {Object} */
    const parent = {};
    const parentPid = pidField(data, 'ParentProcessId');
    if (parentPid !== undefined) parent.pid = parentPid;
    const parentImage = exposed(data, 'ParentImage');
    if (parentImage !== undefined) {
      parent.executable = parentImage;
      parent.name = splitPath(parentImage).name;
    }
    const parentCommandLine = exposed(data, 'ParentCommandLine');
    if (parentCommandLine !== undefined) parent.command_line = parentCommandLine;
    if (Object.keys(parent).length > 0) process.parent = parent;
    return { process };
  }

  if (eventId === EVENT_IDS.PROCESS_TERMINATE) return { process };

  // 11 and 26: a file event. TargetFilename is required for both, so the path is
  // present by the time this runs.
  const target = data.TargetFilename;
  const { name, directory } = splitPath(target);
  return { file: { path: target, name, directory }, process };
}

/**
 * Turn one parsed record into a canonical oracle record.
 *
 * The record comes back in the RECORDING path space, not the machine's: every
 * string in it goes through `bench/lib/paths.js`, the same rewrite
 * `catalogue.buildEvent` applies to a catalogue row and `observed.js` applies to
 * an observation. It is applied HERE, at build, rather than only at serialize
 * time, for the reason `observed.js` rewrites before deriving `name` and
 * `directory`: an in-memory record that still named the developer's clone root
 * would put this column in a different path space from the catalogue for any
 * caller holding it, and a path key that misses is indistinguishable from an
 * oracle that saw nothing.
 *
 * The rewrite moves a clone root and an account name and touches nothing else, so
 * it cannot merge two files into one name — but it is a RECORDING transform and
 * the record is therefore what this run wrote down, not a byte-exact transcript
 * of what Sysmon emitted. The untouched original is on the channel.
 * @param {Object} parsed - From {@link parseEventXml}.
 * @param {string} scenario - Scenario id.
 * @returns {Object} An ECS document in the catalogue's subset.
 * @throws {Error} When a required EventData field is missing, or the timestamp is
 *   not a UTC instant.
 */
function toOracleRecord(parsed, scenario) {
  const { system, data } = parsed;
  const shapeName = SHAPED_EVENT_IDS[system.eventId];
  const shape = catalogue.EVENT_SHAPES[shapeName];
  for (const field of REQUIRED_DATA[system.eventId]) {
    if (exposed(data, field) === undefined) {
      throw new Error(
        `sysmon: EventID ${system.eventId} carries no "${field}" — a record without it is not an ` +
          'observation this oracle can write, and no value is substituted for it',
      );
    }
  }
  return neutralizeRecorded({
    '@timestamp': normalizeSystemTime(system.timeCreated),
    ecs: { version: catalogue.ECS_VERSION },
    event: {
      kind: 'event',
      category: [shape.category],
      type: [shape.type],
      action: shape.action,
      code: String(system.eventId),
      provider: system.provider || PROVIDER,
      ...(system.eventRecordId === null ? {} : { sequence: system.eventRecordId }),
    },
    ...ecsFields(system.eventId, data),
    bench: benchBlock(parsed, scenario),
  });
}

/**
 * Empty loss accounting. Every counter starts at zero and every "we could not
 * establish this" starts as an explicit absence, so a field that is never filled
 * reads as unmeasured rather than as measured-zero.
 * @returns {Object}
 */
function emptyTally() {
  return {
    read: 0,
    normalized: 0,
    outOfWindow: 0,
    shapelessByEventId: {},
    refused: {
      malformed: [],
      foreignProvider: [],
      missingRequiredField: [],
      nonUtcTimestamp: [],
      unsupportedEventId: {},
    },
    archivalDeletes: [],
    sysmonErrors: [],
    eventRecordIds: [],
  };
}

/**
 * Reduce a set of raw XML documents to this run's oracle records.
 *
 * Pure: strings in, objects out, no filesystem and no clock. The window is
 * `[windowStart, windowEnd]` inclusive and carries **no epsilon**. Both ends are
 * instants the bench read off its own clock — the run's `startedAt`, before
 * anything the scenario causes, and the moment collection begins, after all of it
 * — so nothing the scenario produced can fall outside, and no tolerance has to be
 * invented to pull it in. A tolerance here would be a guess about clock agreement
 * between Sysmon and the harness, and that is not a quantity this repository has
 * measured.
 * @param {Object} opts
 * @param {string[]} opts.documents - Raw EventRecord XML, one per element.
 * @param {string} opts.scenario - Scenario id.
 * @param {string} opts.windowStart - ISO instant.
 * @param {string} opts.windowEnd - ISO instant.
 * @returns {{events: Object[], tally: Object}}
 * @throws {SysmonError} When the window is not two instants.
 */
function select(opts) {
  const from = Date.parse(opts.windowStart);
  const to = Date.parse(opts.windowEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new SysmonError(
      'window-invalid',
      `the oracle window [${opts.windowStart}, ${opts.windowEnd}] is not two UTC instants, so no ` +
        'record can be said to fall inside it',
    );
  }

  const events = [];
  const tally = emptyTally();

  for (let i = 0; i < opts.documents.length; i++) {
    tally.read += 1;
    let parsed;
    try {
      parsed = parseEventXml(opts.documents[i]);
    } catch (err) {
      tally.refused.malformed.push({ index: i, reason: err.message });
      continue;
    }
    const { system } = parsed;

    if (system.provider !== null && system.provider !== PROVIDER) {
      tally.refused.foreignProvider.push({
        index: i,
        eventId: system.eventId,
        provider: system.provider,
      });
      continue;
    }

    let at;
    try {
      at = Date.parse(normalizeSystemTime(system.timeCreated));
    } catch (err) {
      tally.refused.nonUtcTimestamp.push({
        index: i,
        eventId: system.eventId,
        reason: err.message,
      });
      continue;
    }
    if (at < from || at > to) {
      tally.outOfWindow += 1;
      continue;
    }
    if (system.eventRecordId !== null) tally.eventRecordIds.push(system.eventRecordId);

    // EID 23 archives the file it reports deleted. The bench config never enables
    // it, so one arriving here says the running configuration is not the one this
    // run names — it is recorded as exactly that and NEVER read as a deletion.
    if (system.eventId === EVENT_IDS.FILE_DELETE_ARCHIVED) {
      tally.archivalDeletes.push({
        index: i,
        eventRecordId: system.eventRecordId,
        targetFilename: exposed(parsed.data, 'TargetFilename') || null,
        reason:
          'EventID 23 FileDelete archives the deleted file into ArchiveDirectory; the bench ' +
          'config enables 26 FileDeleteDetected and never 23. This record is NOT accepted as a ' +
          'deletion observation — its presence means the running configuration is not the one ' +
          'this run names',
      });
      continue;
    }

    if (system.eventId === EVENT_IDS.SYSMON_ERROR) {
      tally.sysmonErrors.push({
        index: i,
        eventRecordId: system.eventRecordId,
        description: exposed(parsed.data, 'Description') || null,
      });
      continue;
    }

    if (!SHAPED_EVENT_IDS[system.eventId]) {
      const key = String(system.eventId);
      if (CANONICAL_EVENT_IDS.includes(system.eventId)) {
        tally.shapelessByEventId[key] = (tally.shapelessByEventId[key] || 0) + 1;
      } else {
        tally.refused.unsupportedEventId[key] = (tally.refused.unsupportedEventId[key] || 0) + 1;
      }
      continue;
    }

    try {
      events.push(toOracleRecord(parsed, opts.scenario));
      tally.normalized += 1;
    } catch (err) {
      tally.refused.missingRequiredField.push({
        index: i,
        eventId: system.eventId,
        reason: err.message,
      });
    }
  }

  return { events, tally };
}

/**
 * Lifecycle correlation between ProcessCreate and ProcessTerminate, by OPAQUE
 * `ProcessGuid` equality and nothing else.
 *
 * This is an accounting fact recorded next to the records, not an enrichment of
 * them: no field produced here is ever written back into a normalized record,
 * because a terminate event that borrowed its creation's fields would read as
 * having observed them itself.
 *
 * The guid is compared with `===`. It is not parsed, not decoded and not ordered.
 * pid is deliberately NOT a fallback key: two generations sharing one pid are two
 * generations, and pairing them by pid would manufacture a lifecycle the OS never
 * had. A terminate whose guid matches no creation in this window is UNPAIRED and
 * is counted as such — the creation may simply predate the window.
 *
 * `ordinality` keeps RESEARCH-BASELINE section 10's rule intact: truth about
 * process identity comes from EID 1 ordinality, and guid equality is an
 * additional lifecycle fact beside it, never a replacement for it.
 * @param {Object[]} events - Normalized records, in the order they were read.
 * @returns {Object} The correlation accounting.
 */
function correlateLifecycle(events) {
  /** @type {Map<string, Object[]>} */
  const creationsByGuid = new Map();
  const creations = [];
  const terminations = [];
  for (const event of events) {
    if (event.event.code === String(EVENT_IDS.PROCESS_CREATE)) creations.push(event);
    if (event.event.code === String(EVENT_IDS.PROCESS_TERMINATE)) terminations.push(event);
  }
  creations.forEach((event, ordinality) => {
    const guid = event.bench.processGuid;
    if (!creationsByGuid.has(guid)) creationsByGuid.set(guid, []);
    creationsByGuid.get(guid).push({ event, ordinality });
  });

  const paired = [];
  const unpaired = [];
  const ambiguous = [];
  for (const [index, event] of terminations.entries()) {
    const matches = creationsByGuid.get(event.bench.processGuid);
    if (!matches || matches.length === 0) {
      unpaired.push({
        terminateOrdinality: index,
        processGuid: event.bench.processGuid,
        processId: event.process ? (event.process.pid ?? null) : null,
        reason:
          'no ProcessCreate in this window carries that ProcessGuid. The creation may predate ' +
          'the window; it is never paired by pid instead',
      });
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({
        terminateOrdinality: index,
        processGuid: event.bench.processGuid,
        creationOrdinalities: matches.map((m) => m.ordinality),
        reason:
          'more than one ProcessCreate in this window carries that ProcessGuid, which the guid ' +
          'is supposed to make impossible. Nothing is guessed: the pairing is AMBIGUOUS',
      });
      continue;
    }
    paired.push({
      createOrdinality: matches[0].ordinality,
      terminateOrdinality: index,
      processGuid: event.bench.processGuid,
      processId: event.process ? (event.process.pid ?? null) : null,
    });
  }

  const pidsSeen = creations.map((e) => (e.process ? (e.process.pid ?? null) : null));
  const reusedPids = pidsSeen.filter((pid, i) => pid !== null && pidsSeen.indexOf(pid) !== i);
  return {
    key:
      'ProcessGuid, compared for equality only — never parsed, never decoded, and never ' +
      'transformed into an AEGIS instanceId',
    creations: creations.length,
    terminations: terminations.length,
    paired,
    unpaired,
    ambiguous,
    // Two EID 1 records sharing a pid are two generations by ordinality, whatever
    // the pid says. Recorded so a pid-keyed reader downstream cannot assume the
    // question never came up.
    distinctPidsAcrossCreations: new Set(pidsSeen.filter((p) => p !== null)).size,
    pidsReusedAcrossCreations: [...new Set(reusedPids)],
  };
}

/**
 * Ascending EventRecordID gaps in what was collected.
 *
 * A gap is NOT loss, and this block says so in the file rather than leaving the
 * inference to a reader. EventRecordID is per channel, and this run reads a
 * window out of a channel whose other records — other Sysmon events, from other
 * filters, about other processes — legitimately sit between the ones it kept. A
 * gap is consistent with loss and equally consistent with a working filter, and
 * nothing available offline separates the two.
 * @param {number[]} ids - Collected EventRecordIDs, in read order.
 * @returns {Object}
 */
function recordIdGaps(ids) {
  const sorted = [...ids].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i] - sorted[i - 1];
    if (delta > 1) gaps.push({ after: sorted[i - 1], before: sorted[i], missing: delta - 1 });
  }
  return {
    collected: sorted.length,
    first: sorted.length > 0 ? sorted[0] : null,
    last: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    gaps,
    meaning:
      'a gap is NOT a loss count. EventRecordID is assigned per channel, and every Sysmon event ' +
      'this run did not collect — a different event id, a record outside the window, a record ' +
      'this config filtered out — legitimately consumes an id. Nothing available offline ' +
      'separates a gap caused by loss from a gap caused by a working filter',
  };
}

/**
 * Read the Sysmon channel into raw EventRecord XML documents.
 *
 * **THIS IS THE LIVE-UNVALIDATED BOUNDARY, AND NOTHING HAS EVER EXERCISED IT.**
 * No test in this repository calls it, because the machine it was written on has
 * no Sysmon installed. Do not read a green suite as evidence that this works.
 *
 * Two deliberate choices, both about keeping .NET's clock out of the pipeline:
 *
 * - It emits `$_.ToXml()` and never the `TimeCreated` property. `Get-WinEvent`
 *   hands that back as a `DateTime` with `Kind=Local`, and every downstream
 *   conversion of it is an opportunity to turn the reader's own time zone into
 *   the oracle's latency. The XML carries `System/TimeCreated@SystemTime`
 *   instead, which {@link normalizeSystemTime} refuses unless it ends in `Z`.
 * - It does **not** filter by time. A `-FilterHashtable` `StartTime`/`EndTime`
 *   would mean constructing .NET `DateTime`s from our instants — the same trap
 *   one step earlier. The window is applied by {@link select}, in JavaScript,
 *   over the XML's own timestamps, where it is unit-testable.
 *
 * The read is bounded by `-MaxEvents`. Hitting that bound is recorded: it means
 * the read may have stopped before reaching the start of the window.
 *
 * The `command` it returns — which becomes `collection.reader` in
 * `oracle-loss.json` — is built from the same argv array that is executed, so a
 * provenance field cannot come to describe something narrower than what ran.
 * @param {Object} [opts]
 * @param {number} [opts.maxEvents] - Bound on records read. Default
 *   {@link MAX_EVENTS_READ}.
 * @param {string} [opts.channel] - Channel name. Default {@link CHANNEL}.
 * @returns {{documents: string[], capReached: boolean, command: string}}
 * @throws {SysmonError} When PowerShell or the channel refused.
 */
function readChannelXml(opts = {}) {
  const maxEvents = opts.maxEvents || MAX_EVENTS_READ;
  const channel = opts.channel || CHANNEL;
  const script =
    `$ErrorActionPreference='Stop'; ` +
    `Get-WinEvent -LogName '${channel}' -MaxEvents ${maxEvents} | ` +
    `ForEach-Object { $_.ToXml(); '${RECORD_DELIMITER}' }`;
  const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  // Derived from the SAME array that is executed, so the record of what ran
  // cannot drift from what ran. It is the argv joined for reading, not a shell
  // command line: no shell is involved, and nothing here is quoted for one.
  const command = ['powershell', ...argv].join(' ');
  let out;
  try {
    out = execFileSync('powershell', argv, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    throw new SysmonError(
      'reader-failed',
      `${command} did not produce a channel read: ${String((err && err.message) || err).trim()}`,
    );
  }
  const documents = out
    .split(RECORD_DELIMITER)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  return { documents, capReached: documents.length >= maxEvents, command };
}

/**
 * What Sysmon binary, if any, this host is running.
 *
 * A read-only probe: it asks for a service and a file version and changes
 * nothing. **A version is never invented** — no string from a web page, no
 * default, no "latest". When the probe does not answer, the manifest records the
 * absence and the reason the probe gave.
 * @param {Object} [opts]
 * @param {function(string): string} [opts.exec] - Runs a PowerShell script and
 *   returns its stdout. Injectable so the absent branch can be exercised without
 *   a shell.
 * @returns {{value: Object|null, source: string, unavailable?: string}}
 */
function probeVersion(opts = {}) {
  const script =
    `$ErrorActionPreference='Stop'; ` +
    `$svc = Get-Service -Name 'Sysmon64','Sysmon' -ErrorAction SilentlyContinue | ` +
    `Select-Object -First 1; ` +
    `if (-not $svc) { throw 'no Sysmon or Sysmon64 service is installed on this host' }; ` +
    `$img = (Get-CimInstance Win32_Service -Filter ("Name='" + $svc.Name + "'")).PathName; ` +
    `$img = $img.Trim('"'); ` +
    `$info = (Get-Item $img).VersionInfo; ` +
    `ConvertTo-Json -Compress @{ service = $svc.Name; image = $img; ` +
    `fileVersion = $info.FileVersion; productVersion = $info.ProductVersion }`;
  // A SUMMARY of the probe, not the literal argv — the script itself is long and
  // `manifest.probe` puts its whole failure output in `unavailable` anyway, so
  // the exact text that ran is on the record either way. Said here so the field
  // is not read as a copy of the command line.
  const source =
    'summary of the probe: PowerShell Get-Service Sysmon64,Sysmon → Win32_Service PathName → ' +
    'that file\'s VersionInfo. The literal invocation appears in "unavailable" when it fails';
  const exec =
    opts.exec ||
    ((s) =>
      execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', s],
        { encoding: 'utf8', windowsHide: true },
      ));
  return manifest.probe(source, () => {
    // Named rather than returned as a bare `null`. `manifest.probe` turns a null
    // into "probe produced no value", which is true and says nothing — and the
    // bench's own rule is that a Windows fact on another platform is recorded as
    // ABSENT WITH A REASON (bench/README.md, "Windows-only"). This is the reason.
    if (process.platform !== 'win32') {
      throw new Error(
        `this is not a Windows host (process.platform is "${process.platform}"). Sysmon is a ` +
          'Windows facility, so no version exists to probe for here — absent because the ' +
          'platform cannot have one, not because a probe failed',
      );
    }
    const parsed = JSON.parse(exec(script));
    if (!parsed || typeof parsed.fileVersion !== 'string' || parsed.fileVersion.trim() === '') {
      return null;
    }
    return {
      service: parsed.service,
      image: parsed.image,
      fileVersion: parsed.fileVersion,
      productVersion: parsed.productVersion ?? null,
    };
  });
}

/**
 * The `oracles.sysmon` block of a run manifest: the reserved
 * `{version, configPath, configSha256}` contract, and nothing added to it.
 *
 * `configSha256` is taken over the config file's EXACT BYTES at
 * `configPath` — not over the path string, not over decoded text, and never as a
 * committed constant. `.gitattributes` puts this repository's non-fixture files
 * under `text=auto`, so a constant would go red on a checkout with different line
 * endings while naming the same configuration.
 *
 * `configPath` is repository-relative on purpose: the sha256 plus that path make
 * a run re-creatable from the repository, which an absolute path on one
 * developer's disk does not.
 * @param {Object} [opts]
 * @param {{value: Object|null, unavailable?: string}} [opts.version] - From
 *   {@link probeVersion}. Omitted means the probe was never run.
 * @param {string} [opts.configPath] - Absolute path to the config. For tests.
 * @returns {{version: string|null, configPath: string|null, configSha256: string|null,
 *   unavailable?: string}}
 */
function manifestBlock(opts = {}) {
  const file = opts.configPath || CONFIG_PATH;
  const relative = path.relative(manifest.ROOT, file).split(path.sep).join('/');
  /** @type {{version: string|null, configPath: string|null, configSha256: string|null,
   *   unavailable?: string}} */
  const block = { version: null, configPath: relative, configSha256: null };
  try {
    block.configSha256 = sha256OfFile(file);
  } catch (err) {
    block.configPath = null;
    block.unavailable = `${relative} could not be read: ${String((err && err.message) || err)}`;
    return block;
  }

  const version = opts.version;
  if (!version) {
    block.unavailable =
      'no Sysmon version was probed for this run, so none is recorded. The path and digest name ' +
      'the configuration this run WOULD be measured under; they are not evidence it was applied';
    return block;
  }
  if (!version.value) {
    block.unavailable =
      `${version.unavailable || 'the Sysmon version probe produced no value'} — so this run was ` +
      'not measured under a Sysmon binary. The path and digest name the configuration it WOULD ' +
      'have used; they are not evidence it was applied';
    return block;
  }
  block.version = version.value.fileVersion;
  return block;
}

/**
 * Collection and loss accounting for one run — the whole of `oracle-loss.json`.
 *
 * Written whether or not anything was collected, and especially when nothing
 * was: a run directory with no oracle records has to say why, or the next reader
 * assumes the oracle saw nothing, which is a different claim.
 *
 * **It never reports a loss of zero.** What can be counted is counted; what
 * cannot be established offline is an explicit absence with the reason, in the
 * `{value: null, unavailable}` shape the manifest uses.
 * @param {Object} opts
 * @param {string} opts.runId
 * @param {string} opts.scenario
 * @param {string} opts.arm
 * @param {{start: string|null, end: string|null}} opts.window
 * @param {Object} opts.config - From {@link manifestBlock}.
 * @param {Object|null} [opts.tally] - From {@link select}; null when no read ran.
 * @param {Object[]} [opts.events] - Normalized records, for the correlation block.
 * @param {Object} opts.collection - `{ran, reader, unavailable?, capReached?}`.
 * @returns {Object}
 */
function buildLoss(opts) {
  const tally = opts.tally;
  return {
    schemaVersion: LOSS_SCHEMA_VERSION,
    oracle: ORACLE_ID,
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    collection: {
      ran: opts.collection.ran,
      channel: CHANNEL,
      reader: opts.collection.reader,
      window: opts.window,
      windowEpsilonMs: 0,
      windowBasis:
        "both ends are instants the harness read off its own clock — the run's startedAt, which " +
        'precedes everything the scenario causes, and the moment collection began, which follows ' +
        'all of it. No epsilon is applied and none is declared: a tolerance here would be a guess ' +
        'about clock agreement between Sysmon and the harness, which nothing in this repository ' +
        'has measured',
      ...(opts.collection.unavailable ? { unavailable: opts.collection.unavailable } : {}),
      ...(opts.collection.capReached === undefined
        ? {}
        : {
            readCapReached: opts.collection.capReached,
            readCap: MAX_EVENTS_READ,
            readCapMeaning:
              'the reader takes at most this many records off the channel, newest first. Reaching ' +
              'the cap means the read may have stopped before the window opened, and records ' +
              'from inside the window may therefore be missing from this file',
          }),
    },
    config: {
      path: opts.config.configPath,
      sha256: opts.config.configSha256,
      enabledEventIds: [...CANONICAL_EVENT_IDS],
      archivalEventId: EVENT_IDS.FILE_DELETE_ARCHIVED,
      filterAccounting:
        'an event this configuration excludes is never emitted, so it is not lost — but Sysmon ' +
        'publishes no filter-hit counter, so a run cannot count what it declined to see either. ' +
        'Records intentionally filtered out and records that never occurred are indistinguishable ' +
        'from here, and neither is reported as loss',
    },
    records:
      tally === null
        ? {
            value: null,
            unavailable: 'no read ran, so there is nothing to account for',
          }
        : {
            read: tally.read,
            normalized: tally.normalized,
            outOfWindow: tally.outOfWindow,
            shapelessByEventId: tally.shapelessByEventId,
            shapelessMeaning:
              'canonical oracle events with no shape in the catalogue ECS subset (2, 3, 22). ' +
              'Real observations, counted rather than dropped, and not written as records: a ' +
              'fifth shape would stop expected/observed/oracle speaking one subset',
          },
    refused: tally === null ? null : tally.refused,
    archivalDeletes:
      tally === null
        ? null
        : {
            count: tally.archivalDeletes.length,
            records: tally.archivalDeletes,
            meaning:
              'EventID 23 FileDelete, which archives the deleted file. Never folded into ' +
              'EventID 26 FileDeleteDetected and never accepted as a deletion observation',
          },
    sysmonErrors:
      tally === null
        ? null
        : {
            count: tally.sysmonErrors.length,
            records: tally.sysmonErrors,
            meaning:
              'EventID 255, which Sysmon writes when it could not do something. This is a real ' +
              'loss signal and is reported as itself, not merged into any other count',
          },
    eventRecordIds: tally === null ? null : recordIdGaps(tally.eventRecordIds),
    lifecycle: tally === null ? null : correlateLifecycle(opts.events || []),
    channelRetention: {
      value: null,
      unavailable:
        'not measured. Whether the channel wrapped or overwrote records during this run would ' +
        'come from the log configuration itself (retention policy, maximum size, `wevtutil gl`), ' +
        'and no such probe runs here. Absent, not zero',
    },
  };
}

/**
 * Run the oracle for one bench run: read the channel, normalize what it holds,
 * and account for everything that did not become a record.
 *
 * Never throws for a reason the run should survive. A reader that refused comes
 * back as `collection.ran: false` with the reason on the loss record, so the
 * caller still writes the accounting and still writes the catalogue.
 * @param {Object} opts
 * @param {string} opts.runId
 * @param {string} opts.scenario
 * @param {string} opts.arm
 * @param {string} opts.windowStart - ISO instant; the run's `startedAt`.
 * @param {string} opts.windowEnd - ISO instant; when collection began.
 * @param {Object} opts.config - From {@link manifestBlock}.
 * @param {function(Object): {documents: string[], capReached: boolean, command: string}} [opts.read]
 *   - The raw boundary. Defaults to {@link readChannelXml}; injected in tests so
 *   the normalizer is exercised without a channel.
 * @returns {{events: Object[], loss: Object, ok: boolean}}
 */
function collect(opts) {
  const window = { start: opts.windowStart, end: opts.windowEnd };
  const read = opts.read || readChannelXml;
  let raw;
  try {
    raw = read({ channel: CHANNEL, maxEvents: MAX_EVENTS_READ });
  } catch (err) {
    return {
      events: [],
      ok: false,
      loss: buildLoss({
        runId: opts.runId,
        scenario: opts.scenario,
        arm: opts.arm,
        window,
        config: opts.config,
        tally: null,
        collection: {
          ran: false,
          reader: 'bench/lib/oracles/sysmon.js readChannelXml',
          unavailable: String((err && err.message) || err),
        },
      }),
    };
  }

  const { events, tally } = select({
    documents: raw.documents,
    scenario: opts.scenario,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
  });
  return {
    events,
    ok: true,
    loss: buildLoss({
      runId: opts.runId,
      scenario: opts.scenario,
      arm: opts.arm,
      window,
      config: opts.config,
      tally,
      events,
      collection: {
        ran: true,
        reader: raw.command || 'injected reader',
        capReached: Boolean(raw.capReached),
      },
    }),
  };
}

/**
 * Write the normalized oracle records into a run directory.
 *
 * Serialized by `catalogue.serialize`, the one definition of an NDJSON line's
 * bytes in this harness, so `expected.ndjson`, `observed.ndjson` and
 * `oracle-sysmon.ndjson` are comparable line for line.
 * @param {string} runDir - Absolute path of the run directory.
 * @param {Object[]} events - Never empty: the caller writes no file for none.
 * @returns {string} Absolute path of the file written.
 */
function write(runDir, events) {
  const file = path.join(runDir, ORACLE_FILENAME);
  fs.writeFileSync(file, catalogue.serialize(events), 'utf8');
  return file;
}

/**
 * Write the collection and loss accounting into a run directory.
 *
 * Neutralized as a whole, the way `observed.js` writes its capture record: this
 * file carries paths in places a path-shaped field name would not find them —
 * `archivalDeletes[].targetFilename` is an absolute path off the channel, a
 * reader that refused carries the OS error message that names one, and
 * `collection.reader` is the command line that was run. Walking every string is
 * the only rule that covers a path which landed inside a sentence.
 * @param {string} runDir - Absolute path of the run directory.
 * @param {Object} loss - From {@link buildLoss}.
 * @returns {string} Absolute path of the file written.
 */
function writeLoss(runDir, loss) {
  const file = path.join(runDir, LOSS_FILENAME);
  fs.writeFileSync(file, `${JSON.stringify(neutralizeRecorded(loss), null, 2)}\n`, 'utf8');
  return file;
}

module.exports = {
  CANONICAL_EVENT_IDS,
  CHANNEL,
  CONFIG_PATH,
  EVENT_IDS,
  LOSS_FILENAME,
  LOSS_SCHEMA_VERSION,
  MAX_EVENTS_READ,
  ORACLE_FILENAME,
  ORACLE_ID,
  PROVIDER,
  RECORD_DELIMITER,
  REQUIRED_DATA,
  SHAPED_EVENT_IDS,
  SOURCE,
  SysmonError,
  buildLoss,
  collect,
  correlateLifecycle,
  decodeXmlText,
  manifestBlock,
  normalizeSystemTime,
  parseEventXml,
  probeVersion,
  readChannelXml,
  recordIdGaps,
  select,
  sha256OfFile,
  splitPath,
  toOracleRecord,
  write,
  writeLoss,
};
