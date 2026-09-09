import { mount } from 'svelte';
import App from '../App.svelte';
import { createPreviewHost } from '../demo/host';
/** Mount the shared interface with isolated fixtures. @returns Completion @since 0.14.1 */
export async function mountPreview(): Promise<void> {
  mount(App, {
    target: document.getElementById('app')!,
    props: { host: createPreviewHost(), preview: true },
  });
}
