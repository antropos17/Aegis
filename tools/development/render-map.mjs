const groups = ['Main', 'Platform', 'Shared', 'Observatory', 'Legacy logic', 'Tests'];
const group = (file) =>
  file.startsWith('src/main/platform/')
    ? 'Platform'
    : file.startsWith('src/main/')
      ? 'Main'
      : file.startsWith('src/shared/')
        ? 'Shared'
        : file.startsWith('frontend/observatory/')
          ? 'Observatory'
          : file.startsWith('src/renderer/')
            ? 'Legacy logic'
            : file.startsWith('tests/')
              ? 'Tests'
              : null;

/** Render an offline map from measured source facts; contains no source bodies.
 * @param {object} context @param {object} graph
 * @returns {{html: string, mermaid: string}} @since v0.15.0
 */
export function renderMap(context, graph) {
  const edges = new Map();
  for (const mod of graph.modules)
    for (const dep of mod.dependencies) {
      const from = group(mod.source);
      const to = group(dep.resolved);
      if (from && to && from !== to) {
        const key = `${from}|${to}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  const mermaid =
    `%% ${context.metadata.commit}; dirty=${context.metadata.dirty}; ${context.metadata.generated}\nflowchart LR\n` +
    groups.map((name, i) => `  n${i}["${name}"]`).join('\n') +
    '\n' +
    [...edges]
      .map(([key, count]) => {
        const [from, to] = key.split('|');
        return `  n${groups.indexOf(from)} -->|${count} imports| n${groups.indexOf(to)}`;
      })
      .join('\n') +
    '\n';
  const payload = JSON.stringify({
    context,
    edges: [...edges],
    violations: graph.summary.violations ?? [],
  }).replaceAll('<', '\\u003c');
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AEGIS · Карта разработки</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#10151b;color:#e6edf3;font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:36px 24px}h1{font-size:30px;margin:0}h2{font-size:21px}p{max-width:95ch;color:#aebdca}.meta{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{padding:18px;background:#19222b;border:1px solid #354453;border-radius:12px}.card b{font-size:25px;display:block}input,button{font:inherit;color:inherit;background:#19222b;border:1px solid #718399;padding:10px 14px;border-radius:6px}input{width:min(100%,580px)}button[aria-pressed=true]{background:#305576}button:focus-visible,input:focus-visible{outline:3px solid #7dd3fc;outline-offset:3px}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #354453;padding:10px}th{color:#8ec9eb}td:first-child{font-family:ui-monospace,monospace;overflow-wrap:anywhere}svg{width:100%;min-width:620px;height:auto}.note{color:#e4c37b}.count{margin:10px 0}a{color:#8ec9eb}@media(max-width:650px){.cards{grid-template-columns:1fr}main{padding:20px 14px}}
</style><main><h1>AEGIS · Карта разработки</h1><p id="meta" class="meta"></p>
<div class="cards"><div class="card"><b id="modules"></b>исходных модулей</div><div class="card"><b id="channels"></b>уникальных литеральных IPC-каналов</div><div class="card"><b id="unchecked"></b>JS-файлов без проверки тела по умолчанию</div></div>
<p class="note">Снимок исходников. Проверки не запускались при построении карты. Наличие тестового импорта и включение в coverage не доказывают покрытие поведения.</p>
<nav aria-label="Раздел карты"><button type="button" data-view="architecture" aria-pressed="true">Архитектура</button><button type="button" data-view="checks" aria-pressed="false">Карта проверок</button><button type="button" data-view="ipc" aria-pressed="false">IPC</button></nav>
<section id="architecture"><h2>Зависимости между слоями</h2><p>Стрелка: слой импортирует другой слой. Число: статические связи между файлами. Runtime DI, вычисляемые пути и передача IPC сюда не входят.</p><div id="diagram" class="scroll"></div><h2>Нарушения правил зависимостей</h2><div id="violations"></div></section>
<section id="details" hidden><label for="filter">Фильтр по файлу, каналу или состоянию</label><br><input id="filter" type="search" placeholder="Например: ipc-handlers"><p class="count" id="count" role="status"></p><div class="scroll"><table><thead id="head"></thead><tbody id="rows"></tbody></table></div></section>
<p>IPC: только прямые вызовы ipcRenderer.invoke/on/once/send и ipcMain.handle/on/once. Алиасы, обёртки и отправители требуют отдельной проверки. Direct tests: только литеральные импорты JS/TS.</p>
</main><script id="data" type="application/json">${payload}</script><script>
const data=JSON.parse(document.getElementById('data').textContent), ctx=data.context;
const byId=id=>document.getElementById(id);let view='architecture';
byId('meta').textContent='Commit '+ctx.metadata.commit+' · '+ctx.metadata.branch+' · '+ctx.metadata.generated+' · dirty='+ctx.metadata.dirty+' · SHA256 '+ctx.metadata.sourceDigest;
byId('modules').textContent=ctx.modules.length;byId('channels').textContent=new Set(ctx.ipc.map(x=>x.channel)).size;byId('unchecked').textContent=ctx.modules.filter(x=>x.typecheck==='JS bodies unchecked by default').length;
function table(){const ipc=view==='ipc', headers=ipc?['Файл:строка','Вызов','Канал']:['Модуль','Типизация','Coverage: настройка','Прямые импорты из тестов'];const list=ipc?ctx.ipc.map(x=>[x.file+':'+x.line,x.kind,x.channel]):ctx.modules.map(x=>[x.file,x.typecheck,x.coverage,x.directTests.join(', ')||'Не установлены этим анализом']);const filtered=list.filter(x=>x.join(' ').toLowerCase().includes(byId('filter').value.toLowerCase()));byId('head').replaceChildren();const tr=document.createElement('tr');headers.forEach(x=>{const th=document.createElement('th');th.scope='col';th.textContent=x;tr.append(th)});byId('head').append(tr);byId('rows').replaceChildren();filtered.forEach(row=>{const tr=document.createElement('tr');row.forEach(x=>{const td=document.createElement('td');td.textContent=x;tr.append(td)});byId('rows').append(tr)});byId('count').textContent=filtered.length+' / '+list.length}
document.querySelectorAll('button[data-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;document.querySelectorAll('button[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));byId('architecture').hidden=view!=='architecture';byId('details').hidden=view==='architecture';table()}));byId('filter').addEventListener('input',table);
const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 960 370');svg.setAttribute('role','img');svg.setAttribute('aria-label','Граф импортов между слоями; текстовый список связей ниже');
function el(tag,attrs,text){const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(text)n.textContent=text;return n}
const defs=el('defs',{}),marker=el('marker',{id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#8ec9eb'}));defs.append(marker);svg.append(defs);
const positions={'Tests':[40,25],'Main':[40,270],'Platform':[385,270],'Shared':[730,270],'Observatory':[730,25],'Legacy logic':[385,25]};
data.edges.forEach(([key,count])=>{const [a,b]=key.split('|'),[x,y]=positions[a],[u,v]=positions[b],dx=u-x,dy=v-y,len=Math.hypot(dx,dy),clip=Math.min(87/(Math.abs(dx)||1),32/(Math.abs(dy)||1)),ox=-dy/len*8,oy=dx/len*8;svg.append(el('line',{x1:x+85+dx*clip+ox,y1:y+30+dy*clip+oy,x2:u+85-dx*clip+ox,y2:v+30-dy*clip+oy,stroke:'#537d98','stroke-width':1.5,'marker-end':'url(#arrow)'}));svg.append(el('text',{x:(x+u)/2+85+ox,y:(y+v)/2+30+oy,fill:'#a8d9f5','text-anchor':'middle'},String(count)))});
Object.entries(positions).forEach(([name,[x,y]])=>{svg.append(el('rect',{x,y,width:170,height:60,rx:9,fill:'#19222b',stroke:'#7ba6bd'}));svg.append(el('text',{x:x+85,y:y+35,fill:'#e6edf3','text-anchor':'middle'},name))});byId('diagram').append(svg);
const edgeList=document.createElement('p');edgeList.textContent=data.edges.map(([edge,n])=>edge.replace('|',' → ')+' ('+n+')').join(' · ');byId('diagram').append(edgeList);
byId('violations').textContent=data.violations.length?data.violations.map(v=>v.rule.name+': '+v.from+' → '+v.to).join(' | '):'Нарушений настроенных правил не найдено. Это не полный аудит архитектуры.';
</script></html>`;
  return { html, mermaid };
}
