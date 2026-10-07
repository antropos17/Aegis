<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import { record } from '../runtime/host';
  import {
    localEvidence,
    mcpDeclarations,
    reviewRows,
    reviewAdapters,
    reviewModes,
    type LocalReview,
  } from '../runtime/local-security';
  import SectionNavigation from './SectionNavigation.svelte';
  import LocalSecurityRows from './LocalSecurityRows.svelte';
  import Metadata from './Metadata.svelte';
  import Icon from './Icon.svelte';
  let {
    review,
    pending,
    preview,
    savedAcceptance,
    action,
  }: {
    review: LocalReview;
    pending: boolean;
    preview: boolean;
    savedAcceptance: boolean;
    action: (_name: 'export' | 'save-snapshot' | 'accept') => Promise<void>;
  } = $props();
  const prefix = $props.id();
  let selected = $state(
    untrack(() =>
      review.mode === 'inventory' ? 'files' : review.mode === 'compare' ? 'changes' : 'findings',
    ),
  );
  let acknowledge = $state(false);
  const rows = $derived({
    findings: reviewRows(review.report, 'findings'),
    files: reviewRows(review.report, 'files'),
    packages: reviewRows(review.report, 'packages'),
    changes: reviewRows(review.report, 'changes'),
    tools: reviewRows(review.report, 'tools'),
    coverage: reviewRows(review.report, 'coverage'),
  });
  const local = $derived(localEvidence(review.report));
  const declarations = $derived(mcpDeclarations(review.report));
  const inventory = $derived(
    Object.keys(record(review.report.inventory)).length ? record(review.report.inventory) : local,
  );
  const complete = $derived(
    review.report.complete === true && record(review.report.catalog).complete !== false,
  );
  const tabs = $derived([
    ...(review.mode === 'scan' || review.mode === 'import'
      ? [{ id: 'findings', label: 'Findings', icon: 'shield', count: rows.findings.length }]
      : []),
    { id: 'files', label: 'Files', icon: 'file', count: rows.files.length },
    ...(rows.packages.length
      ? [{ id: 'packages', label: 'Packages', icon: 'database', count: rows.packages.length }]
      : []),
    ...(rows.tools.length
      ? [{ id: 'tools', label: 'MCP tools', icon: 'network', count: rows.tools.length }]
      : []),
    ...(declarations.length
      ? [
          {
            id: 'declarations',
            label: 'MCP declarations',
            icon: 'network',
            count: declarations.length,
          },
        ]
      : []),
    ...(review.mode === 'compare'
      ? [{ id: 'changes', label: 'Changes', icon: 'history', count: rows.changes.length }]
      : []),
    { id: 'coverage', label: 'Scope & coverage', icon: 'clipboard', count: rows.coverage.length },
  ]);
  const status = $derived(
    review.mode === 'inventory'
      ? 'Inventory recorded'
      : review.mode === 'compare'
        ? review.report.status === 'incompatible'
          ? 'Incompatible snapshot'
          : review.report.contentUnchanged === true
            ? 'Observed content unchanged'
            : 'Review changes'
        : rows.findings.length
          ? 'Findings need review'
          : 'No patterns found in the checked subset',
  );
  const nextSection = $derived(
    review.mode === 'compare' && review.report.status !== 'incompatible'
      ? 'changes'
      : (review.mode === 'scan' || review.mode === 'import') && rows.findings.length
        ? 'findings'
        : 'coverage',
  );
  const nextStep = $derived(
    nextSection === 'findings'
      ? 'Check the flagged items before using these files.'
      : nextSection === 'changes'
        ? 'Compare the recorded changes and review any coverage gaps.'
        : review.mode === 'inventory'
          ? 'Review recorded files and coverage before saving a snapshot.'
          : 'Review what was not checked before deciding whether to use these files.',
  );
  async function inspectSection(section: string) {
    selected = section;
    await tick();
    const control = document.getElementById(prefix + '-section-link-' + section);
    if (control && !control.closest('[hidden], [inert]')) control.focus({ preventScroll: true });
  }
</script>

<section class="panel review-output" tabindex="-1" aria-label={$t('Local review results')}>
  <div class="panel-head result-heading">
    <div>
      <h2><Icon name="shield" />{$t(status)}</h2>
      <p class="muted">
        {$t(reviewModes.find((item) => item.id === review.mode)?.label ?? review.mode)} · {$t(
          reviewAdapters.find((item) => item.id === review.adapter)?.label ?? review.adapter,
        )}
      </p>
    </div>
    <button class="button" disabled={pending || preview} onclick={() => action('export')}
      ><Icon name="download" />{$t('Export JSON')}</button
    >
  </div>
  <div class="result-intro">
    <div class="next-step">
      <p>{$t(nextStep)}</p>
      <button class="button" onclick={() => inspectSection(nextSection)}
        >{$t(
          nextSection === 'findings'
            ? 'Review findings'
            : nextSection === 'changes'
              ? 'Review changes'
              : 'Review coverage',
        )}</button
      >
    </div>
    <div class="source"><Icon name="folder" /><span>{review.directory}</span></div>
    <p class="muted">
      {new Date(review.createdAt).toLocaleString()} · {$t(
        preview ? 'Simulated result' : 'Local review',
      )}
    </p>
    <div class="result-totals" aria-label={$t('Review summary')}>
      {#if review.mode === 'scan' || review.mode === 'import'}
        <span><strong>{rows.findings.length}</strong>{$t('findings')}</span>
      {:else if review.mode === 'compare'}
        <span><strong>{rows.changes.length}</strong>{$t('recorded changes')}</span>
      {:else}
        <span><strong>{rows.packages.length}</strong>{$t('packages recorded')}</span>
      {/if}
      <span><strong>{rows.files.length}</strong>{$t('files recorded')}</span>
      <span><strong>{rows.coverage.length}</strong>{$t('coverage notices')}</span>
    </div>
    <p class="scope-note">
      <Icon name="eye" />{#if review.mode === 'inventory' || review.mode === 'compare'}
        {$t(
          'Fingerprints record observed content. They do not verify the publisher, installation or safe behavior.',
        )}
      {:else}{$t(
          'Heuristic findings require review. A result with no findings does not establish safety. Nothing is automatically blocked.',
        )}{/if}
    </p>
    <div class="status-line">
      <span class="badge">{$t(complete ? 'Declared scope collected' : 'Incomplete coverage')}</span>
      <span class="muted">{$t('Safety not determined')}</span>
    </div>
    {#if review.mode === 'compare' && review.report.status === 'incompatible'}<p class="scope-note">
        {$t(
          'The selected directory, profile or MCP source differs from the baseline. These snapshots cannot establish changes.',
        )}
      </p>{/if}
    {#if review.mode === 'import'}<p class="scope-note">
        {$t(
          'External claims are unverified. Scanner execution was not observed. Source matching and any baseline comparison are shown with the evidence.',
        )}
      </p>{/if}
    {#if rows.coverage.length || !complete}
      <section class="coverage-preview" aria-label={$t('Coverage summary')}>
        <div class="coverage-heading">
          <h3>{$t('Scope & coverage')}</h3>
          <button class="button" onclick={() => inspectSection('coverage')}
            >{$t('Review scope and coverage')}</button
          >
        </div>
        {#if rows.coverage.length}
          <p class="muted">
            {$t('First {shown} of {total} coverage notices.', {
              shown: Math.min(3, rows.coverage.length),
              total: rows.coverage.length,
            })}
          </p>
          <ul>
            {#each rows.coverage.slice(0, 3) as row (row)}
              <li>{row.title} · {row.subtitle}</li>
            {/each}
          </ul>
        {:else}
          <p>
            {$t(
              'No itemized coverage notices were returned. The captured review is still incomplete.',
            )}
          </p>
        {/if}
      </section>
    {/if}
  </div>
  {#snippet mcpDeclarationContent()}
    <section class="mcp-declarations" aria-label={$t('MCP configuration declarations')}>
      <h3>{$t('MCP configuration declarations')}</h3>
      <p class="muted">
        {$t(
          'These are static counts from selected config files. Effective settings and live MCP connections were not checked.',
        )}
      </p>
      <ul>
        {#each declarations as declaration, index (declaration.path + ':' + index)}
          <li>
            <strong class="config-path">{declaration.path}</strong>
            <span class="muted">{$t(declaration.provider)} · {$t(declaration.scope)}</span>
            {#if declaration.servers === null}
              <p class="muted">
                {$t(
                  declaration.parsed
                    ? 'MCP declaration count unavailable in this result.'
                    : 'Config parse unavailable; MCP declaration count unavailable.',
                )}
              </p>
            {:else}
              <p>{$t('Declared MCP servers')}: <strong>{declaration.servers}</strong></p>
            {/if}
            {#if declaration.projectScopedServers !== null}
              <p>
                {$t('Project-local MCP servers')}:
                <strong>{declaration.projectScopedServers}</strong>
              </p>
            {/if}
            {#if declaration.provider === 'Gemini CLI'}
              {#if declaration.gemini}
                <p>
                  {$t('Gemini trust flags: {yes} true, {no} false.', {
                    yes: declaration.gemini.trustTrue,
                    no: declaration.gemini.trustFalse,
                  })}
                </p>
                <p>
                  {$t('Global MCP filters: allowed {allowed}, excluded {excluded}.', {
                    allowed: declaration.gemini.allowed ?? $t('not declared'),
                    excluded: declaration.gemini.excluded ?? $t('not declared'),
                  })}
                </p>
                <p>
                  {$t(
                    'Tool filters: include {includeLists} lists / {includeEntries} entries; exclude {excludeLists} lists / {excludeEntries} entries.',
                    {
                      includeLists: declaration.gemini.includeLists,
                      includeEntries: declaration.gemini.includeEntries,
                      excludeLists: declaration.gemini.excludeLists,
                      excludeEntries: declaration.gemini.excludeEntries,
                    },
                  )}
                </p>
              {:else if declaration.parsed}<p class="muted">
                  {$t('Gemini trust and filter counts unavailable in this result.')}
                </p>{/if}
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/snippet}
  <div class="result-layout">
    <div class="result-evidence">
      {#each tabs as tab (tab.id)}
        <div
          class="result-section"
          hidden={selected !== tab.id}
          role="region"
          id={prefix + '-panel-' + tab.id}
          aria-labelledby={prefix + '-section-link-' + tab.id}
          tabindex="-1"
        >
          {#if tab.id === 'declarations'}
            {@render mcpDeclarationContent()}
          {:else}
            <LocalSecurityRows
              rows={rows[tab.id as keyof typeof rows]}
              empty={tab.id === 'findings'
                ? 'No findings in the checked subset. Review Scope & coverage for limits.'
                : tab.id === 'changes'
                  ? review.report.status === 'incompatible'
                    ? 'No comparable change list is available.'
                    : 'No recorded changes in the comparable observations.'
                  : tab.id === 'coverage'
                    ? 'No collection issues were reported for the declared scope. This is not a safety assessment.'
                    : 'No matching files were observed in this scope.'}
            />
          {/if}
          {#if tab.id === 'coverage'}
            <details class="scope-details">
              <summary>{$t('Checked scope and limits')}</summary>
              <Metadata
                value={{
                  Profile: review.adapter,
                  Scope: local.scope ?? inventory.scope,
                  Limits: local.limits ?? inventory.limits,
                  Usage: local.usage ?? inventory.usage,
                  'Rule set': local.ruleSet,
                  'MCP catalog': record(local.mcpCatalog).summary ?? record(review.report.catalog),
                  'External source': record(review.report.external).source,
                  'External baseline': record(review.report.external).baseline,
                  'Snapshot comparison':
                    review.mode === 'compare'
                      ? {
                          status: review.report.status,
                          baselineDigest: review.report.baselineDigest,
                          currentDigest: review.report.currentDigest,
                          baselineState: review.report.baselineState,
                        }
                      : undefined,
                }}
              />
            </details>
            {#if review.mode === 'scan' || review.mode === 'import'}<p class="muted">
                {$t(
                  'Checks cover bounded commands, selected JavaScript/Python value flows, shell redirections and four English instruction patterns. General instruction meaning, complex control flow and runtime behavior remain outside this analysis.',
                )}
              </p>{/if}
          {/if}
        </div>
      {/each}
    </div>
    <aside class="result-context" aria-label={$t('Local review sections')}>
      <SectionNavigation
        {tabs}
        {selected}
        {prefix}
        controls
        change={(id) => {
          selected = id;
        }}
        label="Local review sections"
      />
      {#if review.snapshot}<div class="snapshot-actions">
          <section aria-label={$t('Content snapshot')}>
            <h3>{$t('Content snapshot')}</h3>
            <p class="muted">
              {$t(
                'Save an unreviewed snapshot for later comparison. Acceptance requires a fresh matching capture and records your decision about these exact bytes.',
              )}
            </p>
            <dl>
              <dt>{$t('Reviewed digest')}</dt>
              <dd>{review.snapshot.digest}</dd>
              <dt>{$t('State')}</dt>
              <dd>{savedAcceptance ? $t('Accepted copy saved') : review.snapshot.state}</dd>
            </dl>
            <div class="toolbar">
              {#if review.canSaveSnapshot}<button
                  class="button"
                  disabled={pending || preview}
                  onclick={() => action('save-snapshot')}
                  ><Icon name="download" />{$t('Save unreviewed snapshot')}</button
                >{/if}
            </div>
            {#if review.snapshot.canAccept && !savedAcceptance}
              <label class="acknowledge"
                ><input
                  type="checkbox"
                  bind:checked={acknowledge}
                  disabled={pending || preview}
                />{$t('I reviewed the listed content and the displayed digest.')}</label
              >
              <button
                class="button"
                disabled={!acknowledge || pending || preview}
                onclick={() => action('accept')}
                ><Icon name="check" />{$t('Recheck and save accepted copy')}</button
              >
            {:else if !savedAcceptance}<p class="muted">
                {$t(
                  'Acceptance is unavailable for incomplete, changed or already accepted snapshots.',
                )}
              </p>{/if}
          </section>
        </div>{/if}
    </aside>
  </div>
</section>

<style>
  .review-output {
    min-width: 0;
    container-type: inline-size;
  }
  .result-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px;
    gap: var(--space-3);
    padding: var(--panel-inset);
    border-top: 1px solid var(--border);
    align-items: start;
  }
  .result-evidence,
  .result-context {
    min-width: 0;
  }
  .result-context {
    background: var(--bg);
    padding: var(--space-3);
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
  }
  .snapshot-actions h3 {
    font-size: var(--text-body);
    margin: var(--space-3) 0 var(--space-2);
  }
  .result-context button {
    max-width: 100%;
    white-space: normal;
  }
  @container (max-width: 500px) {
    .result-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .result-context {
      grid-row: 1;
    }
  }
  .next-step {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .next-step p {
    flex: 1;
    min-width: min(100%, 240px);
  }
  .next-step button {
    white-space: normal;
  }
  .result-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .result-heading h2 {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .result-heading p,
  .result-intro p {
    margin: var(--space-2) 0;
  }
  .result-intro {
    padding: var(--panel-inset);
  }
  .result-section {
    padding: 0;
    min-width: 0;
  }
  .mcp-declarations h3 {
    margin: 0;
  }
  .mcp-declarations > p {
    margin: var(--space-2) 0 var(--space-3);
  }
  .mcp-declarations ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .mcp-declarations li {
    display: grid;
    gap: var(--space-1);
    border-top: 1px solid var(--border);
    padding: var(--space-3) 0;
    min-width: 0;
  }
  .mcp-declarations li p {
    margin: 0;
  }
  .config-path {
    overflow-wrap: anywhere;
  }
  .source,
  .scope-note,
  .status-line {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .source {
    overflow-wrap: anywhere;
  }
  .source span {
    min-width: 0;
  }
  .scope-note {
    line-height: 1.6;
    color: var(--muted);
  }
  .result-totals {
    display: flex;
    gap: var(--space-5);
    flex-wrap: wrap;
    margin: var(--space-4) 0;
  }
  .result-totals span {
    display: grid;
    gap: var(--space-1);
    color: var(--muted);
  }
  .result-totals strong {
    font-size: var(--text-metric);
    color: var(--text);
    font-weight: 600;
  }
  .status-line {
    align-items: center;
    flex-wrap: wrap;
  }
  .result-section[hidden] {
    display: none;
  }
  .coverage-preview {
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
    margin-top: var(--space-3);
  }
  .coverage-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
  }
  .coverage-heading h3 {
    font-size: var(--text-body);
    margin: 0;
  }
  .coverage-heading button {
    white-space: normal;
  }
  .coverage-preview ul {
    display: grid;
    gap: var(--space-2);
    padding-inline-start: var(--space-4);
    margin: var(--space-2) 0 0;
  }
  .coverage-preview li {
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .snapshot-actions {
    border-top: 1px solid var(--border);
  }
  .scope-details {
    margin-top: var(--space-3);
  }
  summary {
    cursor: pointer;
    padding: var(--space-2) 0;
    font-weight: 600;
  }
  dd {
    overflow-wrap: anywhere;
    margin: var(--space-1) 0 var(--space-3);
    font-family: var(--mono);
  }
  .acknowledge {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    margin: var(--space-3) 0;
  }
  .acknowledge input {
    flex: 0 0 auto;
  }
  .toolbar {
    flex-wrap: wrap;
  }
</style>
