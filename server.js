/**
 * server.js
 * DiskLens 本地服务：静态页面 + REST API。
 * 只监听 127.0.0.1，不对外暴露；零第三方依赖。
 *   node server.js            启动（默认 8787，被占用则顺延）
 *   node server.js --open     启动并打开浏览器
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startScan, getScan, cancelScan } from './scanner.js';
import { trashItems } from './trash.js';
import { buildDemo } from './demo.js';
import { isProtectedPath } from './rules.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function config() {
  const home = os.homedir();
  const candidates = [
    { label: '用户主目录', path: home },
    { label: '下载', path: path.join(home, 'Downloads') },
    { label: '桌面', path: path.join(home, 'Desktop') },
    { label: '文档', path: path.join(home, 'Documents') },
    { label: '图片', path: path.join(home, 'Pictures') },
    { label: '视频', path: path.join(home, 'Videos') },
    { label: '应用缓存', path: path.join(home, 'AppData', 'Local') },
    { label: '项目目录', path: path.join(home, 'Projects') },
  ];
  const shortcuts = [];
  for (const c of candidates) if (await exists(c.path)) shortcuts.push(c);
  return {
    platform: process.platform,
    home,
    defaultRoot: home,
    shortcuts,
    node: process.version,
  };
}

function drives() {
  const out = [];
  const read = (label, root) => {
    try {
      const s = fs.statfsSync(root);
      const total = Number(s.blocks * s.bsize);
      const free = Number(s.bavail * s.bsize);
      if (total > 0) out.push({ name: label, path: root, total, free, used: total - free });
    } catch { /* 不可访问的盘符跳过 */ }
  };
  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const root = `${letter}:\\`;
      if (fs.existsSync(root)) read(`${letter}: 盘`, root);
    }
  } else {
    read('系统盘', '/');
  }
  return out;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 忽略 */ }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/health') return sendJson(res, 200, { ok: true });

    if (req.method === 'GET' && p === '/api/config') return sendJson(res, 200, await config());

    if (req.method === 'GET' && p === '/api/drives') return sendJson(res, 200, { drives: drives() });

    if (req.method === 'GET' && p === '/api/demo') return sendJson(res, 200, buildDemo());

    if (req.method === 'POST' && p === '/api/scan') {
      const body = await readJson(req);
      const root = path.resolve(String(body.root || os.homedir()));
      if (!await exists(root)) return sendJson(res, 400, { error: '目录不存在或无权限：' + root });
      const id = startScan(root, body);
      return sendJson(res, 200, { id, root });
    }

    if (req.method === 'GET' && p === '/api/scan/status') {
      const s = getScan(url.searchParams.get('id'));
      if (!s) return sendJson(res, 404, { error: '扫描任务不存在' });
      return sendJson(res, 200, {
        id: s.id, state: s.state, phase: s.phase, progress: s.progress,
        scannedFiles: s.scannedFiles, scannedDirs: s.scannedDirs,
        currentPath: s.currentPath, durationMs: Date.now() - s.startedAt,
        error: s.error, root: s.root,
      });
    }

    if (req.method === 'GET' && p === '/api/scan/result') {
      const s = getScan(url.searchParams.get('id'));
      if (!s) return sendJson(res, 404, { error: '扫描任务不存在' });
      if (!s.result) return sendJson(res, 202, { state: s.state, progress: s.progress });
      return sendJson(res, 200, s.result);
    }

    if (req.method === 'POST' && p === '/api/scan/cancel') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: cancelScan(body.id) });
    }

    if (req.method === 'POST' && p === '/api/trash') {
      const body = await readJson(req);
      const s = getScan(body.id);
      if (!s || !s.result) return sendJson(res, 400, { error: '请先完成一次扫描' });
      if (s.result.meta.demo) return sendJson(res, 400, { error: '演示数据不可执行清理，请扫描真实目录' });
      const out = await trashItems(s.result.meta.root, body.items, body.confirmed === true);
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && p === '/api/reveal') {
      const body = await readJson(req);
      const target = path.resolve(String(body.path || ''));
      if (isProtectedPath(target) || !await exists(target)) {
        return sendJson(res, 400, { error: '路径不可访问' });
      }
      if (process.platform === 'win32') spawn('explorer', ['/select,', target], { stdio: 'ignore' });
      else if (process.platform === 'darwin') spawn('open', ['-R', target], { stdio: 'ignore' });
      else spawn('xdg-open', [path.dirname(target)], { stdio: 'ignore' });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      serveStatic(req, res, p);
      return;
    }
    sendJson(res, 404, { error: '未知接口' });
  } catch (err) {
    sendJson(res, 500, { error: err?.message || String(err) });
  }
});

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 12) {
      listen(port + 1, attempt + 1);
    } else {
      console.error('启动失败：', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}`;
    console.log('');
    console.log('  DiskLens 已启动');
    console.log('  ------------------------------------------');
    console.log(`  打开地址：${url}`);
    console.log(`  服务目录：${PUBLIC}`);
    console.log('  按 Ctrl+C 停止服务');
    console.log('');
    if (process.argv.includes('--open')) openBrowser(url);
  });
}

listen(Number(process.env.PORT) || 8787);
