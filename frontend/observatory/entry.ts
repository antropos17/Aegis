import { mount } from 'svelte';
import App from './App.svelte';
import type { Host } from './runtime/host';
import './styles';

if (__FRONTEND_PREVIEW__) {
  const { mountPreview } = await import('./runtime/preview');
  await mountPreview();
} else {
  const host = (window as unknown as { aegis?: Host }).aegis ?? null;
  mount(App, {
    target: document.getElementById('app')!,
    props: { host },
  });
}
