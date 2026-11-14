/**
 * demo.js
 * 生成结构完全一致的演示数据，用于不扫描真实磁盘时预览界面效果。
 * 演示模式下前端会禁用真实清理操作。
 */
import { FILE_TYPES, SOFTWARE_RULES, RISK_META } from './rules.js';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 24 * 60 * 60 * 1000;
const R = 'C:\\Users\\Demo';
const now = Date.now();

function d(full, size, fileCount, children = []) {
  const parts = full.split('\\');
  return {
    name: parts[parts.length - 1] || full,
    path: full,
    size,
    fileCount,
    dirCount: children.length,
    children,
  };
}

function f(full, size, type, daysAgo = 20) {
  const parts = full.split('\\');
  return {
    name: parts[parts.length - 1],
    path: full,
    size,
    mtime: now - daysAgo * DAY,
    type,
  };
}

export function buildDemo() {
  const tree = d(R, 0, 0, [
    d(`${R}\\AppData`, 62 * GB, 41200, [
      d(`${R}\\AppData\\Local`, 48 * GB, 31800, [
        d(`${R}\\AppData\\Local\\Temp`, 9.4 * GB, 12400),
        d(`${R}\\AppData\\Local\\Programs`, 14 * GB, 6800),
        d(`${R}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache`, 8.2 * GB, 5200),
        d(`${R}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cache`, 5.1 * GB, 3100),
        d(`${R}\\AppData\\Local\\JetBrains`, 6.8 * GB, 2400),
        d(`${R}\\AppData\\Local\\npm-cache`, 4.3 * GB, 1900),
      ]),
      d(`${R}\\AppData\\Roaming`, 14 * GB, 9400, [
        d(`${R}\\AppData\\Roaming\\Tencent\\WeChat Files`, 9.2 * GB, 6100),
        d(`${R}\\AppData\\Roaming\\DingTalk`, 3.1 * GB, 2100),
        d(`${R}\\AppData\\Roaming\\其他应用`, 1.7 * GB, 1200),
      ]),
    ]),
    d(`${R}\\Videos`, 34 * GB, 820, [
      d(`${R}\\Videos\\2025 旅行`, 15 * GB, 320),
      d(`${R}\\Videos\\录屏`, 11 * GB, 280),
      d(`${R}\\Videos\\未整理`, 8 * GB, 220),
    ]),
    d(`${R}\\Projects`, 48 * GB, 68400, [
      d(`${R}\\Projects\\work-api`, 18 * GB, 28000, [
        d(`${R}\\Projects\\work-api\\node_modules`, 9.2 * GB, 22400),
        d(`${R}\\Projects\\work-api\\dist`, 3.1 * GB, 1200),
        d(`${R}\\Projects\\work-api\\src`, 0.4 * GB, 820),
        d(`${R}\\Projects\\work-api\\.git`, 5.3 * GB, 3580),
      ]),
      d(`${R}\\Projects\\personal-site`, 12 * GB, 18600, [
        d(`${R}\\Projects\\personal-site\\node_modules`, 5.6 * GB, 14200),
        d(`${R}\\Projects\\personal-site\\.next\\cache`, 2.4 * GB, 1600),
      ]),
      d(`${R}\\Projects\\data-analysis`, 10 * GB, 12200),
      d(`${R}\\Projects\\old-archive`, 8 * GB, 9600),
    ]),
    d(`${R}\\Downloads`, 38.6 * GB, 1420, [
      d(`${R}\\Downloads\\安装包`, 12 * GB, 180),
      d(`${R}\\Downloads\\压缩包`, 9 * GB, 240),
      d(`${R}\\Downloads\\视频`, 11 * GB, 160),
      d(`${R}\\Downloads\\其他`, 6.6 * GB, 840),
    ]),
    d(`${R}\\Pictures`, 22 * GB, 6820, [
      d(`${R}\\Pictures\\照片原图`, 13 * GB, 3200),
      d(`${R}\\Pictures\\截图`, 5.4 * GB, 2800),
      d(`${R}\\Pictures\\设计稿`, 3.6 * GB, 820),
    ]),
    d(`${R}\\Documents`, 12 * GB, 4260, [
      d(`${R}\\Documents\\报告`, 5.2 * GB, 1420),
      d(`${R}\\Documents\\表格`, 3.1 * GB, 980),
      d(`${R}\\Documents\\其他`, 3.7 * GB, 1860),
    ]),
    d(`${R}\\Music`, 9 * GB, 1240),
    d(`${R}\\Desktop`, 6 * GB, 620),
    d(`${R}\\其他`, 5.3 * GB, 810),
  ]);

  const totalBytes = tree.children.reduce((s, c) => s + c.size, 0);
  tree.size = totalBytes;
  tree.fileCount = tree.children.reduce((s, c) => s + c.fileCount, 0);
  tree.dirCount = tree.children.reduce((s, c) => s + c.dirCount + 1, 0);

  const weights = [0.24, 0.14, 0.05, 0.08, 0.11, 0.06, 0.07, 0.03, 0.16, 0.06];
  const types = FILE_TYPES.map((t, i) => ({
    key: t.key, label: t.label, color: t.color,
    bytes: Math.round(totalBytes * weights[i]),
    count: Math.round(tree.fileCount * (weights[i] * 0.8 + 0.02)),
  })).sort((a, b) => b.bytes - a.bytes);

  const picks = [
    ['temp', 9.4 * GB, [`${R}\\AppData\\Local\\Temp`]],
    ['wechat', 9.2 * GB, [`${R}\\AppData\\Roaming\\Tencent\\WeChat Files`]],
    ['node_modules', 14.8 * GB, [`${R}\\Projects\\work-api\\node_modules`, `${R}\\Projects\\personal-site\\node_modules`]],
    ['chrome', 8.2 * GB, [`${R}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache`]],
    ['edge', 5.1 * GB, [`${R}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cache`]],
    ['jetbrains', 6.8 * GB, [`${R}\\AppData\\Local\\JetBrains`]],
    ['npm', 4.3 * GB, [`${R}\\AppData\\Local\\npm-cache`]],
    ['dingtalk', 3.1 * GB, [`${R}\\AppData\\Roaming\\DingTalk`]],
    ['build', 5.5 * GB, [`${R}\\Projects\\work-api\\dist`, `${R}\\Projects\\personal-site\\.next\\cache`]],
    ['downloads', 38.6 * GB, [`${R}\\Downloads`]],
    ['winupdate', 4.6 * GB, [`C:\\Windows\\SoftwareDistribution\\Download`]],
    ['thumb', 1.2 * GB, [`${R}\\AppData\\Local\\Microsoft\\Windows\\Explorer`]],
    ['crash', 0.9 * GB, [`${R}\\AppData\\Local\\CrashDumps`]],
  ];
  const software = picks.map(([id, bytes, paths]) => {
    const rule = SOFTWARE_RULES.find((r) => r.id === id);
    return {
      id: rule.id, name: rule.name, short: rule.short, category: rule.category,
      color: rule.color, risk: rule.risk, advice: rule.advice,
      bytes, fileCount: Math.round(bytes / (1.4 * MB)),
      dirs: paths.map((p, i) => ({ path: p, name: p.split('\\').pop(), size: i === 0 ? bytes : Math.round(bytes * 0.2) })),
      potentialBytes: Math.round(bytes * (RISK_META[rule.risk]?.ratio ?? 0)),
      riskLabel: RISK_META[rule.risk]?.label || '未知',
    };
  }).sort((a, b) => b.bytes - a.bytes);

  const largeFiles = [
    f(`${R}\\Downloads\\安装包\\VisualStudio2026.iso`, 8.6 * GB, 'archive', 40),
    f(`${R}\\Videos\\2025 旅行\\青海湖_原片.mov`, 6.2 * GB, 'video', 210),
    f(`${R}\\Downloads\\视频\\课程合集.mp4`, 4.8 * GB, 'video', 95),
    f(`${R}\\Projects\\data-analysis\\model_final.pkl`, 3.9 * GB, 'data', 60),
    f(`${R}\\Documents\\报告\\2024年度汇总.pptx`, 2.7 * GB, 'document', 420),
    f(`${R}\\Downloads\\压缩包\\素材备份.7z`, 2.4 * GB, 'archive', 500),
    f(`${R}\\Videos\\录屏\\产品演示_4K.mp4`, 2.1 * GB, 'video', 330),
    f(`${R}\\Downloads\\安装包\\office_setup.exe`, 1.6 * GB, 'installer', 620),
    f(`${R}\\Projects\\old-archive\\dataset.zip`, 1.4 * GB, 'archive', 740),
    f(`${R}\\Pictures\\照片原图\\婚礼原片.rar`, 1.2 * GB, 'archive', 810),
  ];

  const oldFiles = largeFiles.slice(4).map((x, i) => ({ ...x, mtime: now - (400 + i * 65) * DAY }));

  function dupGroup(name, size, count, folder, days) {
    return {
      size, count, hash: name.slice(0, 12).padEnd(12, '0'),
      wasteBytes: size * (count - 1),
      files: Array.from({ length: count }, (_, i) => f(`${folder}\\${name.replace('#', i + 1)}`, size, 'archive', days + i)),
    };
  }
  const duplicates = [
    dupGroup('素材备份 #.zip', 2.4 * GB, 3, `${R}\\Downloads\\压缩包`, 120),
    dupGroup('年度汇总_副本 #.pptx', 860 * MB, 2, `${R}\\Documents\\报告`, 300),
    dupGroup('演示视频_导出 #.mp4', 1.1 * GB, 4, `${R}\\Videos\\录屏`, 210),
    dupGroup('dataset_v# .zip'.replace(' ', ''), 1.4 * GB, 2, `${R}\\Projects\\old-archive`, 620),
    dupGroup('封面图_最终版 #.psd', 420 * MB, 3, `${R}\\Pictures\\设计稿`, 180),
  ].sort((a, b) => b.wasteBytes - a.wasteBytes);

  const duplicateWaste = duplicates.reduce((s, x) => s + x.wasteBytes, 0);
  const softwareWaste = software.reduce((s, x) => s + x.potentialBytes, 0);

  return {
    meta: {
      scanId: 'demo', root: R, generatedAt: new Date().toISOString(),
      durationMs: 1840, truncated: false, platform: process.platform, demo: true,
    },
    summary: {
      totalBytes,
      fileCount: tree.fileCount,
      dirCount: tree.dirCount,
      potentialBytes: softwareWaste + duplicateWaste,
    },
    tree, types, software,
    topFolders: tree.children.map((c) => ({ name: c.name, path: c.path, size: c.size, fileCount: c.fileCount })),
    largeFiles, oldFiles, duplicates,
  };
}
