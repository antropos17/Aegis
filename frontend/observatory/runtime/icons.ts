/** Fixed Observatory vector elements. Host strings never become markup. */
export const icons: Record<string, { tag: string; attrs: Record<string, string> }[]> = {
  terminal: [{ tag: 'path', attrs: { d: 'm4 6 5 6-5 6m8 0h8' } }],
  balance: [
    { tag: 'path', attrs: { d: 'M12 3v18M6 21h12M4 7h16M5 7l-4 8h8L5 7Zm14 0-4 8h8l-4-8Z' } },
  ],
  clipboard: [
    { tag: 'rect', attrs: { x: '5', y: '5', width: '14', height: '17', rx: '2' } },
    { tag: 'rect', attrs: { x: '9', y: '2', width: '6', height: '6', rx: '1' } },
  ],
  keyboard: [
    { tag: 'rect', attrs: { x: '2', y: '5', width: '20', height: '14', rx: '2' } },
    {
      tag: 'path',
      attrs: {
        d: 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10',
      },
    },
  ],
  edit: [{ tag: 'path', attrs: { d: 'm16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5' } }],
  sort: [{ tag: 'path', attrs: { d: 'M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4' } }],
  radar: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '5' } },
    { tag: 'path', attrs: { d: 'm12 12 6-7' } },
  ],
  agents: [
    { tag: 'rect', attrs: { x: '3', y: '3', width: '7', height: '7', rx: '1' } },
    { tag: 'rect', attrs: { x: '14', y: '3', width: '7', height: '7', rx: '1' } },
    { tag: 'rect', attrs: { x: '3', y: '14', width: '7', height: '7', rx: '1' } },
    { tag: 'rect', attrs: { x: '14', y: '14', width: '7', height: '7', rx: '1' } },
  ],
  activity: [{ tag: 'path', attrs: { d: 'M2 12h4l3-8 6 16 3-8h4' } }],
  network: [
    { tag: 'circle', attrs: { cx: '12', cy: '5', r: '3' } },
    { tag: 'circle', attrs: { cx: '5', cy: '18', r: '3' } },
    { tag: 'circle', attrs: { cx: '19', cy: '18', r: '3' } },
    { tag: 'path', attrs: { d: 'm10 8-4 7m8-7 4 7M8 18h8' } },
  ],
  shield: [
    { tag: 'path', attrs: { d: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z' } },
    { tag: 'path', attrs: { d: 'm8 12 3 3 5-6' } },
  ],
  database: [
    { tag: 'ellipse', attrs: { cx: '12', cy: '5', rx: '9', ry: '3' } },
    { tag: 'path', attrs: { d: 'M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0' } },
  ],
  report: [{ tag: 'path', attrs: { d: 'M5 2h10l4 4v16H5ZM9 10h6m-6 4h6m-6 4h4' } }],
  history: [{ tag: 'path', attrs: { d: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2' } }],
  chart: [{ tag: 'path', attrs: { d: 'M3 3v18h18M7 16v-5m5 5V6m5 10V9' } }],
  settings: [
    { tag: 'path', attrs: { d: 'M4 7h16M4 17h16' } },
    { tag: 'circle', attrs: { cx: '9', cy: '7', r: '3' } },
    { tag: 'circle', attrs: { cx: '16', cy: '17', r: '3' } },
  ],
  monitor: [
    { tag: 'rect', attrs: { x: '2', y: '3', width: '20', height: '14', rx: '2' } },
    { tag: 'path', attrs: { d: 'M8 21h8m-4-4v4' } },
  ],
  search: [
    { tag: 'circle', attrs: { cx: '10', cy: '10', r: '7' } },
    { tag: 'path', attrs: { d: 'm15 15 6 6' } },
  ],
  sun: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4' } },
    {
      tag: 'path',
      attrs: { d: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1m12-12 1-1' },
    },
  ],
  pause: [{ tag: 'path', attrs: { d: 'M8 5v14M16 5v14' } }],
  play: [{ tag: 'path', attrs: { d: 'm7 4 14 8-14 8Z' } }],
  refresh: [
    {
      tag: 'path',
      attrs: { d: 'M20 10a8 8 0 0 0-14-5L3 8m0-6v6h6m-5 6a8 8 0 0 0 14 5l3-3m0 6v-6h-6' },
    },
  ],
  close: [{ tag: 'path', attrs: { d: 'm6 6 12 12M6 18 18 6' } }],
  chevron: [{ tag: 'path', attrs: { d: 'm9 5 7 7-7 7' } }],
  arrow: [{ tag: 'path', attrs: { d: 'M4 12h16m-6-6 6 6-6 6' } }],
  file: [{ tag: 'path', attrs: { d: 'M5 2h9l5 5v15H5Zm9 0v6h5' } }],
  folder: [{ tag: 'path', attrs: { d: 'M3 7V5h7l2 3h9v12H3Z' } }],
  key: [
    { tag: 'circle', attrs: { cx: '8', cy: '8', r: '5' } },
    { tag: 'path', attrs: { d: 'm12 12 9 9m-5-5 3-3m-1 5 3-3' } },
  ],
  globe: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } },
    { tag: 'ellipse', attrs: { cx: '12', cy: '12', rx: '4', ry: '9' } },
    { tag: 'path', attrs: { d: 'M3 12h18' } },
  ],
  alert: [
    { tag: 'path', attrs: { d: 'm12 3 10 18H2Z' } },
    { tag: 'path', attrs: { d: 'M12 9v5m0 3v.1' } },
  ],
  check: [{ tag: 'path', attrs: { d: 'm4 12 5 5L20 6' } }],
  copy: [
    { tag: 'rect', attrs: { x: '8', y: '8', width: '13', height: '13', rx: '2' } },
    { tag: 'path', attrs: { d: 'M16 8V3H3v13h5' } },
  ],
  download: [{ tag: 'path', attrs: { d: 'M12 2v13m-5-5 5 5 5-5M3 16v5h18v-5' } }],
  upload: [{ tag: 'path', attrs: { d: 'M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5' } }],
  plus: [{ tag: 'path', attrs: { d: 'M12 4v16M4 12h16' } }],
  eye: [
    { tag: 'path', attrs: { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
  ],
  stop: [{ tag: 'rect', attrs: { x: '5', y: '5', width: '14', height: '14', rx: '1' } }],
  cpu: [
    { tag: 'rect', attrs: { x: '6', y: '6', width: '12', height: '12', rx: '2' } },
    { tag: 'path', attrs: { d: 'M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4' } },
  ],
  link: [
    {
      tag: 'path',
      attrs: { d: 'm10 7 2-2a5 5 0 0 1 7 7l-2 2m-3 3-2 2a5 5 0 0 1-7-7l2-2m1 6 8-8' },
    },
  ],
  bell: [{ tag: 'path', attrs: { d: 'M5 17V9a7 7 0 0 1 14 0v8l2 2H3Zm5 5h4' } }],
  spark: [{ tag: 'path', attrs: { d: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z' } }],
  trash: [{ tag: 'path', attrs: { d: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7' } }],
};
