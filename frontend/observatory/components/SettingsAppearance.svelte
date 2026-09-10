<script lang="ts">
  import type { RecordData } from '../runtime/host';
  import SettingsGroup from './SettingsGroup.svelte';
  let {
    form = $bindable(),
    contrast = $bindable(),
    motion = $bindable(),
  }: { form: RecordData; contrast: boolean; motion: boolean } = $props();
</script>

<SettingsGroup
  title="Display & accessibility"
  description="Theme, scale and motion preview immediately. Save to keep them; discard to restore your saved preferences."
>
  <label class="setting"
    ><span>Theme<small>Choose a light, dark or high-contrast interface.</small></span><select
      aria-label="Theme"
      value={(form.darkMode ? 'dark' : 'light') + (contrast ? '-hc' : '')}
      onchange={(e) => {
        const theme = e.currentTarget.value;
        form.darkMode = theme.startsWith('dark');
        contrast = theme.endsWith('-hc');
        document.documentElement.dataset.theme = theme;
      }}
      ><option value="dark">Dark</option><option value="light">Light</option><option value="dark-hc"
        >Dark, high contrast</option
      ><option value="light-hc">Light, high contrast</option></select
    ></label
  >
  <label class="setting range"
    ><span
      >Scale <output
        >{Number.isFinite(Number(form.uiScale ?? 1))
          ? Math.round(Number(form.uiScale ?? 1) * 100) + '%'
          : '\u2014'}</output
      ></span
    ><input
      aria-label="Interface scale"
      type="range"
      min="0.8"
      max="1.5"
      step="0.05"
      value={Number(form.uiScale ?? 1)}
      oninput={(e) => {
        form.uiScale = Number(e.currentTarget.value);
        document.documentElement.style.setProperty('--ui-scale', String(form.uiScale));
      }}
    /></label
  >
  <div class="setting">
    <span
      >Exact scale<small
        >Percentage of the default size. 80-150% is recommended for this layout.</small
      ></span
    >
    <input
      class="scale-number"
      aria-label="Interface scale percent"
      aria-invalid={!Number.isFinite(Number(form.uiScale ?? 1)) ||
        Number(form.uiScale ?? 1) < 0.5 ||
        Number(form.uiScale ?? 1) > 3}
      type="number"
      min="50"
      max="300"
      step="1"
      value={Number(form.uiScale ?? 1) * 100}
      oninput={(event) => {
        const value = event.currentTarget.valueAsNumber / 100;
        form.uiScale = value;
        if (Number.isFinite(value) && value >= 0.5 && value <= 3)
          document.documentElement.style.setProperty('--ui-scale', String(value));
      }}
    />
  </div>
  <div class="presets" role="group" aria-label="Scale presets">
    {#each [1, 1.25, 1.5] as value (value)}<button
        class="button"
        aria-pressed={Number(form.uiScale ?? 1) === value}
        onclick={() => {
          form.uiScale = value;
          document.documentElement.style.setProperty('--ui-scale', String(value));
        }}>{Math.round(value * 100)}%</button
      >{/each}
  </div>
  <label class="setting"
    ><span
      >Animations<small
        >Radar motion and visual feedback. Reduced motion keeps the data available.</small
      ></span
    ><input
      aria-label="Animations"
      type="checkbox"
      bind:checked={motion}
      onchange={(event) => {
        document.documentElement.dataset.motion = event.currentTarget.checked ? 'full' : 'reduce';
      }}
    /></label
  >
  <div class="setting">
    <span>Language<small>English interface</small></span><span class="badge">English</span>
  </div>
</SettingsGroup>

<style>
  .scale-number {
    width: 110px;
    min-width: 0;
  }
</style>
