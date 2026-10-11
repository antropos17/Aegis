<script lang="ts">
  import Radar from '../components/Radar.svelte';
  import { emptyTelemetry, type Telemetry } from '../runtime/host';
  import { language } from '../runtime/i18n';
  language.set('en');

  const agents = Array.from({ length: 5 }, (_, index) => ({
    agent: index === 0 ? 'Agent 1 with an unusually long product name' : `Agent ${index + 1}`,
    process: 'agent.exe',
    pid: index + 1,
    instanceId: `${index + 1}:fixture`,
    instanceIdSource: 'os' as const,
  }));
  let telemetry: Telemetry = $state({ ...emptyTelemetry(), ready: true, stale: false, agents });
  let selected = $state<string | null>(null);
</script>

<button
  class="button"
  onclick={() =>
    (telemetry = {
      ...telemetry,
      network: [],
      events: [
        {
          ...agents[0],
          timestamp: Date.now(),
          file: 'X:/fixture/key',
          sensitive: true,
          reason: 'SSH',
        },
      ],
    })}>Update fixture</button
>
<Radar {telemetry} bind:selected inspect={() => {}} />
<button
  class="button"
  onclick={() =>
    (telemetry = {
      ...telemetry,
      events: agents.flatMap((agent) =>
        Array.from({ length: 30 }, (_, index) => ({
          ...agent,
          timestamp: Date.now(),
          file: `X:/fixture/key-${index}`,
          sensitive: true,
          reason: 'SSH',
        })),
      ),
      network: agents.flatMap((agent) =>
        Array.from({ length: 20 }, (_, index) => ({
          ...agent,
          remoteIp: `203.0.113.${index + 1}`,
          remotePort: 80,
          flagged: true,
          domain: 'fixture.invalid',
          httpUnencrypted: true,
        })),
      ),
    })}>High risk fixture</button
>
<button class="button" onclick={() => language.set('pt')}>Portuguese fixture</button>
