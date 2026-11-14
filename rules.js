/**
 * rules.js
 * 文件类型分类、软件/缓存识别规则、系统保护路径。
 * 纯数据 + 纯函数，不依赖任何第三方包。
 */

export const FILE_TYPES = [
  { key: 'video',      label: '视频',       color: '#EE7A5F', exts: ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','ts','rmvb','mpg','mpeg','3gp','vob','mts','m2ts'] },
  { key: 'image',      label: '图片',       color: '#E9A84B', exts: ['jpg','jpeg','png','gif','bmp','webp','tif','tiff','heic','heif','svg','psd','raw','cr2','nef','ico'] },
  { key: 'audio',      label: '音频',       color: '#8B7BE8', exts: ['mp3','wav','flac','aac','m4a','ogg','wma','aiff','ape','opus','mid'] },
  { key: 'document',   label: '文档',       color: '#4E86E8', exts: ['doc','docx','pdf','xls','xlsx','ppt','pptx','txt','md','rtf','csv','epub','mobi','pages','numbers','key','odt','wps','et','dps'] },
  { key: 'archive',    label: '压缩包/镜像', color: '#52B39B', exts: ['zip','rar','7z','tar','gz','bz2','xz','iso','dmg','img','tgz','cab','vhd','vhdx','zst','lz4'] },
  { key: 'installer',  label: '程序/安装包', color: '#E8739B', exts: ['exe','msi','msix','appx','apk','deb','rpm','dmg','pkg','app','dll','so','dylib','bin'] },
  { key: 'code',       label: '代码/工程',   color: '#5B6BE1', exts: ['js','mjs','cjs','ts','tsx','jsx','py','java','go','rs','c','cpp','h','hpp','cs','rb','php','swift','kt','vue','html','css','scss','json','yaml','yml','xml','sql','sh','ps1','bat','ipynb'] },
  { key: 'data',       label: '数据/数据库', color: '#6C9BCF', exts: ['db','sqlite','sqlite3','mdb','accdb','parquet','arrow','h5','hdf5','dat','bak','dump','pst','ost'] },
  { key: 'cache',      label: '缓存/日志',   color: '#9AA4B6', exts: ['log','tmp','temp','cache','cachedata','crdownload','part','dmp','etl','trace','lock'] },
  { key: 'other',      label: '其他',       color: '#B7BDCA', exts: [] },
];

const EXT_MAP = new Map();
for (const type of FILE_TYPES) {
  for (const ext of type.exts) EXT_MAP.set(ext, type.key);
}

export function typeOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'other';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_MAP.get(ext) || 'other';
}

export function typeMeta(key) {
  return FILE_TYPES.find((t) => t.key === key) || FILE_TYPES[FILE_TYPES.length - 1];
}

export function toSlash(p = '') {
  return String(p).replace(/\\/g, '/');
}

/**
 * risk:
 *  safe    - 可再生缓存，清理风险低
 *  caution - 可能含个人文件，需人工确认
 *  risky   - 系统/程序目录，不建议直接清理
 */
export const SOFTWARE_RULES = [
  // 浏览器
  { id:'chrome',  name:'Chrome 浏览器缓存', short:'Ch', category:'浏览器', color:'#4E86E8', risk:'safe',    advice:'网页缓存、代码缓存，浏览器会自动重建，不影响书签与密码。', match:['google/chrome/user data/default/cache','google/chrome/user data/default/code cache','google/chrome/user data/default/service worker','google/chrome/user data/default/gpucache','google/chrome/user data/default/media cache','chrome/user data/default/cache','/chrome/cache'] },
  { id:'edge',    name:'Edge 浏览器缓存',   short:'Ed', category:'浏览器', color:'#3E7FD8', risk:'safe',    advice:'Edge 的网页缓存与 GPU 缓存，可安全清理。', match:['microsoft/edge/user data/default/cache','microsoft/edge/user data/default/code cache','microsoft/edge/user data/default/service worker','/edge/user data/default/cache'] },
  { id:'firefox', name:'Firefox 缓存',      short:'Fx', category:'浏览器', color:'#E8834A', risk:'safe',    advice:'Firefox cache2 目录，可安全清理。', match:['mozilla/firefox/profiles','/firefox/cache2','mozilla/firefox'] },
  { id:'safari',  name:'Safari 缓存',       short:'Sf', category:'浏览器', color:'#4E9BD8', risk:'safe',    advice:'Safari 缓存数据库（macOS）。', match:['library/caches/com.apple.safari','/safari/cache'] },

  // 通讯与办公
  { id:'wechat',  name:'微信文件',          short:'微信', category:'通讯办公', color:'#3AAE7C', risk:'caution', advice:'聊天接收的图片、视频与文件。重要资料请先备份，再按时间清理。', match:['wechat files','weixin/files','tencent/wechat','/weixin/','微信文件','wechat/cache'] },
  { id:'qq',      name:'QQ 文件',           short:'QQ', category:'通讯办公', color:'#4E9BE8', risk:'caution', advice:'QQ 接收文件与图片缓存，清理前确认重要文件。', match:['tencent/qq','/qqnt/','qq/file Recv','documents/tencent files','/qq/files'] },
  { id:'wecom',   name:'企业微信',          short:'企微', category:'通讯办公', color:'#3E8FD8', risk:'caution', advice:'企业微信的缓存与接收文件，可能含工作资料。', match:['wxwork','企业微信','weCom'] },
  { id:'dingtalk',name:'钉钉',              short:'钉钉', category:'通讯办公', color:'#3E86E8', risk:'caution', advice:'钉钉缓存与下载文件，可能含工作资料。', match:['dingtalk','/dingtalk/','钉钉'] },
  { id:'feishu',  name:'飞书 / Lark',       short:'飞书', category:'通讯办公', color:'#4A8FE0', risk:'caution', advice:'飞书本地缓存与下载文件。', match:['/feishu/','/lark/','bytedance/feishu','飞书'] },
  { id:'meeting', name:'会议软件缓存',      short:'会议', category:'通讯办公', color:'#5B8FD8', risk:'safe',    advice:'腾讯会议 / Zoom 的录制缓存与日志。', match:['tencent meeting','/zoom/','/wemeet/','腾讯会议'] },

  // 开发工具与包缓存
  { id:'node_modules', name:'node_modules 依赖', short:'NM', category:'开发工具', color:'#5B6BE1', risk:'safe', advice:'前端项目依赖目录，删除后可重新 npm install 恢复。', match:['/node_modules','node_modules'] },
  { id:'npm',     name:'npm / pnpm / yarn 缓存', short:'npm', category:'开发工具', color:'#C2544B', risk:'safe', advice:'包管理器下载缓存，删除不影响已安装依赖。', match:['/.npm/','/npm-cache','/pnpm/store','/.yarn/cache','/.cache/yarn','/npm/_cacache','/caches/pnpm'] },
  { id:'pip',     name:'Python 缓存',       short:'Py', category:'开发工具', color:'#3E7BA8', risk:'safe', advice:'pip 缓存、__pycache__ 字节码，会自动重建。', match:['/pip/cache','/__pycache__','/.cache/pip','/python/cache','/site-packages/pip'] },
  { id:'gradle',  name:'Gradle / Maven 缓存', short:'Gr', category:'开发工具', color:'#3AA88C', risk:'safe', advice:'构建工具依赖缓存，下次构建会重新下载。', match:['/.gradle/','/gradle/caches','/.m2/repository','/maven/repository'] },
  { id:'cargo',   name:'Cargo / Go 缓存',   short:'Go', category:'开发工具', color:'#5B9BC9', risk:'safe', advice:'Rust / Go 模块缓存，可重新下载。', match:['/.cargo/registry','/go/pkg/mod','/gopath/pkg/mod'] },
  { id:'jetbrains',name:'JetBrains 索引缓存', short:'JB', category:'开发工具', color:'#8B6BE8', risk:'safe', advice:'IDE 索引与本地历史缓存，重启后自动重建。', match:['/jetbrains/','/idea/caches','/.idea/index','/google/androidstudio','/android/studio'] },
  { id:'vscode',  name:'VS Code 缓存',      short:'VS', category:'开发工具', color:'#3E8FD8', risk:'safe', advice:'编辑器缓存、扩展缓存，不影响已装扩展与设置。', match:['/code/cache','/code/cacheddata','/code/logs','/vscode/cache','/.vscode-server/'] },
  { id:'xcode',   name:'Xcode 派生数据',    short:'Xc', category:'开发工具', color:'#4E86E8', risk:'safe', advice:'DerivedData 构建产物，Xcode 会重新生成。', match:['/deriveddata','/xcode/deriveddata','/library/developer/xcode'] },
  { id:'build',   name:'编译产物',          short:'Bu', category:'开发工具', color:'#7A86A8', risk:'caution', advice:'dist / build / target / out 构建输出，确认无需离线产物再删。', match:['/dist/','/build/','/target/','/out/','/bin/obj/','/.next/cache','/coverage/'] },
  { id:'docker',  name:'Docker 数据',       short:'Dk', category:'开发工具', color:'#3E8FD8', risk:'risky',  advice:'镜像与容器数据，建议用 docker prune 命令清理而非直接删除。', match:['/docker/data','/library/containers/com.docker','/dockerdesktop/'] },

  // 系统缓存
  { id:'temp',    name:'系统临时文件',      short:'Tmp', category:'系统缓存', color:'#9AA4B6', risk:'safe', advice:'Temp 临时目录，长期积累可达数 GB。', match:['/appdata/local/temp','/local/temp','/windows/temp','/tmp/','/var/tmp/'] },
  { id:'winupdate',name:'Windows 更新缓存', short:'Upd', category:'系统缓存', color:'#8B96AC', risk:'caution', advice:'更新下载缓存，建议通过「磁盘清理」处理。', match:['/softwaredistribution/download','/windows/installer','/windows/winSxS/backup'] },
  { id:'thumb',   name:'缩略图 / 图标缓存', short:'缩', category:'系统缓存', color:'#8B7BE8', risk:'safe', advice:'缩略图缓存会自动重建。', match:['/microsoft/windows/explorer','/thumbcache','/iconcache','/library/caches/com.apple.finder'] },
  { id:'crash',   name:'崩溃转储与日志',    short:'Log', category:'系统缓存', color:'#A0A8B8', risk:'safe', advice:'崩溃转储、错误报告与旧日志，通常可安全清理。', match:['/crashdumps','/wer/','/reports/','/diagnostics/','/logs/','/library/logs/'] },
  { id:'recycle', name:'回收站',            short:'回收', category:'系统缓存', color:'#8E9AAB', risk:'risky',  advice:'建议通过系统「回收站」清空，本工具不直接处理。', match:['$recycle.bin','/.trash/','/recycler/'] },

  // 媒体与娱乐
  { id:'adobe',   name:'Adobe 媒体缓存',    short:'Ad', category:'设计软件', color:'#D8618B', risk:'safe', advice:'PR / AE / PS 的媒体缓存与预览文件，会自动重建。', match:['/adobe/common/media cache','/adobe/premiere pro','/adobe/after effects','/adobe/cache'] },
  { id:'spotify', name:'音乐客户端缓存',    short:'音', category:'媒体娱乐', color:'#3AAE7C', risk:'safe', advice:'Spotify / 网易云音乐的离线缓存。', match:['/spotify/storage','/spotify/users','/cloudmusic/cache','/neteasecloudmusic/'] },
  { id:'steam',   name:'游戏下载缓存',      short:'St', category:'游戏平台', color:'#4E6E9E', risk:'caution', advice:'Steam / Epic 的下载缓存与旧安装包，注意不要删已安装游戏目录。', match:['/steam/downloading','/steam/steamapps/downloading','/epicgameslauncher/download','/battle.net/cache'] },
  { id:'videoapp',name:'视频客户端缓存',    short:'视', category:'媒体娱乐', color:'#E8739B', risk:'safe', advice:'B 站 / 腾讯视频 / 爱奇艺的播放缓存。', match:['/bilibili/cache','/qqlive/cache','/iqiyi/cache','/youku/cache','/tencent/video'] },

  // 其他
  { id:'downloads',name:'下载文件夹',       short:'DL', category:'下载与文档', color:'#E9A84B', risk:'caution', advice:'长期积累的安装包与压缩包，建议按「大文件」逐个确认。', match:['/downloads','downloads','/下载','下载文件夹'] },
  { id:'desktop', name:'桌面文件',          short:'桌', category:'下载与文档', color:'#E9A84B', risk:'caution', advice:'桌面文件请人工确认，不建议整目录清理。', match:['/desktop','desktop','/桌面'] },
];

// 更具体的规则优先匹配
export const SORTED_SOFTWARE_RULES = [...SOFTWARE_RULES].sort((a, b) => {
  const la = Math.max(...a.match.map((m) => m.length));
  const lb = Math.max(...b.match.map((m) => m.length));
  return lb - la;
});

export const RISK_META = {
  safe:    { label: '低风险',   hint: '可再生成的缓存', ratio: 0.9 },
  caution: { label: '需确认',   hint: '可能包含个人文件', ratio: 0.45 },
  risky:   { label: '不建议',   hint: '建议用系统自带方式处理', ratio: 0 },
};

export function matchSoftware(relativePath = '') {
  const s = '/' + toSlash(relativePath).toLowerCase().replace(/^\/+/, '');
  for (const rule of SORTED_SOFTWARE_RULES) {
    for (const fragment of rule.match) {
      if (s.includes(fragment.startsWith('/') ? fragment : '/' + fragment)) return rule;
    }
  }
  return null;
}

/* ---------- 安全边界 ---------- */

// 扫描时跳过的系统项（大小写不敏感）
export const PROTECTED_NAMES = new Set([
  'system volume information', '$recycle.bin', '$recycler', 'config.msi',
  'windowsapps', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys',
  'bootmgr', 'ntldr', 'perflogs', 'system32', 'winsxs', '$windows.~ws',
]);

// 删除时绝对禁止的路径片段
export const PROTECTED_PATH_PARTS = [
  '/windows/system32', '/windows/winsxs', '/windows/servicing',
  '/program files/windowsapps', '/system/library', '/usr/bin', '/usr/lib',
  '/etc/', '/bin/', '/sbin/', '/boot/', '/proc/', '/dev/',
  '$recycle.bin', '/appdata/local/microsoft/windows',
];

export function isProtectedPath(p = '') {
  const s = ('/' + toSlash(p).toLowerCase().replace(/^\/+/, '')).replace(/\/+/g, '/');
  return PROTECTED_PATH_PARTS.some((part) => s.includes(part));
}

export function isDriveRoot(p = '') {
  return /^[A-Za-z]:[\\/]?$/.test(String(p).trim()) || p === '/' || p === '';
}
