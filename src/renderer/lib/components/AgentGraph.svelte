<script>
  /**
   * @file AgentGraph.svelte
   * @description Force-directed agent relationship graph.
   *   D3 for simulation only, Svelte {#each} for SVG rendering.
   *   Nodes = agents (sized by risk, colored by trust).
   *   Links = shared files or network endpoints.
   * @since v0.4.0
   */
  import { onMount } from 'svelte';
  import { agents, events, network } from '../stores/ipc.js';
  import { buildGraphData, resolveGradeColors } from '../utils/agent-graph-utils.ts';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let width = $state(600);
  let height = $state(400);
  let svgEl = $state();
  let loading = $state(true);

  /** @type {import('../utils/agent-graph-utils.ts').GraphNode[]} */
  let nodes = $state([]);
  /** @type {import('../utils/agent-graph-utils.ts').GraphLink[]} */
  let links = $state([]);
  /** @type {string | null} */
  let hoveredNode = $state(null);
  /** @type {string | null} */
  let selectedNode = $state(null);
  let simulationRunning = $state(false);

  /** @type {any} D3 simulation reference */
  let simulation = null;
  /** @type {any} D3 module */
  let d3Module = null;
  /** @type {Record<import('../../../shared/types').TrustGrade, string>} */
  let gradeColors = $state(/** @type {any} */ ({}));
  /** @type {ReturnType<typeof setTimeout> | null} Debounce timer for simulation rebuild */
  let rebuildTimer = null;

  /**
   * Resolved links with x/y coordinates from simulation
   * @type {Array<{source: import('../utils/agent-graph-utils.ts').GraphNode, target: import('../utils/agent-graph-utils.ts').GraphNode, type: string, weight: number}>}
   */
  let resolvedLinks = $state([]);

  onMount(async () => {
    gradeColors = resolveGradeColors();
    d3Module = await import('d3');
    loading = false;
    return () => {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      if (simulation) {
        simulation.stop();
        simulation = null;
      }
    };
  });

  /** Rebuild graph when agents/events change (debounced 200ms) */
  $effect(() => {
    if (!active || !d3Module) return;
    const agentList = $agents;
    const fileEvs = $events.flat();
    const netConns = $network;

    if (agentList.length === 0) {
      nodes = [];
      links = [];
      resolvedLinks = [];
      return;
    }

    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      const data = buildGraphData(agentList, fileEvs, netConns, gradeColors);
      runSimulation(data.nodes, data.links);
    }, 200);
  });

  /**
   * Start or restart D3 force simulation
   * @param {import('../utils/agent-graph-utils.ts').GraphNode[]} newNodes
   * @param {import('../utils/agent-graph-utils.ts').GraphLink[]} newLinks
   */
  function runSimulation(newNodes, newLinks) {
    if (!d3Module) return;

    if (simulation) simulation.stop();

    const d3 = d3Module;
    const cx = width / 2;
    const cy = height / 2;

    const simNodes = newNodes.map((n) => ({
      ...n,
      x: n.x ?? cx + (Math.random() - 0.5) * 100,
      y: n.y ?? cy + (Math.random() - 0.5) * 100,
    }));

    const simLinks = newLinks.map((l) => ({
      source: l.source,
      target: l.target,
      type: l.type,
      weight: l.weight,
      resource: l.resource,
    }));

    simulation = d3
      .forceSimulation(simNodes)
      .force(
        'link',
        d3
          .forceLink(simLinks)
          .id((d) => d.id)
          .distance(80),
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(cx, cy))
      .force(
        'collision',
        d3.forceCollide().radius((d) => d.radius + 4),
      )
      .alphaDecay(0.02)
      .on('tick', () => {
        simulationRunning = true;
        nodes = [...simNodes];
        resolvedLinks = simLinks.map((l) => ({
          source: typeof l.source === 'object' ? l.source : findNode(l.source),
          target: typeof l.target === 'object' ? l.target : findNode(l.target),
          type: l.type,
          weight: l.weight,
        }));
      })
      .on('end', () => {
        simulationRunning = false;
      });
  }

  /**
   * Find node by id
   * @param {string} id
   */
  function findNode(id) {
    return (
      nodes.find((n) => n.id === id) || {
        id,
        label: id,
        riskScore: 0,
        trustGrade: 'C',
        category: '',
        radius: 5,
        color: gradeColors['C'] || 'currentColor',
      }
    );
  }

  /**
   * Check if link connects to hovered node
   * @param {{ source: { id: string }, target: { id: string } }} link
   */
  function isLinkHighlighted(link) {
    if (!hoveredNode) return false;
    return link.source.id === hoveredNode || link.target.id === hoveredNode;
  }

  /**
   * Check if node is connected to hovered node
   * @param {string} nodeId
   */
  function isNodeConnected(nodeId) {
    if (!hoveredNode) return true;
    if (nodeId === hoveredNode) return true;
    return resolvedLinks.some(
      (l) =>
        (l.source.id === hoveredNode && l.target.id === nodeId) ||
        (l.target.id === hoveredNode && l.source.id === nodeId),
    );
  }

  /** @param {string} id */
  function handleNodeEnter(id) {
    hoveredNode = id;
  }

  function handleNodeLeave() {
    hoveredNode = null;
  }

  /** @param {string} id */
  function handleNodeClick(id) {
    selectedNode = selectedNode === id ? null : id;
  }

  /** Selected node detail */
  let selectedDetail = $derived(selectedNode ? nodes.find((n) => n.id === selectedNode) : null);
</script>

<div class="agent-graph-wrap" bind:clientWidth={width}>
  <div class="graph-header">
    <span class="graph-title">Agent Relations</span>
    <span class="graph-count">{nodes.length} agents</span>
    {#if simulationRunning}
      <span class="sim-indicator"></span>
    {/if}
  </div>

  {#if loading}
    <div class="loading-indicator">Loading graph…</div>
  {/if}
  <svg bind:this={svgEl} {width} {height} viewBox="0 0 {width} {height}" class="graph-svg">
    <!-- Links -->
    {#each resolvedLinks as link, i (i)}
      <line
        x1={link.source.x ?? 0}
        y1={link.source.y ?? 0}
        x2={link.target.x ?? 0}
        y2={link.target.y ?? 0}
        class="graph-link"
        class:highlighted={isLinkHighlighted(link)}
        class:dimmed={hoveredNode !== null && !isLinkHighlighted(link)}
        class:link-file={link.type === 'file'}
        class:link-network={link.type === 'network'}
        stroke-width={Math.max(1, Math.min(4, link.weight))}
      />
    {/each}

    <!-- Nodes -->
    {#each nodes as node (node.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <g
        class="graph-node"
        class:dimmed={hoveredNode !== null && !isNodeConnected(node.id)}
        class:selected={selectedNode === node.id}
        transform="translate({node.x ?? 0}, {node.y ?? 0})"
        onmouseenter={() => handleNodeEnter(node.id)}
        onmouseleave={handleNodeLeave}
        onclick={() => handleNodeClick(node.id)}
      >
        <!-- Glow for high risk -->
        {#if node.riskScore > 60}
          <circle r={(node.radius || 5) + 6} fill={node.color || 'currentColor'} opacity="0.15" />
        {/if}

        <!-- Main circle -->
        <circle
          r={node.radius || 5}
          fill={node.color || 'currentColor'}
          stroke="var(--md-sys-color-surface-container-low)"
          stroke-width="2"
          class="node-circle"
        />

        <!-- Label -->
        <text y={(node.radius || 5) + 14} text-anchor="middle" class="node-label">
          {node.label}
        </text>

        <!-- Trust grade badge -->
        <text y={4} text-anchor="middle" class="node-grade">
          {node.trustGrade}
        </text>
      </g>
    {/each}
  </svg>

  {#if selectedDetail}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="node-detail" onclick={() => (selectedNode = null)}>
      <span class="detail-name">{selectedDetail.label}</span>
      <span class="detail-badge" style="background:{selectedDetail.color}">
        {selectedDetail.trustGrade}
      </span>
      <span class="detail-risk">Risk: {selectedDetail.riskScore}</span>
      <span class="detail-cat">{selectedDetail.category}</span>
    </div>
  {/if}
</div>

<style>
  .agent-graph-wrap {
    width: 100%;
    box-sizing: border-box;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--aegis-card-border);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.12),
      var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    overflow: hidden;
  }

  .loading-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 400px;
    color: var(--md-sys-color-on-surface-variant);
    font: var(--md-sys-typescale-label-medium);
    opacity: 0.5;
  }

  .graph-header {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-3) var(--aegis-space-6);
  }

  .graph-title {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .graph-count {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.6;
  }

  .sim-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--md-sys-color-primary);
    animation: pulse 1s infinite;
    margin-left: auto;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  .graph-svg {
    display: block;
    cursor: grab;
  }

  .graph-svg:active {
    cursor: grabbing;
  }

  /* Links */
  .graph-link {
    stroke: var(--md-sys-color-on-surface-variant);
    opacity: 0.3;
    transition: opacity 150ms ease;
  }

  .graph-link.link-file {
    stroke: var(--md-sys-color-secondary);
    stroke-dasharray: 4 3;
  }

  .graph-link.link-network {
    stroke: var(--md-sys-color-primary);
  }

  .graph-link.highlighted {
    opacity: 0.8;
    stroke-width: 2.5;
  }

  .graph-link.dimmed {
    opacity: 0.08;
  }

  /* Nodes */
  .graph-node {
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .graph-node.dimmed {
    opacity: 0.25;
  }

  .graph-node.selected .node-circle {
    stroke: var(--md-sys-color-primary);
    stroke-width: 3;
  }

  .node-circle {
    transition: filter 100ms ease;
  }

  .graph-node:hover .node-circle {
    filter: brightness(1.3) drop-shadow(0 0 4px currentColor);
  }

  .node-label {
    fill: var(--md-sys-color-on-surface);
    font: var(--md-sys-typescale-label-medium);
    font-size: calc(9px * var(--aegis-ui-scale, 1));
    pointer-events: none;
  }

  .node-grade {
    fill: var(--md-sys-color-surface);
    font-family: 'DM Mono', monospace;
    font-size: calc(8px * var(--aegis-ui-scale, 1));
    font-weight: 700;
    pointer-events: none;
  }

  /* Detail panel */
  .node-detail {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    padding: var(--aegis-space-3) var(--aegis-space-6);
    background: var(--md-sys-color-surface-container);
    border-top: 1px solid var(--md-sys-color-outline);
    cursor: pointer;
    font: var(--md-sys-typescale-label-medium);
  }

  .detail-name {
    color: var(--md-sys-color-on-surface);
    font-weight: 600;
  }

  .detail-badge {
    color: var(--md-sys-color-surface);
    font-family: 'DM Mono', monospace;
    font-weight: 700;
    font-size: calc(9px * var(--aegis-ui-scale, 1));
    padding: 1px 6px;
    border-radius: var(--md-sys-shape-corner-small);
  }

  .detail-risk {
    color: var(--md-sys-color-on-surface-variant);
    font-family: 'DM Mono', monospace;
  }

  .detail-cat {
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.6;
    margin-left: auto;
  }
</style>
