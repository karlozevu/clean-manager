/**
 * scanner.js
 * 异步递归扫描引擎：目录树、文件类型、软件占用、大文件、陈旧文件、重复文件。
 * 使用 Node 内置模块，通过 setImmediate 让出事件循环，保证扫描期间 HTTP 仍可响应进度。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  FILE_TYPES, typeOf, matchSoftware, RISK_META, PROTECTED_NAMES,
} from './rules.js';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const MAX_CHILDREN = 14;
const scans = new Map();
let seq = 0;

class Cancelled extends Error {}

export function getScan(id) {
  return scans.get(id) || null;
}

export function startScan(root, options = {}) {
  const id = `s${Date.now().toString(36)}${(++seq).toString(36)}`;
  const state = {
    id,
    root,
    options: {
      maxDepth: clamp(Number(options.maxDepth) || 6, 1, 12),
      maxFiles: clamp(Number(options.maxFiles) || 150000, 1000, 1000000),
      includeHidden: options.includeHidden !== false,
    },
    state: 'scanning',
    phase: '正在扫描目录',
    progress: 0,
    scannedFiles: 0,
    scannedDirs: 0,
    currentPath: root,
    startedAt: Date.now(),
    durationMs: 0,
    cancelled: false,
    error: null,
    result: null,
  };
  scans.set(id, state);
  // 仅保留最近 6 次扫描，避免内存堆积
  if (scans.size > 6) scans.delete(scans.keys().next().value);
  runScan(state).catch((err) => {
    if (err instanceof Cancelled) {
      state.state = 'cancelled';
      state.phase = '扫描已取消';
    } else {
      state.state = 'error';
      state.error = err?.message || String(err);
      state.phase = '扫描失败';
    }
    state.durationMs = Date.now() - state.startedAt;
  });
  return id;
}

export function cancelScan(id) {
  const s = getScan(id);
  if (s && s.state === 'scanning') s.cancelled = true;
  return !!s;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function yieldTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createContext() {
  return {
    totalBytes: 0,
    fileCount: 0,
    dirCount: 0,
    types: Object.fromEntries(FILE_TYPES.map((t) => [t.key, { bytes: 0, count: 0 }])),
    software: new Map(),
    sizeGroups: new Map(),
    largeFiles: [],
    oldFiles: [],
    truncated: false,
  };
}

function pushTop(list, item, cap) {
  if (list.length < cap) {
    list.push(item);
    if (list.length === cap) list.sort((a, b) => a.size - b.size);
    return;
  }
  if (item.size <= list[0].size) return;
  list[0] = item;
  let i = 0;
  while (i < cap - 1 && list[i].size > list[i + 1].size) {
    [list[i], list[i + 1]] = [list[i + 1], list[i]];
    i += 1;
  }
}

function addSoftware(ctx, rule, node) {
  if (!node.size) return;
  let entry = ctx.software.get(rule.id);
  if (!entry) {
    entry = {
      id: rule.id, name: rule.name, short: rule.short, category: rule.category,
      color: rule.color, risk: rule.risk, advice: rule.advice,
      bytes: 0, fileCount: 0, dirs: [],
    };
    ctx.software.set(rule.id, entry);
  }
  entry.bytes += node.size;
  entry.fileCount += node.fileCount;
  entry.dirs.push({ path: node.path, name: node.name, size: node.size });
}

async function walk(dir, depth, owner, state, ctx) {
  if (state.cancelled) throw new Cancelled();
  const node = {
    name: path.basename(dir) || dir,
    path: dir,
    size: 0,
    fileCount: 0,
    dirCount: 0,
    children: [],
  };

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return node; // 无权限 / 已消失
  }

  state.scannedDirs += 1;
  state.currentPath = dir;
  if (state.scannedDirs % 12 === 0) {
    state.progress = Math.min(96, Math.round(100 * (1 - Math.exp(-state.scannedFiles / 22000))));
    await yieldTick();
  }

  // 该目录是否命中某个软件规则；已归属上层规则的子树不再细分，避免重复统计
  const rel = path.relative(state.root, dir);
  const probe = rel === '' ? path.basename(state.root) : rel;
  const myRule = owner ? null : matchSoftware(probe);
  const nextOwner = myRule || owner;
  const keepChildren = depth < state.options.maxDepth;

  for (const ent of entries) {
    if (state.cancelled) throw new Cancelled();
    if (ctx.truncated) break;
    const name = ent.name;
    const lower = name.toLowerCase();
    if (PROTECTED_NAMES.has(lower)) continue;
    if (ent.isSymbolicLink()) continue;
    if (!state.options.includeHidden && name.startsWith('.')) continue;

    const full = path.join(dir, name);

    if (ent.isDirectory()) {
      const child = await walk(full, depth + 1, nextOwner, state, ctx);
      node.size += child.size;
      node.fileCount += child.fileCount;
      node.dirCount += child.dirCount + 1;
      if (keepChildren && child.size > 0) node.children.push(child);
      continue;
    }

    if (!ent.isFile()) continue;
    if (state.scannedFiles >= state.options.maxFiles) {
      ctx.truncated = true;
      break;
    }

    let st;
    try {
      st = await fsp.stat(full);
    } catch {
      continue;
    }
    const size = st.size;
    const mtime = Math.round(st.mtimeMs);
    state.scannedFiles += 1;
    ctx.fileCount += 1;
    ctx.totalBytes += size;
    node.size += size;
    node.fileCount += 1;

    if (state.scannedFiles % 400 === 0) {
      state.progress = Math.min(96, Math.round(100 * (1 - Math.exp(-state.scannedFiles / 22000))));
      await yieldTick();
    }

    const key = typeOf(name);
    ctx.types[key].bytes += size;
    ctx.types[key].count += 1;

    const item = { path: full, name, size, mtime, type: key };

    if (size >= 100 * MB) pushTop(ctx.largeFiles, item, 60);
    if (size >= 5 * MB && Date.now() - mtime > 365 * DAY) pushTop(ctx.oldFiles, item, 60);

    if (size >= MB) {
      let group = ctx.sizeGroups.get(size);
      if (!group) {
        group = [];
        ctx.sizeGroups.set(size, group);
      }
      if (group.length < 8) group.push(item);
    }
  }

  if (keepChildren && node.children.length > MAX_CHILDREN) {
    node.children.sort((a, b) => b.size - a.size);
    const rest = node.children.slice(MAX_CHILDREN);
    node.children = [
      ...node.children.slice(0, MAX_CHILDREN),
      {
        name: `其他 ${rest.length} 个目录`,
        path: dir,
        size: rest.reduce((s, c) => s + c.size, 0),
        fileCount: rest.reduce((s, c) => s + c.fileCount, 0),
        dirCount: rest.reduce((s, c) => s + c.dirCount, 0),
        children: [],
        isAggregate: true,
      },
    ];
  } else {
    node.children.sort((a, b) => b.size - a.size);
  }

  if (myRule) addSoftware(ctx, myRule, node);
  return node;
}

async function readHead(p, length) {
  let handle;
  try {
    handle = await fsp.open(p, 'r');
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function findDuplicates(sizeGroups, state) {
  const candidates = [...sizeGroups.entries()]
    .filter(([, files]) => files.length > 1)
    .sort((a, b) => Number(b[0]) * (b[1].length - 1) - Number(a[0]) * (a[1].length - 1))
    .slice(0, 160);

  const out = [];
  for (const [size, files] of candidates) {
    if (state.cancelled) throw new Cancelled();
    const byHash = new Map();
    for (const item of files.slice(0, 10)) {
      const head = await readHead(item.path, 64 * 1024);
      if (!head || !head.length) continue;
      const hash = crypto.createHash('sha1').update(head).digest('hex');
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(item);
    }
    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      out.push({
        size,
        hash: crypto.createHash('sha1').update(group[0].path).digest('hex').slice(0, 12),
        count: group.length,
        wasteBytes: size * (group.length - 1),
        files: group,
      });
    }
    if (out.length >= 40) break;
  }
  await yieldTick();
  return out.sort((a, b) => b.wasteBytes - a.wasteBytes);
}

function buildResult(state, ctx, tree, duplicates) {
  const types = FILE_TYPES.map((t) => ({
    key: t.key, label: t.label, color: t.color,
    bytes: ctx.types[t.key].bytes,
    count: ctx.types[t.key].count,
  })).filter((t) => t.bytes > 0).sort((a, b) => b.bytes - a.bytes);

  const software = [...ctx.software.values()].map((e) => ({
    ...e,
    dirs: e.dirs.sort((a, b) => b.size - a.size).slice(0, 10),
    potentialBytes: Math.round(e.bytes * (RISK_META[e.risk]?.ratio ?? 0)),
    riskLabel: RISK_META[e.risk]?.label || '未知',
  })).sort((a, b) => b.bytes - a.bytes);

  const duplicateWaste = duplicates.reduce((s, d) => s + d.wasteBytes, 0);
  const softwareWaste = software.reduce((s, e) => s + e.potentialBytes, 0);

  return {
    meta: {
      scanId: state.id,
      root: state.root,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - state.startedAt,
      truncated: ctx.truncated,
      platform: process.platform,
      demo: false,
    },
    summary: {
      totalBytes: ctx.totalBytes,
      fileCount: ctx.fileCount,
      dirCount: ctx.dirCount,
      potentialBytes: softwareWaste + duplicateWaste,
    },
    tree,
    types,
    software,
    topFolders: tree.children.filter((c) => !c.isAggregate).slice(0, 12).map((c) => ({
      name: c.name, path: c.path, size: c.size, fileCount: c.fileCount,
    })),
    largeFiles: ctx.largeFiles.sort((a, b) => b.size - a.size),
    oldFiles: ctx.oldFiles.sort((a, b) => b.size - a.size),
    duplicates,
  };
}

async function runScan(state) {
  const ctx = createContext();
  const tree = await walk(state.root, 0, null, state, ctx);
  state.phase = '正在分析重复文件';
  state.progress = 97;
  const duplicates = await findDuplicates(ctx.sizeGroups, state);
  state.result = buildResult(state, ctx, tree, duplicates);
  state.state = 'done';
  state.phase = '扫描完成';
  state.progress = 100;
  state.durationMs = Date.now() - state.startedAt;
  state.currentPath = state.root;
}
