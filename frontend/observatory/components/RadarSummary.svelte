<script lang="ts">
  import { riskBand, type RadarGroup } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    group,
    ordinal,
    selected,
    select,
  }: {
    group: RadarGroup;
    ordinal: number;
    selected: string | null;
    select: (group: RadarGroup) => void;
  } = $props();
  let chosen = $derived(group.members.some((a) => !!selected && a.instanceId === selected));
</script>

<button class="radar-agent-card" aria-pressed={chosen} onclick={() => select(group)}>
  <span class="roster-number" aria-hidden="true">{ordinal}</span>
  <AgentLogo id={group.key} name={group.name} size={24} />
  <span class="roster-identity"
    ><strong>{group.name}</strong><small
      >{group.members.length} {group.members.length === 1 ? 'process' : 'processes'}</small
    ></span
  >
  <span class={`roster-risk ${riskBand(group.risk)}`} title="Highest process risk"
    >{group.risk}<small>risk</small></span
  >
  <Icon name="chevron" />
</button>
