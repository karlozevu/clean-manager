/**
 * trash.js
 * 安全清理模块：只做「移入系统回收站」，绝不永久删除。
 * 强制约束：必须在本次扫描根目录内、路径白名单校验、单批最多 10 项、显式确认。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isProtectedPath, isDriveRoot, PROTECTED_NAMES } from './rules.js';

const execFileAsync = promisify(execFile);
export const MAX_BATCH = 10;

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 逐项校验，返回 {accepted, rejected} */
export async function validateTargets(root, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('没有待清理的项目');
  }
  if (items.length > MAX_BATCH) {
    throw new Error(`单批最多 ${MAX_BATCH} 项，请分批执行`);
  }
  const rootAbs = path.resolve(root);
  let rootReal;
  try {
    rootReal = await fsp.realpath(rootAbs);
  } catch {
    throw new Error('扫描根目录不可访问');
  }
  if (isDriveRoot(rootAbs)) throw new Error('不允许以磁盘根目录作为清理范围');

  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of items) {
    const p = path.resolve(String(raw?.path || raw));
    const reason = (msg) => rejected.push({ path: p, reason: msg });

    if (seen.has(p.toLowerCase())) { reason('重复项目'); continue; }
    seen.add(p.toLowerCase());

    if (!inside(p, rootAbs) || p.toLowerCase() === rootAbs.toLowerCase()) {
      reason('不在本次扫描范围内'); continue;
    }
    if (isDriveRoot(p) || isProtectedPath(p)) {
      reason('系统关键路径，禁止清理'); continue;
    }
    if (PROTECTED_NAMES.has(path.basename(p).toLowerCase())) {
      reason('系统保护项'); continue;
    }
    let real;
    try {
      real = await fsp.realpath(p);
    } catch {
      reason('文件或目录不存在'); continue;
    }
    if (!inside(real, rootReal)) {
      reason('链接指向扫描范围之外，已拦截'); continue;
    }
    accepted.push({ path: p, size: Number(raw?.size) || 0 });
  }
  return { accepted, rejected };
}

function buildWindowsScript(paths) {
  const payload = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64');
  // 用 base64 传路径，彻底规避引号/空格/中文路径的转义问题
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `$list = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    'foreach ($p in $list) {',
    '  try {',
    '    if (Test-Path -LiteralPath $p -PathType Container) {',
    '      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)',
    '    } else {',
    '      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)',
    '    }',
    "    Write-Output ('OK|' + $p)",
    '  } catch {',
    "    $msg = ($_.Exception.Message -replace '[\\r\\n]+', ' ')",
    "    Write-Output ('ERR|' + $p + '|' + $msg)",
    '  }',
    '}',
  ].join('\n');
}

async function trashWindows(paths) {
  const script = buildWindowsScript(paths);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
  );
  return String(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('OK|') || l.startsWith('ERR|'))
    .map((l) => {
      const parts = l.split('|');
      return parts[0] === 'OK'
        ? { path: parts.slice(1).join('|'), ok: true }
        : { path: parts[1], ok: false, reason: parts.slice(2).join('|') || '回收站操作失败' };
    });
}

async function trashUnix(paths, platform) {
  if (platform === 'linux') {
    try {
      await execFileAsync('gio', ['trash', '--', ...paths], { timeout: 120000, windowsHide: true });
      // gio 不逐项报告，用存在性复核
      const results = [];
      for (const p of paths) {
        const still = await fsp.stat(p).then(() => true).catch(() => false);
        results.push({ path: p, ok: !still, reason: still ? '未能移入回收站' : undefined });
      }
      return results;
    } catch {
      // 落到手动移到废纸篓目录
    }
  } else {
    // macOS：Finder 移到废纸篓
    try {
      const expressions = paths.flatMap((p) => [
        '-e', `tell application "Finder" to delete (POSIX file ${JSON.stringify(p)} as alias)`,
      ]);
      await execFileAsync('osascript', expressions, { timeout: 120000, windowsHide: true });
      const results = [];
      for (const p of paths) {
        const still = await fsp.stat(p).then(() => true).catch(() => false);
        results.push({ path: p, ok: !still, reason: still ? '未能移入废纸篓' : undefined });
      }
      return results;
    } catch {
      // 落到手动移动
    }
  }

  // 兜底：移动到用户废纸篓目录（可恢复），绝不 rm
  const targetDir = platform === 'darwin'
    ? path.join(os.homedir(), '.Trash')
    : path.join(os.homedir(), '.local', 'share', 'Trash', 'files');
  await fsp.mkdir(targetDir, { recursive: true });
  const results = [];
  for (const p of paths) {
    try {
      const dest = path.join(targetDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(p)}`);
      await fsp.rename(p, dest);
      results.push({ path: p, ok: true, fallback: dest });
    } catch (err) {
      results.push({ path: p, ok: false, reason: err?.message || '移动失败' });
    }
  }
  return results;
}

/** 执行清理。confirmed 必须为 true。 */
export async function trashItems(root, items, confirmed) {
  if (confirmed !== true) throw new Error('需要显式确认后才能执行清理');
  const { accepted, rejected } = await validateTargets(root, items);
  if (!accepted.length) {
    return { ok: [], failed: rejected, freedBytes: 0, note: '没有符合安全条件的项目' };
  }

  let outcomes;
  try {
    outcomes = process.platform === 'win32'
      ? await trashWindows(accepted.map((a) => a.path))
      : await trashUnix(accepted.map((a) => a.path), process.platform);
  } catch (err) {
    outcomes = accepted.map((a) => ({ path: a.path, ok: false, reason: err?.message || '系统回收站调用失败' }));
  }

  const sizeByPath = new Map(accepted.map((a) => [a.path.toLowerCase(), a.size]));
  const ok = [];
  const failed = [...rejected];
  for (const r of outcomes) {
    const size = sizeByPath.get(String(r.path).toLowerCase()) || 0;
    if (r.ok) ok.push({ path: r.path, size });
    else failed.push({ path: r.path, reason: r.reason || '未能移入回收站' });
  }
  return {
    ok,
    failed,
    freedBytes: ok.reduce((s, o) => s + o.size, 0),
    note: '文件已移入系统回收站，可在回收站中还原；本工具不会永久删除。',
  };
}
