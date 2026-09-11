import { describeObservation } from '../../../src/shared/observation-display.js';
import type { RecordData } from './host';

export interface ResourceVisual {
  icon: string;
  label: string;
}

/** Choose a visual category from recorded metadata, without reading contents or implying safety.
 * @param row Recorded resource metadata @returns Icon and translatable category @since 0.14.1
 */
export function resourceVisual(row: RecordData = {}): ResourceVisual {
  const info = describeObservation(row);
  if (info.kind === 'Network') {
    if (typeof row.domain === 'string' && row.domain.trim())
      return { icon: 'globe', label: 'Domain name' };
    if (row.remoteIp || row.ip) return { icon: 'server', label: 'IP address' };
    return { icon: 'network', label: 'Network destination' };
  }
  if (info.kind === 'Skill') return { icon: 'book', label: 'Skill' };
  const path = info.path;
  if (!path) return { icon: 'activity', label: 'Activity' };
  if (row.isDirectory === true || /[/\\]$/.test(path)) return { icon: 'folder', label: 'Folder' };
  const name = path.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (
    /^\.env(?:\.|$)/.test(name) ||
    ['json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'].includes(extension)
  )
    return { icon: 'fileConfig', label: 'Configuration file' };
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'mjs',
      'cjs',
      'svelte',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'cs',
      'rb',
      'php',
      'sh',
      'ps1',
      'bat',
      'cmd',
      'html',
      'css',
      'scss',
      'sql',
    ].includes(extension)
  )
    return { icon: 'fileCode', label: 'Source file' };
  if (['db', 'sqlite', 'sqlite3'].includes(extension))
    return { icon: 'database', label: 'Database file' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'].includes(extension))
    return { icon: 'fileImage', label: 'Image file' };
  if (['txt', 'md', 'mdx', 'pdf', 'rtf', 'doc', 'docx', 'odt', 'log'].includes(extension))
    return { icon: 'fileText', label: 'Document' };
  return { icon: 'file', label: 'File' };
}
