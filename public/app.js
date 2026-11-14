/**
 * app.js
 * DiskLens 前端：原生 ES Module，零依赖。
 * 负责可视化渲染（Treemap / 环形图 / 条形图）、勾选清单与安全清理交互。
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_ITEMS = 10;
const TM_COLORS = ['#5b6be1', '#4e86e8', '#52b39b', '#e9a84b', '#ee7a5f', '#8b7be8', '#e8739b', '#6c9bcf', '#3aae7c', '#d8618b', '#7a86a8', '#3e8fd8', '#9aa4b6', '#b7bdca'];
const VIEW_TITLES = { overview: '空间概览', software: '软件清理', files: '文件清理', cleanup: '清理清单' };
const FILE_TABS = [
  { key: 'folders', label: '目录占用' },
  { key: 'large', label: '大文件' },
  { key: 'duplicates', label: '重复文件' },
  { key: 'old', label: '陈旧文件' },
  { key: 'types', label: '文件类型' },
];
const KIND_LABELS = { software: '软件缓存', folder: '目录', file: '文件', duplicate: '重复副本' };

const S = {
  config: null, drives: [], result: null, demo: true, scanId: null,
  view: 'overview', fileTab: 'folders', riskFilter: 'all', sortBy: 'size',
  selection: new Map(), treePath: [], tmNodes: [], expandedSw: new Set(),
  timer: null, polling: false,
};

/* ---------------- 工具 ---------------- */
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function splitBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = Number(n) || 0, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const text = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return [text, units[i]];
}
const fmtBytes = (n) => splitBytes(n).join(' ');
const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN');
const fmtDate = (ms) => new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const keyOf = (p) => String(p).toLowerCase();
const baseName = (p) => String(p).split(/[\\/]/).pop() || String(p);
function shortPath(p, max = 46) {
  const s = String(p || '');
  return s.length > max ? '…' + s.slice(-max) : s;
}
let toastTimer;
function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------------- 数据加载 ---------------- */
async function init() {
  bindEvents();
  try {
    S.config = await api('/api/config');
    $('root-input').value = S.config.defaultRoot;
    renderShortcuts();
    $('server-status').textContent = `本地服务已连接 · Node ${S.config.node}`;
  } catch {
    $('server-status').textContent = '本地服务连接失败';
  }
  try { S.drives = (await api('/api/drives')).drives || []; } catch { S.drives = []; }
  try {
    await loadDemo(true);
  } catch (e) {
    toast('初始化失败：' + e.message, 'err');
  }
  const ro = new ResizeObserver(() => { if (S.view === 'overview' && S.result) renderTreemap(); });
  ro.observe($('treemap-box'));
  const hash = location.hash.replace('#', '');
  if (['overview', 'software', 'files', 'cleanup'].includes(hash)) switchView(hash);
}

async function loadDemo(silent = false) {
  const data = await api('/api/demo');
  setResult(data, true);
  if (!silent) toast('已载入演示数据；点击「开始扫描」查看真实磁盘', 'ok');
}

function setResult(data, demo) {
  S.result = data;
  S.demo = demo;
  if (demo) S.scanId = null;
  S.treePath = [data.tree];
  S.selection.clear();
  S.expandedSw.clear();
  S.fileTab = 'folders';
  S.riskFilter = 'all';
  updateHeader();
  renderAll();
}

async function startScan() {
  const root = $('root-input').value.trim() || S.config?.defaultRoot;
  if (!root) { toast('请填写扫描目录', 'err'); return; }
  $('scan-btn').disabled = true;
  try {
    const r = await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        root,
        maxDepth: Number($('depth').value),
        includeHidden: $('include-hidden').checked,
      }),
    });
    S.scanId = r.id;
    $('scan-panel').hidden = false;
    $('scan-fill').style.width = '0%';
    $('scan-path').textContent = root;
    poll();
  } catch (e) {
    toast('无法开始扫描：' + e.message, 'err');
    $('scan-btn').disabled = false;
  }
}

async function poll() {
  if (!S.scanId) return;
  clearTimeout(S.timer);
  try {
    const st = await api('/api/scan/status?id=' + encodeURIComponent(S.scanId));
    $('scan-phase').textContent = st.phase;
    $('scan-fill').style.width = st.progress + '%';
    $('scan-pct').textContent = st.progress + '%';
    $('scan-count').textContent = `${fmtNum(st.scannedFiles)} 个文件 / ${fmtNum(st.scannedDirs)} 个目录`;
    $('scan-path').textContent = st.currentPath || '';
    if (st.state === 'scanning') {
      S.timer = setTimeout(poll, 320);
      return;
    }
    $('scan-panel').hidden = true;
    $('scan-btn').disabled = false;
    if (st.state === 'done') {
      const data = await api('/api/scan/result?id=' + encodeURIComponent(S.scanId));
      setResult(data, false);
      toast(`扫描完成：${fmtNum(data.summary.fileCount)} 个文件，共 ${fmtBytes(data.summary.totalBytes)}`, 'ok');
    } else if (st.state === 'cancelled') {
      toast('扫描已取消');
    } else {
      toast('扫描失败：' + (st.error || '未知错误'), 'err');
    }
  } catch (e) {
    $('scan-panel').hidden = true;
    $('scan-btn').disabled = false;
    toast('扫描中断：' + e.message, 'err');
  }
}

/* ---------------- 渲染入口 ---------------- */
function renderAll() {
  updateNav();
  updateBadges();
  renderOverview();
  refreshSelections();
}
function refreshSelections() {
  updateBadges();
  renderSoftware();
  renderFiles();
  renderCleanup();
}
function updateHeader() {
  $('demo-tag').hidden = !S.demo;
  $('root-label').textContent = S.result?.meta.root || '未扫描';
  $('view-title').textContent = VIEW_TITLES[S.view];
  const t = $('scan-time');
  t.hidden = !S.result;
  if (S.result) t.textContent = S.demo ? '示例数据' : `扫描耗时 ${(S.result.meta.durationMs / 1000).toFixed(1)}s`;
}
function updateNav() {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
}
function updateBadges() {
  $('badge-sw').textContent = S.result?.software?.length || 0;
  $('badge-clean').textContent = S.selection.size;
}
function switchView(v) {
  S.view = v;
  ['overview', 'software', 'files', 'cleanup'].forEach((x) => { $('view-' + x).hidden = x !== v; });
  updateNav();
  updateHeader();
  $('content').scrollTop = 0;
  if (v === 'overview') requestAnimationFrame(renderTreemap);
}

function renderShortcuts() {
  $('shortcuts').innerHTML = (S.config?.shortcuts || []).map((s) =>
    `<button class="shortcut" data-action="shortcut" data-path="${esc(s.path)}" title="${esc(s.path)}">${esc(s.label)}</button>`
  ).join('');
}

/* ---------------- 概览 ---------------- */
function renderOverview() {
  if (!S.result) return;
  const r = S.result;
  const sum = r.summary;
  const cards = [
    { label: '扫描目录总占用', value: sum.totalBytes, foot: `${fmtNum(sum.fileCount)} 个文件 · ${fmtNum(sum.dirCount)} 个目录`, color: '#5b6be1' },
    { label: '预计可释放', value: sum.potentialBytes, foot: '软件缓存 + 重复文件估算', color: '#2fa97c', accent: true },
    { label: '平均文件大小', value: sum.fileCount ? sum.totalBytes / sum.fileCount : 0, foot: `识别 ${r.types.length} 类文件`, color: '#e9a84b' },
    { label: '可识别软件 / 缓存', value: null, foot: `命中 ${r.software.length} 条清理规则`, color: '#e8739b' },
  ];
  $('kpis').innerHTML = cards.map((c) => {
    const [v, u] = c.value === null ? [fmtNum(r.software.length), '项'] : splitBytes(c.value);
    return `<div class="card kpi ${c.accent ? 'accent' : ''}">
      <div class="kpi-spark" style="background:${c.color}"></div>
      <div class="kpi-label">${esc(c.label)}</div>
      <div class="kpi-value">${v}<span class="unit">${u}</span></div>
      <div class="kpi-foot">${esc(c.foot)}</div>
    </div>`;
  }).join('');

  renderDisk();
  renderTreemap();
  renderCrumb();
  renderDonut();
  renderTopSoftware();
}

function renderDisk() {
  const el = $('disk-card');
  if (!S.drives.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = S.drives.map((d) => {
    const used = d.total ? (d.used / d.total) * 100 : 0;
    return `<div class="disk-title">${esc(d.name)} 使用情况</div>
      <div class="disk-bar-wrap">
        <div class="disk-bar"><span style="width:${used.toFixed(2)}%;background:var(--primary)"></span><span style="width:${(100 - used).toFixed(2)}%;background:#e9edf5"></span></div>
        <div class="disk-meta">
          <span>已用 <b>${fmtBytes(d.used)}</b></span><span>可用 <b>${fmtBytes(d.free)}</b></span>
          <span>总容量 <b>${fmtBytes(d.total)}</b></span><span>使用率 <b>${used.toFixed(1)}%</b></span>
        </div>
      </div>`;
  }).join('');
}

/* Squarify Treemap */
function squarify(items, W, H) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const out = [];
  if (!total || W <= 0 || H <= 0) return out;
  const scale = (W * H) / total;
  const rect = { x: 0, y: 0, w: W, h: H };
  const areas = (row) => row.map((i) => i.value * scale);
  const worst = (row) => {
    const a = areas(row), s = a.reduce((x, y) => x + y, 0), short = Math.min(rect.w, rect.h);
    return Math.max((short * short * Math.max(...a)) / (s * s), (s * s) / (short * short * Math.min(...a)));
  };
  const layout = (row) => {
    const sum = row.reduce((s, i) => s + i.value * scale, 0);
    if (rect.w >= rect.h) {
      const rw = sum / rect.h;
      let y = rect.y;
      for (const it of row) {
        const rh = (it.value * scale) / rw;
        out.push({ ...it, x: rect.x, y, w: rw, h: rh }); y += rh;
      }
      rect.x += rw; rect.w -= rw;
    } else {
      const rh = sum / rect.w;
      let x = rect.x;
      for (const it of row) {
        const rw = (it.value * scale) / rh;
        out.push({ ...it, x, y: rect.y, w: rw, h: rh }); x += rw;
      }
      rect.y += rh; rect.h -= rh;
    }
  };
  const queue = [...items];
  let row = [];
  while (queue.length) {
    const it = queue[0];
    if (!row.length || worst([...row, it]) <= worst(row)) {
      row.push(it); queue.shift();
    } else {
      layout(row); row = [];
    }
  }
  if (row.length) layout(row);
  return out;
}

function renderTreemap() {
  if (!S.result) return;
  const node = S.treePath[S.treePath.length - 1];
  const children = (node.children || []).filter((c) => c.size > 0);
  const box = $('treemap-box');
  const W = Math.max(320, box.clientWidth || 760);
  const H = Math.max(240, box.clientHeight || 340);
  const svg = $('treemap-svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!children.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#a3adbd" font-size="13">该目录下没有可展示的子目录</text>`;
    $('tm-legend').innerHTML = '';
    return;
  }
  S.tmNodes = children;
  const items = children.map((c, i) => ({ idx: i, value: c.size, color: TM_COLORS[i % TM_COLORS.length] }));
  const rects = squarify(items, W, H);
  svg.innerHTML = rects.map((r) => {
    const n = children[r.idx];
    const pad = 2;
    const w = Math.max(0, r.w - pad), h = Math.max(0, r.h - pad);
    const maxChars = Math.max(2, Math.floor((w - 18) / 9));
    const shortName = n.name.length > maxChars ? n.name.slice(0, Math.max(1, maxChars - 1)) + '…' : n.name;
    const label = w > 70 && h > 30 ? `<text class="tm-label" x="${r.x + 9}" y="${r.y + 20}">${esc(shortName)}</text>` : '';
    const sizeText = w > 165 ? `${fmtBytes(n.size)} · ${fmtNum(n.fileCount)} 个文件` : w > 90 ? fmtBytes(n.size) : '';
    const size = sizeText && h > 50 ? `<text class="tm-size" x="${r.x + 9}" y="${r.y + 38}">${esc(sizeText)}</text>` : '';
    return `<g><rect class="tm-rect" data-action="tm-click" data-idx="${r.idx}" x="${r.x}" y="${r.y}" width="${w}" height="${h}" rx="5" fill="${r.color}"/>${label}${size}</g>`;
  }).join('');
  $('tm-legend').innerHTML = children.slice(0, 8).map((c, i) =>
    `<span><i style="background:${TM_COLORS[i % TM_COLORS.length]}"></i>${esc(c.name)} · ${fmtBytes(c.size)}</span>`
  ).join('');
}

function renderCrumb() {
  $('tm-crumb').innerHTML = S.treePath.map((n, i) =>
    `${i ? '<span style="color:#c8cfdb;font-size:11px">›</span>' : ''}<button class="crumb-btn ${i === S.treePath.length - 1 ? 'current' : ''}" data-action="tm-crumb" data-i="${i}">${esc(n.name)}</button>`
  ).join('');
}

function renderDonut() {
  const types = S.result.types;
  const total = types.reduce((s, t) => s + t.bytes, 0) || 1;
  const R = 60, C = 2 * Math.PI * R;
  let acc = 0;
  const circles = types.map((t) => {
    const len = (t.bytes / total) * C;
    const el = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${t.color}" stroke-width="19" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 80 80)"/>`;
    acc += len;
    return el;
  }).join('');
  const [v, u] = splitBytes(total);
  $('donut').innerHTML = `<svg width="160" height="160" viewBox="0 0 160 160">
    <circle cx="80" cy="80" r="${R}" fill="none" stroke="#f0f2f7" stroke-width="19"/>
    ${circles}
    <text class="donut-center-1" x="80" y="77">${v} ${u}</text>
    <text class="donut-center-2" x="80" y="96">${types.length} 类文件</text>
  </svg>`;
  $('donut-legend').innerHTML = types.slice(0, 6).map((t) =>
    `<div class="dl-row"><i style="background:${t.color}"></i><span class="dl-name">${esc(t.label)}</span><span class="dl-val">${((t.bytes / total) * 100).toFixed(1)}%</span></div>`
  ).join('');
}

function renderTopSoftware() {
  const list = S.result.software.slice(0, 7);
  if (!list.length) { $('top-software').innerHTML = '<div class="empty" style="padding:20px"><p>未识别到常见软件缓存目录</p></div>'; return; }
  const max = list[0].bytes || 1;
  $('top-software').innerHTML = list.map((s) => `
    <div class="bar-row">
      <span class="bar-name">${esc(s.name)}</span><span class="bar-val">${fmtBytes(s.bytes)}</span>
      <div class="bar-track"><span style="width:${Math.max(3, (s.bytes / max) * 100).toFixed(1)}%;background:${s.color}"></span></div>
    </div>`).join('');
}

/* ---------------- 软件清理 ---------------- */
function renderSoftware() {
  if (!S.result) return;
  const all = S.result.software;
  const filters = [
    { key: 'all', label: '全部' }, { key: 'safe', label: '低风险' },
    { key: 'caution', label: '需确认' }, { key: 'risky', label: '不建议' },
  ];
  $('risk-filters').innerHTML = filters.map((f) =>
    `<button class="chip ${S.riskFilter === f.key ? 'active' : ''}" data-action="risk-filter" data-key="${f.key}">${f.label}<span style="opacity:.7;margin-left:5px">${f.key === 'all' ? all.length : all.filter((x) => x.risk === f.key).length}</span></button>`
  ).join('') + `<button class="chip" data-action="sort-sw">${S.sortBy === 'size' ? '按占用排序' : '按可释放排序'}</button>`;

  const list = all.filter((x) => S.riskFilter === 'all' || x.risk === S.riskFilter)
    .sort((a, b) => (S.sortBy === 'size' ? b.bytes - a.bytes : b.potentialBytes - a.potentialBytes));
  const totalPotential = all.reduce((s, x) => s + x.potentialBytes, 0);
  $('sw-summary').innerHTML = `
    <span><b>${all.length}</b> 类可识别软件 / 缓存</span>
    <span><b>${fmtBytes(all.reduce((s, x) => s + x.bytes, 0))}</b> 合计占用</span>
    <span><b>${fmtBytes(totalPotential)}</b> 预计可释放</span>
    <span><b>${S.selection.size}</b> 项已加入清单</span>`;

  if (!list.length) {
    $('sw-grid').innerHTML = '<div class="card empty"><h3>没有符合条件的项目</h3><p>切换筛选条件，或扫描包含应用缓存的目录。</p></div>';
    return;
  }
  const max = Math.max(...all.map((x) => x.bytes), 1);
  $('sw-grid').innerHTML = list.map((s) => {
    const group = 'sw:' + s.id;
    const groupItems = [...S.selection.values()].filter((x) => x.group === group);
    const selected = groupItems.length > 0 && groupItems.length >= Math.min(s.dirs.length, 6);
    const expanded = S.expandedSw.has(s.id);
    const paths = s.dirs.slice(0, 6).map((d) =>
      `<div class="dup-file"><span class="keep-tag">缓存目录</span><span class="cell-path" title="${esc(d.path)}">${esc(shortPath(d.path, 60))}</span><span class="num">${fmtBytes(d.size)}</span></div>`
    ).join('');
    return `<div class="card sw-card">
      <div class="sw-top">
        <div class="sw-avatar" style="background:${s.color}">${esc(s.short)}</div>
        <div><div class="sw-name">${esc(s.name)}</div><div class="sw-cat">${esc(s.category)} · ${fmtNum(s.fileCount)} 个文件</div></div>
        <span class="risk ${s.risk}">${esc(s.riskLabel)}</span>
      </div>
      <div class="sw-size">${fmtBytes(s.bytes)} <span>预计可释放 ${fmtBytes(s.potentialBytes)}</span></div>
      <div class="sw-track"><span style="width:${Math.max(2, (s.bytes / max) * 100).toFixed(1)}%;background:${s.color}"></span></div>
      <div class="sw-advice">${esc(s.advice)}</div>
      ${expanded ? `<div class="dup-files" style="padding-left:0">${paths}</div>` : ''}
      <div class="sw-foot">
        <div style="display:flex;gap:6px;align-items:center;min-width:0">
          <button class="link" data-action="sw-detail" data-id="${esc(s.id)}">${expanded ? '收起目录' : `${s.dirs.length} 个目录`}</button>
        </div>
        <button class="btn mini ${selected ? 'primary' : 'ghost'}" data-action="toggle-sw" data-id="${esc(s.id)}">${selected ? '移出清单' : '加入清单'}</button>
      </div>
    </div>`;
  }).join('');
}

function toggleSoftware(id) {
  const sw = S.result.software.find((x) => x.id === id);
  if (!sw) return;
  const group = 'sw:' + id;
  const existing = [...S.selection.values()].filter((x) => x.group === group);
  if (existing.length) {
    existing.forEach((x) => S.selection.delete(keyOf(x.path)));
    refreshSelections();
    toast(`已移出 ${existing.length} 个目录`);
    return;
  }
  if (sw.risk === 'risky') {
    toast('「不建议」类项目未加入清单，请使用系统自带方式处理', 'err');
    return;
  }
  const items = sw.dirs
    .filter((d) => d.path !== S.result.meta.root)
    .slice(0, 6)
    .map((d) => ({ path: d.path, name: d.name, size: d.size, risk: sw.risk, kind: 'software', group }));
  if (!items.length) {
    toast('该项目的目录就是扫描根目录，为安全起见不允许整目录清理', 'err');
    return;
  }
  addSelection(items);
}

/* ---------------- 文件清理 ---------------- */
function checkBtn(item) {
  const on = S.selection.has(keyOf(item.path));
  return `<button class="check ${on ? 'on' : ''}" data-action="toggle-item"
    data-path="${esc(item.path)}" data-name="${esc(item.name)}" data-size="${item.size}"
    data-risk="${esc(item.risk)}" data-kind="${esc(item.kind)}" data-group="${esc(item.group || '')}"
    title="加入 / 移出清理清单"></button>`;
}

function renderFiles() {
  if (!S.result) return;
  $('file-tabs').innerHTML = FILE_TABS.map((t) =>
    `<button class="chip ${S.fileTab === t.key ? 'active' : ''}" data-action="file-tab" data-key="${t.key}">${t.label}</button>`
  ).join('');
  const r = S.result;
  const panel = $('file-panel');
  const empty = (msg) => `<div class="empty"><h3>暂无数据</h3><p>${esc(msg)}</p></div>`;

  if (S.fileTab === 'folders') {
    const list = r.topFolders || [];
    const max = Math.max(...list.map((x) => x.size), 1);
    panel.innerHTML = list.length ? list.map((f) => {
      const item = { path: f.path, name: f.name, size: f.size, risk: 'caution', kind: 'folder' };
      return `<div class="folder-row">${checkBtn(item)}
        <div class="folder-info">
          <div class="folder-name"><span>${esc(f.name)}</span><span>${fmtBytes(f.size)} · ${fmtNum(f.fileCount)} 个文件</span></div>
          <div class="folder-track"><span style="width:${Math.max(2, (f.size / max) * 100).toFixed(1)}%"></span></div>
          <div class="folder-path" title="${esc(f.path)}">${esc(f.path)}</div>
        </div></div>`;
    }).join('') : empty('扫描结果中没有可展示的子目录');
    return;
  }

  if (S.fileTab === 'large' || S.fileTab === 'old') {
    const list = S.fileTab === 'large' ? r.largeFiles : r.oldFiles;
    const title = S.fileTab === 'large' ? '体积超过 100 MB 的文件' : '一年以上未修改且大于 5 MB 的文件';
    panel.innerHTML = `<div style="padding:12px 16px;font-size:11.5px;color:var(--muted);border-bottom:1px solid var(--line-2)">${title} · 共 ${list.length} 项</div>` + (list.length ? `<table><thead><tr><th style="width:36px"></th><th>文件名</th><th>所在目录</th><th>类型</th><th>大小</th><th>修改时间</th><th style="width:56px"></th></tr></thead><tbody>${
      list.map((f) => {
        const meta = (r.types.find((t) => t.key === f.type) || { label: '其他', color: '#b7bdca' });
        const item = { path: f.path, name: f.name, size: f.size, risk: 'caution', kind: 'file' };
        return `<tr><td>${checkBtn(item)}</td><td class="cell-name" title="${esc(f.name)}">${esc(f.name)}</td>
          <td class="cell-path" title="${esc(f.path)}">${esc(shortPath(f.path.replace(/[\\/][^\\/]*$/, ''), 42))}</td>
          <td><span class="type-pill"><i style="background:${meta.color}"></i>${esc(meta.label)}</span></td>
          <td class="num">${fmtBytes(f.size)}</td><td class="num">${fmtDate(f.mtime)}</td>
          <td><button class="link" data-action="reveal" data-path="${esc(f.path)}">定位</button></td></tr>`;
      }).join('')
    }</tbody></table>` : empty('没有符合条件的文件，这通常是好消息'));
    return;
  }

  if (S.fileTab === 'duplicates') {
    const list = r.duplicates || [];
    const waste = list.reduce((s, d) => s + d.wasteBytes, 0);
    panel.innerHTML = `<div style="padding:12px 16px;font-size:11.5px;color:var(--muted);border-bottom:1px solid var(--line-2)">按「文件大小 + 内容指纹」识别 · ${list.length} 组，理论上可释放 ${fmtBytes(waste)}</div>` + (list.length ? list.map((g, gi) => `
      <div class="dup-group">
        <div class="dup-head">
          <span class="dup-title">第 ${gi + 1} 组</span>
          <span class="dup-meta">${g.count} 个相同文件 · 单个 ${fmtBytes(g.size)} · 冗余 ${fmtBytes(g.wasteBytes)}</span>
          <button class="btn mini ghost" data-action="select-dups" data-i="${gi}">选中多余副本</button>
        </div>
        <div class="dup-files">${g.files.map((f, fi) => {
          const item = { path: f.path, name: f.name, size: f.size, risk: 'caution', kind: 'duplicate', group: 'dup:' + gi };
          return `<div class="dup-file">${fi === 0 ? '<span style="width:18px"></span>' : checkBtn(item)}
            ${fi === 0 ? '<span class="keep-tag">建议保留</span>' : ''}
            <span class="cell-path" title="${esc(f.path)}">${esc(shortPath(f.path, 66))}</span>
            <span class="num">${fmtDate(f.mtime)}</span></div>`;
        }).join('')}</div>
      </div>`).join('') : empty('未发现重复文件候选'));
    return;
  }

  if (S.fileTab === 'types') {
    const total = r.types.reduce((s, t) => s + t.bytes, 0) || 1;
    panel.innerHTML = `<table><thead><tr><th>文件类型</th><th>文件数</th><th>占用</th><th style="width:45%">占比</th></tr></thead><tbody>${
      r.types.map((t) => `<tr><td><span class="type-pill"><i style="background:${t.color}"></i>${esc(t.label)}</span></td>
        <td class="num">${fmtNum(t.count)}</td><td class="num">${fmtBytes(t.bytes)}</td>
        <td><div class="folder-track" style="margin-top:0"><span style="width:${((t.bytes / total) * 100).toFixed(1)}%;background:${t.color}"></span></div></td></tr>`).join('')
    }</tbody></table>`;
  }
}

/* ---------------- 清理清单 ---------------- */
function addSelection(items) {
  let added = 0;
  for (const it of items) {
    const k = keyOf(it.path);
    if (S.selection.has(k)) continue;
    if (S.selection.size >= MAX_ITEMS) {
      toast(`单批最多 ${MAX_ITEMS} 项，请先执行清理或移出部分项目`, 'err');
      break;
    }
    S.selection.set(k, it);
    added += 1;
  }
  if (added) {
    refreshSelections();
    toast(`已加入 ${added} 项到清理清单`);
  }
  return added;
}

function renderCleanup() {
  const items = [...S.selection.values()];
  const total = items.reduce((s, x) => s + (Number(x.size) || 0), 0);
  $('cleanup-notice').innerHTML = S.demo
    ? '<b>当前为演示数据。</b>演示模式不会执行任何真实操作。请点击左侧「开始扫描」扫描真实目录后再使用清理功能。'
    : '<b>安全说明：</b>本工具只把选中的项目移入系统回收站（可还原），绝不永久删除；系统关键路径会被服务端拦截；单批最多 10 项，且需要逐项确认。';

  $('cleanup-list').innerHTML = items.length ? `<table><thead><tr><th>项目</th><th>路径</th><th>归类</th><th>风险</th><th>大小</th><th style="width:56px"></th></tr></thead><tbody>${
    items.map((x) => `<tr><td class="cell-name" title="${esc(x.name)}">${esc(x.name)}</td>
      <td class="cell-path" title="${esc(x.path)}">${esc(shortPath(x.path, 50))}</td>
      <td><span class="tag">${KIND_LABELS[x.kind] || '项目'}</span></td>
      <td><span class="risk ${esc(x.risk)}" style="margin:0">${x.risk === 'safe' ? '低风险' : x.risk === 'risky' ? '不建议' : '需确认'}</span></td>
      <td class="num">${fmtBytes(x.size)}</td>
      <td><button class="link danger" data-action="remove-item" data-path="${esc(x.path)}">移除</button></td></tr>`).join('')
  }</tbody></table>` : `<div class="empty"><h3>清单还是空的</h3><p>在「软件清理」或「文件清理」中勾选项目，它们会出现在这里。<br>所有清理都需要二次确认后才会执行。</p></div>`;

  const canClean = items.length > 0 && !S.demo && !!S.scanId;
  $('cleanup-footer').innerHTML = `
    <div class="cleanup-total">待清理 ${items.length} / ${MAX_ITEMS} 项，预计释放<b>${fmtBytes(total)}</b></div>
    <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
      <span class="sub">${S.demo ? '演示数据不可执行' : '移入系统回收站，可还原'}</span>
      <button class="btn danger-btn" data-action="modal-open" ${canClean ? '' : 'disabled'}>执行清理</button>
    </div>`;
}

function openConfirm() {
  const items = [...S.selection.values()];
  if (!items.length || S.demo) return;
  $('modal-list').innerHTML = items.map((x) =>
    `<div class="modal-item"><span class="m-path">${esc(x.path)}</span><span class="m-size">${fmtBytes(x.size)}</span></div>`
  ).join('');
  const total = items.reduce((s, x) => s + (Number(x.size) || 0), 0);
  $('modal-total').innerHTML = `共 ${items.length} 项，预计释放 <b>${fmtBytes(total)}</b>`;
  $('confirm-checkbox').checked = false;
  $('modal-execute').disabled = true;
  $('modal').hidden = false;
}

async function executeTrash() {
  const items = [...S.selection.values()].map((x) => ({ path: x.path, size: x.size }));
  $('modal-execute').disabled = true;
  try {
    const res = await api('/api/trash', {
      method: 'POST',
      body: JSON.stringify({ id: S.scanId, items, confirmed: true }),
    });
    $('modal').hidden = true;
    res.ok.forEach((o) => S.selection.delete(keyOf(o.path)));
    const failed = res.failed || [];
    $('trash-result').hidden = false;
    $('trash-result').innerHTML = `<div style="padding:16px 18px">
      <div class="result-ok">成功移入回收站 ${res.ok.length} 项，预计释放 ${fmtBytes(res.freedBytes)}。${esc(res.note || '')}</div>
      ${failed.length ? `<div class="result-fail">${failed.length} 项未处理：${failed.slice(0, 4).map((f) => esc(baseName(f.path)) + '（' + esc(f.reason) + '）').join('；')}</div>` : ''}
      <div class="sub" style="margin-top:9px">建议点击「重新扫描」刷新占用数据。</div>
    </div>`;
    refreshSelections();
    toast(`已清理 ${res.ok.length} 项，可在回收站还原`, 'ok');
  } catch (e) {
    $('modal').hidden = true;
    toast('清理失败：' + e.message, 'err');
  }
}

/* ---------------- 事件 ---------------- */
function bindEvents() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest?.('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case 'nav': switchView(el.dataset.view); break;
      case 'shortcut': $('root-input').value = el.dataset.path; toast('已选择：' + el.dataset.path); break;
      case 'scan': startScan(); break;
      case 'demo': loadDemo(); break;
      case 'cancel-scan':
        if (S.scanId) await api('/api/scan/cancel', { method: 'POST', body: JSON.stringify({ id: S.scanId }) }).catch(() => {});
        break;
      case 'risk-filter': S.riskFilter = el.dataset.key; renderSoftware(); break;
      case 'sort-sw': S.sortBy = S.sortBy === 'size' ? 'potential' : 'size'; renderSoftware(); break;
      case 'sw-detail':
        if (S.expandedSw.has(el.dataset.id)) S.expandedSw.delete(el.dataset.id);
        else S.expandedSw.add(el.dataset.id);
        renderSoftware();
        break;
      case 'toggle-sw': toggleSoftware(el.dataset.id); break;
      case 'file-tab': S.fileTab = el.dataset.key; renderFiles(); break;
      case 'toggle-item': {
        const p = el.dataset.path;
        const k = keyOf(p);
        if (S.selection.has(k)) {
          S.selection.delete(k);
          refreshSelections();
        } else {
          addSelection([{
            path: p, name: el.dataset.name, size: Number(el.dataset.size),
            risk: el.dataset.risk, kind: el.dataset.kind, group: el.dataset.group,
          }]);
        }
        break;
      }
      case 'select-dups': {
        const g = S.result?.duplicates?.[Number(el.dataset.i)];
        if (!g) break;
        addSelection(g.files.slice(1).map((f) => ({
          path: f.path, name: f.name, size: f.size, risk: 'caution',
          kind: 'duplicate', group: 'dup:' + el.dataset.i,
        })));
        break;
      }
      case 'remove-item': S.selection.delete(keyOf(el.dataset.path)); refreshSelections(); break;
      case 'clear-selection': S.selection.clear(); refreshSelections(); toast('清单已清空'); break;
      case 'reveal':
        if (S.demo) { toast('演示数据无法定位到真实文件', 'err'); break; }
        try { await api('/api/reveal', { method: 'POST', body: JSON.stringify({ path: el.dataset.path }) }); }
        catch (err) { toast('无法打开：' + err.message, 'err'); }
        break;
      case 'tm-click': {
        const n = S.tmNodes[Number(el.dataset.idx)];
        if (!n) break;
        if (n.isAggregate) { toast('这是聚合节点，无法继续下钻', 'err'); break; }
        if (n.children && n.children.length) {
          S.treePath.push(n);
          renderTreemap(); renderCrumb();
        } else {
          addSelection([{ path: n.path, name: n.name, size: n.size, risk: 'caution', kind: 'folder' }]);
        }
        break;
      }
      case 'tm-crumb':
        S.treePath = S.treePath.slice(0, Number(el.dataset.i) + 1);
        renderTreemap(); renderCrumb();
        break;
      case 'modal-open': openConfirm(); break;
      case 'modal-close': $('modal').hidden = true; break;
      case 'modal-execute': executeTrash(); break;
      default: break;
    }
  });

  $('confirm-checkbox').addEventListener('change', (e) => {
    $('modal-execute').disabled = !e.target.checked;
  });
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) $('modal').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('modal').hidden = true;
  });

  // 主内容使用内层滚动容器，默认不会响应键盘翻页；此处补上 PageUp/PageDown/方向键/Home/End。
  // 移动端走整页滚动，交给浏览器默认行为，不拦截。
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!$('modal').hidden) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    const c = $('content');
    if (c.scrollHeight <= c.clientHeight + 2) return;
    const pageStep = c.clientHeight * 0.9;
    let delta = 0;
    switch (e.key) {
      case 'PageDown': delta = pageStep; break;
      case 'PageUp': delta = -pageStep; break;
      case 'ArrowDown': delta = 60; break;
      case 'ArrowUp': delta = -60; break;
      case 'Home': c.scrollTop = 0; e.preventDefault(); return;
      case 'End': c.scrollTop = c.scrollHeight; e.preventDefault(); return;
      case ' ':
        if (/^(BUTTON|A|SUMMARY)$/.test(t.tagName)) return; // 空格应激活按钮
        delta = e.shiftKey ? -pageStep : pageStep;
        break;
      default: return;
    }
    c.scrollTop += delta;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('.tm-rect');
    const tip = $('tooltip');
    if (!t || S.view !== 'overview') { tip.hidden = true; return; }
    const n = S.tmNodes[Number(t.dataset.idx)];
    if (!n) { tip.hidden = true; return; }
    tip.innerHTML = `<strong>${esc(n.name)}</strong><br>${esc(n.path)}<br>${fmtBytes(n.size)} · ${fmtNum(n.fileCount)} 个文件${n.isAggregate ? '<br>（聚合节点）' : ''}`;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 350) + 'px';
    tip.style.top = Math.min(e.clientY + 14, window.innerHeight - 90) + 'px';
  });
}

init();
