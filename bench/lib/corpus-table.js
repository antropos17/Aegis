'use strict';
const safe = (value) => {
  const text = String(value);
  if (!/^[A-Za-z0-9_.:/ -]+$/.test(text)) throw new Error('corpus-table-invalid');
  return text;
};
const fact = (value) =>
  value === null || value === undefined
    ? 'unknown'
    : typeof value === 'boolean' || Number.isSafeInteger(value) || typeof value === 'string'
      ? safe(value)
      : 'unknown';
function loopback(row) {
  if (row.state !== 'recorded') return safe(row.state);
  if (!row.sender) return 'control-unavailable';
  return `write=${fact(row.sender.writeFinished)} bytes=${fact(row.sender.sentBytes)}; receiver-exact=${fact(row.receiver.exact)} verified=${fact(row.receiver.verifiedCount)} reason=${row.receiver.reason === null ? 'none-recorded' : fact(row.receiver.reason)}`;
}
function read(row) {
  if (row.state !== 'recorded') return safe(row.state);
  return `${safe(row.status)} bytes=${fact(row.readBytes)} hash=${fact(row.readSha256)} progress-known=${fact(row.progressKnown)} reason=${row.reason === null ? 'none-recorded' : fact(row.reason)} closed=${fact(row.closure.closed)}`;
}
/**
 * Render only safe projected fields, excluding raw artifact payload/provenance.
 * @param {object} report Sanitized corpus-results report.
 * @returns {string} Deterministic Markdown.
 * @since unreleased
 */
function renderCorpusTable(report) {
  const lines = [
    '# Recorded synthetic corpus results',
    '',
    `Report label: ${safe(report.asOf)}. Scope: synthetic-corpus-results.`,
    '',
    'Artifact and step observations only. Capture assessment: not-assessed. Oracle admission, sensor scoring and ATT&CK mapping: not-performed. measurementAccepted=false; w8Accepted=false.',
    '',
    'Current definitions are inventory only; executedDefinitionMatch=unverified for every attempt. No metrics, rates or measurement acceptance are derived.',
    '',
    '| Inventory scenario | Status | Supplied attempts | Current definition SHA-256 |',
    '| --- | --- | ---: | --- |',
  ];
  for (const row of report.inventory)
    lines.push(
      `| ${safe(row.scenario)} | ${safe(row.status)} | ${fact(row.suppliedAttempts)} | ${safe(row.currentDefinitionSha256)} |`,
    );
  lines.push(
    '',
    '| Scenario | Run | Arm | Artifact state | Steps ok / failed / skipped | Expected categories | Loopback sender and receiver | File read |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const row of report.attempts) {
    const steps = row.steps
      ? `${fact(row.steps.ok)} / ${fact(row.steps.failed)} / ${fact(row.steps.skipped)}`
      : 'unknown';
    const categories = row.expected
      ? row.expected.byCategory
          .map((item) => `${safe(item.category)}/${safe(item.type)}=${fact(item.count)}`)
          .join('; ') || 'recorded-empty'
      : 'missing';
    lines.push(
      `| ${safe(row.scenario)} | ${safe(row.runId)} | ${safe(row.arm)} | ${safe(row.artifactState)} | ${steps} | ${categories} | ${loopback(row.loopback)} | ${read(row.read)} |`,
    );
  }
  lines.push(
    '',
    'Failed, skipped, incomplete and unconfirmed receiver observations remain visible. A recorded artifact set or all-ok steps do not establish capture/run success.',
    '',
    'Reporter source bytes:',
    '',
  );
  for (const file of report.reportImplementation.files)
    lines.push(`- ${safe(file.file)}: ${safe(file.sha256)}`);
  return lines.join('\n') + '\n';
}
module.exports = { renderCorpusTable };
