import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Icon from '../../../frontend/observatory/components/Icon.svelte';
import { icons } from '../../../frontend/observatory/runtime/icons';
import { workspaces } from '../../../frontend/observatory/runtime/navigation';
import { guidedTasks, moreTasks } from '../../../frontend/observatory/runtime/task-guide';
import { tablerPaths } from '../../../frontend/observatory/vendor/tabler-icons';
import provenance from '../../../frontend/observatory/vendor/tabler-icons.provenance.json';

describe('curated navigation icons', () => {
  it('gives every destination a distinct licensed shape and consistent task symbol', () => {
    const shapes = workspaces.map((workspace) => {
      expect(Object.hasOwn(tablerPaths, workspace.icon), workspace.id).toBe(true);
      return JSON.stringify(icons[workspace.icon]);
    });
    expect(new Set(shapes).size).toBe(workspaces.length);
    for (const task of [...guidedTasks, ...moreTasks])
      expect(task.icon, task.title).toBe(workspaces.find((item) => item.id === task.target)?.icon);
  });

  it('retains only bounded static path geometry with exact upstream provenance', () => {
    expect(provenance.icons.map((icon) => icon.key).sort()).toEqual(
      Object.keys(tablerPaths).sort(),
    );
    expect(provenance.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(provenance.license).toBe('MIT');
    expect(
      readFileSync(resolve('frontend/observatory/vendor/tabler-icons.LICENSE'), 'utf8'),
    ).toContain('Copyright (c) 2020-2026 Paweł Kuna');
    for (const source of provenance.icons) {
      expect(source.url).toBe(
        `https://raw.githubusercontent.com/tabler/tabler-icons/${provenance.revision}/icons/outline/${source.name}.svg`,
      );
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(tablerPaths[source.key].length).toBeGreaterThan(0);
      expect(tablerPaths[source.key].length).toBeLessThanOrEqual(32);
      for (const d of tablerPaths[source.key]) {
        expect(d.length).toBeLessThanOrEqual(4096);
        expect(d).toMatch(/^[MmZzLlHhVvCcSsQqTtAaEe0-9., +-]+$/);
      }
    }
  });

  it.each(['constructor', '__proto__', 'missing', '<script>alert(1)</script>'])(
    'uses the fixed file fallback for unknown name %s',
    (name) => {
      const { container } = render(Icon, { name });
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.querySelector('script')).toBeNull();
      expect(svg.querySelector('path')?.getAttribute('d')).toBe(icons.file[0].attrs.d);
      expect(svg.children.length).toBe(icons.file.length);
    },
  );
});
