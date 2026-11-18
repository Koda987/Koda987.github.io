/**
 * 鲸鱼桌面宠物 — 在页面底部走动的小家伙,可以摸头(光标在她身上蹭一会儿会冒爱心)、
 * 按住拖拽、甩出去会翻滚落地。渲染与行为引擎来自开源项目 Coopanion(assets/pet/vendor/)。
 *
 * 页面只需引入本模块即可,舞台 DOM 由脚本自己插入:
 *   <script type="module" src="assets/pet/pet.js?v=…"></script>
 *
 * 加载策略:首次访问等页面 load 后的空闲时机初始化,约 2MB 贴图不影响首屏;
 * 翻页续访则立即启动(贴图已缓存),配合 #pet-stage 的 view-transition-name,
 * 切页时她作为独立过渡组从旧页平滑接力,不闪不蹦。
 * 减弱动效(prefers-reduced-motion)、无 WebGL、窄屏(≤600px)时整个不出现;
 * 跨页位置用 sessionStorage 接续,翻页时她会从上一页停下的地方继续走。
 */
import { createPet } from './vendor/kit/body.js';
window.addEventListener('error', e => { (window.__petErrs = window.__petErrs || []).push(e.message + ' @' + e.lineno); });
window.addEventListener('unhandledrejection', e => { (window.__petErrs = window.__petErrs || []).push('REJ: ' + ((e.reason && e.reason.message) || e.reason)); });

import { createWhaleFigure } from './vendor/whale/figure.js';
import { createVoice, textSteps, STEP_MS } from './voice.js';

/* ---------- 资源接续缓存(IndexedDB) ----------
   跨页过渡结束的瞬间,新页引擎还要重新拉模型与贴图、建 WebGL 纹理,
   舞台这段时间是空的 → 宠物"消失一会儿"才出现。
   把全部 pet 资源存进 IndexedDB,翻页时秒读秒显(不赌 HTTP 缓存与网络) */
const PET_ASSETS_V = 2;
const petMem = new Map();
const petIDB = {
  _p: null,   // 复用同一个连接(原来每次都重开,几十个请求并发时把 IDB 堵死)
  /* 打开带超时保险:个别时候 open 的回调一个都不来(存储忙/被挤),不能让整条加载链陪葬——
     超时就当没有 IDB(回落 HTTP),并清掉记忆化的坏连接 promise,下次重试 */
  open() { return (this._p && !this._p.__dead) ? this._p : (this._p = (() => { let done = false;
      const p = new Promise(res => { try { const q = indexedDB.open('koda-pet-assets', 1);
          q.onupgradeneeded = () => { const db = q.result; if (!db.objectStoreNames.contains('res')) db.createObjectStore('res'); };
          q.onsuccess = () => { if (!done) { done = true; res(q.result); } };
          q.onerror = () => { if (!done) { done = true; p.__dead = true; res(null); } };
          q.onblocked = () => { if (!done) { done = true; p.__dead = true; res(null); } };
          setTimeout(() => { if (!done) { done = true; p.__dead = true; res(null); } }, 600);
        } catch { done = true; p.__dead = true; res(null); } });
      return p; })()); },
  /* 按 key 取一条(原来每次 all() 全库读回,400+ 个 blob 把并发请求全部堵住,换装加载分钟级无响应) */
  get: url => petIDB.open().then(db => !db ? null : new Promise(res => {
      try { let done = false; const fin = v => { if (!done) { done = true; res(v || null); } };
        const os = db.transaction('res').objectStore('res');
        const q = os.get(url);
        q.onsuccess = () => { const hit = q.result;
          if (!hit) return fin(null);
          /* 版本不符的旧缓存一律当无效——不然资产更新(model.json/贴图换版)后,
             访客永远拿旧 blob,换装/配色就会出现新旧混杂的诡异故障 */
          const vq = os.get('<<ver>>');
          vq.onsuccess = () => fin(String(vq.result) === String(PET_ASSETS_V) ? hit : null);
          vq.onerror = () => fin(null); };
        q.onerror = () => fin(null);
        setTimeout(() => fin(null), 600);   // 单条读卡住也放行,别堵加载链
      } catch { res(null); } })),
  all: () => petIDB.open().then(db => !db ? null : new Promise(res => {
      try { let done = false; const fin = v => { if (!done) { done = true; res(v); } };
        const os = db.transaction('res').objectStore('res');
        const gk = os.getAllKeys(), gv = os.getAll(); let k = null, v = null, n = 0;
        gk.onsuccess = () => { k = gk.result; if (++n === 2) fin([k, v]); };
        gv.onsuccess = () => { v = gv.result; if (++n === 2) fin([k, v]); };
        gk.onerror = gv.onerror = () => fin(null);
        setTimeout(() => fin(null), 1500);   // 预热读卡住就放弃这次预热
      } catch { res(null); } })),
  put: (url, blob) => petIDB.open().then(db => { if (!db) return;
      try { const tx = db.transaction('res', 'readwrite');
        tx.objectStore('res').put(blob, url);
        tx.objectStore('res').put(new Blob([String(PET_ASSETS_V)]), '<<ver>>');
        tx.oncomplete = () => {}; tx.onerror = () => {}; } catch { /* 存不进就算了,内存里还有 */ } }),
};
const isPetAsset = u => { try { return /\/pet\/vendor\//.test(new URL(u, location.href).href) } catch { return false; } };
const rawFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!isPetAsset(url)) return rawFetch(input, init);
  if (petMem.has(url)) return Promise.resolve(new Response(petMem.get(url).slice(0)));
  return petIDB.get(url).then(hit => {
    if (hit) { petMem.set(url, hit); return new Response(hit.slice(0)); }
    return rawFetch(input, init).then(r => { if (r.ok) r.clone().blob()
      .then(b => { petMem.set(url, b); petIDB.put(url, b); }).catch(() => {});
      return r; });
  });
};
/* 贴图走 new Image().src(figure.js 内部),同样接缓存:命中直接给 blob: 地址,零网络;
   未命中立刻放行原生加载(续访时预热已把 IDB 装进内存,不会走到这),后台补缓存,绝不让她等 IDB */
/* 贴图走原生 new Image().src(HTTP),与官网完全一致——不再拦 Image 喂 blob 地址:
   个别显卡驱动对「blob 图解码后上传」有兼容问题(整套部件传成纯蓝色块),
   官网原生路径没有这个毛病。缓存保留在 fetch 路径(model.json 等),HTTP 缓存负责贴图提速 */
// 续访预热:把 IDB 里的资源提前读进内存(版本不符即弃用,走首次加载路径重建)
petIDB.all().then(([keys, vals]) => { if (!keys) return;
  const vi = keys.indexOf('<<ver>>');
  if (vi !== -1 && new TextDecoder().decode(vals[vi]) !== String(PET_ASSETS_V)) return;
  keys.forEach((k, i) => { if (k !== '<<ver>>') petMem.set(k, vals[i]); });
}).catch(() => {});

/* ---------- 门控 ---------- */
const webglOK = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
})();
const ready = () => matchMedia('(prefers-reduced-motion: reduce)').matches || !webglOK;   // 手机端也启用(官网同款);窄屏由 --pet-s 与站位公式自适应

/* 舞台宽度 = 视口宽度:漫游目标永远在屏内,她不会长时间走到看不见的地方 */
const pageW = () => document.documentElement.clientWidth || innerWidth;
const stateKey = 'koda.pet.v1';

function saveState(xr, facing) {
  try { sessionStorage.setItem(stateKey, JSON.stringify({ xr, facing })); } catch { /* 隐私模式等,存不进就算了 */ }
}
function loadState() {
  try { return JSON.parse(sessionStorage.getItem(stateKey)); } catch { return null; }
}
const prev = loadState();   // 上页留下的位置;有它 = 续访,新页要立即把她接回来

/* ---------- 舞台:模块一执行(首帧渲染前)就同步建好 ----------
   跨文档 View Transition 截取新页快照时,#pet-stage 必须已带着 view-transition-name
   在 DOM 里,旧页的她才能作为独立过渡组平滑接力过来,而不是消失后重新蹦出。 */
let stage = null, svgEl = null;
if (!ready()) {
  /* fixed 恰好覆盖视口;整层 pointer-events:none,鼠标交互全部走
     document 级监听 + 引擎自己的命中测试,不挡页面任何点击。
     舞台 DOM 由各页 body 开头的内联脚本在首帧前建好(跨文档过渡的配对前提,
     否则切页瞬间旧快照宠物变孤儿飞走、新宠物又活过来 = 两只);
     这里找不到才兜底自建(比如内联脚本被扩展拦掉) */
  stage = document.getElementById('pet-stage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'pet-stage';
    stage.innerHTML =
      '<svg aria-hidden="true">' +
        '<ellipse class="shadow" cx="0" cy="0" rx="0" ry="0"/>' +
        '<g class="pet"></g>' +
        '<g class="fx"></g>' +
      '</svg>';
    document.body.appendChild(stage);
  }
  svgEl = stage.querySelector('svg');
}

/* 角色比例:与官网一致——基础 0.78,矮窗口缩到 0.86 倍,大屏(≥1600/1900/2400 宽)逐级放大;
   --pet-s 留作整体微调旋钮,默认 1 */
const petScale = () => {
  const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--pet-s'));
  /* 未定义时 getPropertyValue 给空串,Number('') = 0 且是有限数——会把整个宠物缩到 0
     (抓取页等不加载 style.css 的页面宠物直接隐形);0/负数一律按 1 处理 */
  const k = Number.isFinite(s) && s > 0 ? s : 1;
  const big = innerWidth >= 2400 && innerHeight >= 1300 ? 1.35
    : innerWidth >= 1900 && innerHeight >= 1000 ? 1.2
    : innerWidth >= 1600 && innerHeight >= 860 ? 1.1 : 1;
  const small = innerWidth <= 600 ? .72 : 1;   // 手机:宠物缩一号,留出屏幕给内容
  return k * .78 * big * small * (innerHeight < 650 ? .86 : 1);
};
const bounds = () => ({
  W: pageW(),
  H: innerHeight,
  floorY: innerHeight - 26,
  S: petScale(),
});
const fit = () => {
  const b = bounds();
  stage.style.width = `${b.W}px`;
  stage.style.height = `${b.H}px`;
  svgEl.setAttribute('width', b.W);
  svgEl.setAttribute('height', b.H);
};
if (stage) fit();

const TRANSPARENT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/* 官网换装系统:贴图兜底加载器——非 deepseek 配色缺 skirt_shadow 等个别贴图(上游如此),
   404 时回退到 deepseek 的同名贴图;连兜底都没有就给透明像素,绝不让整套配色加载失败 */
const petImgLoad = url => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; });
const decodeImg = img => {
  if (!img.decode) return Promise.resolve(img);
  /* decode():img.onload 只代表字节到位,像素可能还没解完;引擎紧接着 texImage2D 上传,
     没解完的像素会被传成显存垃圾(整只蓝色积木块,线上站 vs 本地的经典差异——远端 53 张
     贴图并行解码时 decode 排队,本地快到看不出)。decode() 对游离于 DOM 之外的图片还可能
     极慢甚至永不落定(个别 Chromium):挂进屏外隐藏容器再解,基本秒解;超时只是最后保险 */
  const holder = decodeImg.d ??= Object.assign(document.createElement('div'),
    { style: 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none' });
  if (!holder.isConnected) (document.body || document.documentElement).appendChild(holder);
  holder.appendChild(img);
  return Promise.race([img.decode().catch(() => {}), new Promise(r => setTimeout(r, 5000))])
    .then(() => { if (img.parentNode === holder) holder.removeChild(img); return img; });
};
/* 本地服务器/连接偶发卡住时,图片 onload 可能迟迟不来:4 秒没动静就换一个全新请求重试一次 */
const petImgLoadRetry = url => new Promise((ok, bad) => {
  const im = new Image();
  window.__lp = window.__lp || { set: 0, ok: 0, err: 0, to: 0, last: '' };
  window.__lp.set++; window.__lp.last = url.split('/').slice(-2).join('/');
  const timer = setTimeout(() => { im.onload = im.onerror = null; window.__lp.to++; bad(); }, 4000);
  im.onload = () => { clearTimeout(timer); window.__lp.ok++; ok(im); };
  im.onerror = () => { clearTimeout(timer); window.__lp.err++; bad(); };
  im.src = url;
  if (im.complete) window.__lp.cached = (window.__lp.cached || 0) + 1;
});
/* 贴图加载:fetch→blob→createImageBitmap——位图本身就是解码完成的像素,从根上消灭
   "HTMLImageElement 解码时序(排队超时/永不落定)→texImage2D 传未解完像素→蓝色积木块"
   这一整类 bug(线上远端加载时必现,本地快到看不出)。顺带:fetch 走本模块顶部的
   IDB 拦截层,贴图在 IndexedDB 也有了缓存;引擎的 texImage2D/drawImage 都原生收位图 */
const texProg = { set: 0, ok: 0 };   // 贴图加载计数:boot 的进度气泡用
const loadBitmap = async url => {
  for (let i = 0; i < 2; i++) {
    try {
      texProg.set++;
      const c = new AbortController(); const timer = setTimeout(() => c.abort(), 8000);
      const r = await fetch(url, { signal: c.signal }).finally(() => clearTimeout(timer));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      if (!blob.size) throw new Error('空响应');
      const bmp = await createImageBitmap(blob);
      texProg.ok++;
      return bmp;
    } catch (e) { if (i === 1) throw e; }
  }
};
const petLoadImage = async u => {
  const url = String(u);                                 // figure.js 传入的是 URL 对象,先转字符串
  try { return await loadBitmap(url); } catch { /* 404/网络:走回退 */ }
  /* schemes/<id>/tex|x/xx.png → 原版(deepseek)同路径(配色缺图时的兜底) */
  const m = url.match(/\/schemes\/[^/]+\/((?:tex|feat)\/.+)$/);
  try { if (m) return await loadBitmap(new URL('vendor/whale/' + m[1], PET_BASE).href); } catch {}
  try { return await loadBitmap(TRANSPARENT); } catch { /* 连透明位图都不行:退回旧 Image 路径保底 */ }
  return petImgLoadRetry(TRANSPARENT).then(decodeImg);
};
const DRESS_KEY = 'koda.pet.dress';
/* 按钮 hover 的点缀色跟随当前配色(官网同款:用的就是宠物的眼睛色) */
const applyAccent = f => { try {
  if (!f) return;
  const ac = (f.colors && f.colors.z) || ((f.schemes || []).find(s => (f.scheme || '').startsWith(s.id)) || {}).accent || '#4d6bfe';
  document.documentElement.style.setProperty('--pet-accent', ac); } catch {} };
const PET_BASE = new URL('./', import.meta.url);   // 本模块目录:衣柜预览图在项目子页也能正确寻址
const savedDress = (() => { try { return localStorage.getItem(DRESS_KEY) || 'deepseek'; } catch { return 'deepseek'; } })();

const voice = createVoice({ base: PET_BASE });   // 说话声:动物森友会式音节库(官方 speech 移植)
/* 音库预热必须在 boot 可调之前就绪:boot 有「续访路径」在模块求值期就执行,声明放后面会踩 TDZ(宠物全灭)。
   预热也不能在模块期主动跑:个别浏览器不允许那时建 AudioContext,会炸掉整个模块——只由手势/boot 触发 */
const warmVoice = () => { try { voice.warm(); } catch { /* 个别浏览器不让建音频上下文,手势后再试 */ } };
addEventListener('pointerdown', warmVoice, { capture: true });
addEventListener('keydown', warmVoice, { capture: true });

async function boot() {
  if (!stage) return;
  warmVoice();   // 音库/拼音表提前拉好,别等第一句台词才下载
  const die = () => { stage.remove(); stage = null; };
  /* 慢网反馈:贴图 1.5s 还没到齐,就挂一个进度气泡——页面不再像坏了;
     快网加载 <1.5s,这个气泡根本不会出现。注意 boot 体里 356 行才有 bubbleEl,
     这里必须用自带元素,提前碰 bubbleEl 会 TDZ(boot 的 catch 会把整个舞台拆掉) */
  const bootT0 = performance.now();
  const progEl = document.createElement('div');
  progEl.className = 'pet-bubble pop';
  progEl.style.left = `${Math.max(8, Math.round(innerWidth / 2 - 64))}px`;
  progEl.style.top = `${Math.max(60, Math.round(innerHeight - 150))}px`;
  progEl.style.setProperty('--tail', '24px');
  const progTimer = setInterval(() => {
    if (performance.now() - bootT0 < 1500) return;
    progEl.textContent = `潜水赶来中… ${texProg.ok}/${Math.max(texProg.set, 1)}`;
    if (!progEl.isConnected) stage.appendChild(progEl);
  }, 350);
  let ctl;
  try {
    const figure = await createWhaleFigure(undefined, { scheme: savedDress, loadImage: petLoadImage });
    clearInterval(progTimer);
    progEl.remove();
    ctl = createPet(
      { petG: stage.querySelector('.pet'), shadowEl: stage.querySelector('.shadow'), fxG: stage.querySelector('.fx') },
      {
        figure,
        sfx: { play() {} },                 // 作品集里保持安静
        roam: 'free',                        // 自由闲逛
        startX: prev ? prev.xr * bounds().W : undefined,
        bounds,
        onEvent: onPetEvent,                 // 行为反应台词(见下)
      },
    );
  } catch (e) { clearInterval(progTimer); progEl.remove(); window.__bootErr = (e && e.message) || String(e); die(); return; }   // 贴图拉不下来之类:整个不出现,页面照常
  if (prev && (prev.facing === 1 || prev.facing === -1)) ctl.pet.facing = prev.facing;
  if (!prev) {
    // 首访登场:从屏幕右侧外跑进来(不是从天上掉下来),跑到台中再交给迎宾
    const b0 = bounds();
    ctl.pet.x = b0.W + 150;
    ctl.pet.facing = -1;
    ctl.holdRoam(6);
    ctl.walkTo(Math.round(b0.W * .62), true, 'enter-run');
  }
  requestAnimationFrame(() => stage.classList.add('on'));   // 首帧画完再淡入,不闪

  /* ---------- 指针:client 坐标即舞台坐标(舞台与视口重合),全部交给引擎 ----------
     命中宠物才接手:preventDefault 压掉浏览器的默认拖选,再加 pet-grab 类双保险;
     不命中时引擎自己忽略,我们也不 preventDefault,页面的点击/悬停零影响 */
  const pt = e => ({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  let cursorSet = false, holding = false, swallowClick = false, lastPt = { x: 0, y: 0, t: 0 };
  addEventListener('pointerdown', e => {
    swallowClick = false;                                  // 新的按下先清掉上一次的吞click状态
    if (e.target.closest && e.target.closest('.pet-ask')) return;   // 问答按钮的点击归按钮自己
    /* 悬停按钮与设置面板就贴在她身侧,按下点常落进她的命中范围——
       不排除的话按下会被当成摸她,click 被吞掉,按钮就"按了没反应" */
    if (e.target.closest && (e.target.closest('.pt-btn') || e.target.closest('.pet-settings') || e.target.closest('.pet-type'))) return;
    if (typeEl && !typeEl.hidden) closeType();   // 打字气泡:点外即收(官网打字框同款)
    const hit = !!ctl.pointerDown(pt(e));
    /* 衣柜开着时:点她身上归双击逻辑(舞台 pointer-events:none,target 是身下元素,
       不能用 target 判断点没点她,得靠命中测试);点衣柜归衣柜;点其余地方收起 */
    if (!hit && wardrobe && !wardrobe.hidden && !(e.target.closest && e.target.closest('.pet-wardrobe'))) closeWardrobe();
    if (!hit && wheelEl && !(e.target.closest && (e.target.closest('.pet-wheel') || e.target.closest('.pt-btn[data-act="dress"]')))) closeWheel();
    if (!hit && settingsEl && !settingsEl.hidden && !(e.target.closest && e.target.closest('.pet-settings'))) closeSettings();
    if (!hit) return;
    holding = true;
    tapMark = { t: e.timeStamp, x: e.clientX, y: e.clientY };   // 戳事件:快速轻点会触发模型回应
    if (e.pointerType !== 'mouse') toolsUntil = performance.now() + 4000;   // 触屏:点她一下亮出按钮组
    swallowClick = true;                                   // 这次按下产生的 click 归她,不吃页面
    e.preventDefault();                                    // 命中她:压掉原生文字拖选
    document.documentElement.classList.add('pet-grab');    // 双保险:拖拽期间整页禁选
  }, true);
  // 她站在链接/卡片前面时点她:click 会落在身下的元素上,这里整口吞掉,不触发跳转
  addEventListener('click', e => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  addEventListener('pointermove', e => {
    lastPt = pt(e);
    const cur = ctl.pointerMove(lastPt);
    if (cur) { document.body.style.cursor = cur; cursorSet = true; toolsUntil = performance.now() + 800; }
    else if (cursorSet) { document.body.style.cursor = ''; cursorSet = false; }
    /* 指针移进按钮区:当场就亮出按钮组,不等下一帧——否则同帧的点击会穿过
       还没拿到 pointer-events:auto 的按钮,变成"按了没反应" */
    if (toolsEl && !toolsOn && !holding && !panelOpen() && !(ctl.busy && ctl.busy())) {
      const tr = toolsEl.getBoundingClientRect();
      const near = lastPt.x >= tr.x - 24 && lastPt.x <= tr.right + 24 && lastPt.y >= tr.y - 24 && lastPt.y <= tr.bottom + 24;
      if (near && !(bubbleEl.classList.contains('ask') && !bubbleEl.hidden)) {
        toolsOn = true; showTools(true); placeTools();
      }
    }
  }, true);
  const releaseAt = p => {
    if (tapMark && p.t - tapMark.t < 400 && Math.hypot(p.x - tapMark.x, p.y - tapMark.y) < 14) maybeTouchSay();   // 官网 poke:轻点唤醒模型
    tapMark = null;
    holding = false;
    document.documentElement.classList.remove('pet-grab');
    ctl.pointerUp(p);
    if (cursorSet) { document.body.style.cursor = ''; cursorSet = false; }
  };
  /* 手机:按住她期间拦截触摸滚动——否则浏览器判定为滚屏手势,立刻发 pointercancel
     拖拽被取消,永远攒不出抛掷速度(电脑鼠标无此机制)。松手后恢复滚动 */
  document.addEventListener('touchmove', e => { if (holding) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (holding) e.preventDefault(); });   // 长按不弹系统菜单
  addEventListener('pointerup', e => (holding ? releaseAt(pt(e)) : ctl.pointerUp(pt(e))), true);
  addEventListener('pointercancel', e => (holding ? releaseAt(pt(e)) : ctl.pointerUp(pt(e))), true);
  // 拖着她把光标移出窗口:视作松手,避免卡在拖拽态
  document.documentElement.addEventListener('pointerleave', () => {
    ctl.pointerLeave();
    if (holding) releaseAt(lastPt);
  });

  /* ---------- 对白:跟着页面内容说话 ----------
     气泡挂在舞台上跟着她的头顶走;打字机逐字浮现,每吐一个字配一次口型。
     台词分四路:登场时段问候、滚动到页面区块的看菜下饭、摸/抓/扔的行为反应、
     长时间安静的闲聊。全区共用一个冷却,一个区块一轮只说一次,绝不刷屏。 */
  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'pet-bubble';
  bubbleEl.hidden = true;
  stage.appendChild(bubbleEl);

  function placeBubble() {
    if (bubbleEl.hidden) return;
    const a = ctl.anchor();
    const w = bubbleEl.offsetWidth, h = bubbleEl.offsetHeight;
    const left = Math.round(Math.max(10, Math.min(a.x - w * .35, pageW() - w - 10)));
    bubbleEl.style.left = `${left}px`;
    bubbleEl.style.top = `${Math.round(Math.max(76, a.y - h - 14))}px`;
    bubbleEl.style.setProperty('--tail', `${Math.round(Math.max(18, Math.min(a.x - left, w - 18)))}px`);
  }

  let sayToken = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function say(text, opts = {}) {
    const tok = ++sayToken;                  // 新台词随时可以顶掉旧的
    bubbleEl.hidden = false;
    bubbleEl.classList.remove('out', 'ask', 'pop');
    void bubbleEl.offsetWidth;               // 重排:让 pop 弹出动画每次都重放(官网每句新建气泡)
    bubbleEl.classList.add('pop');
    bubbleEl.textContent = '';
    await sleep(60);                         // 等一帧,让气泡先按空文本量好尺寸弹出来
    voice.begin(text);                       // 说话声:按文本请求音节(动物森友会式)
    let vi = 0;
    const anchors = opts.anchors || [];
    let af = 0;
    for (const ch of text) {
      if (tok !== sayToken) { voice.stop(); return; }   // 被新台词顶掉:气泡已归新主人,不要动它(更不能藏掉问句)
      bubbleEl.textContent += ch;
      ctl.talk();                            // 口型跟着字走
      voice.reveal(vi++);                    // 说话声:揭示到这个字,音节按官网时钟念出
      while (af < anchors.length && anchors[af].at <= vi) queueActs(anchors[af++].actions);   // 官网锚点:打到这个字就做
      placeBubble();
      await sleep(STEP_MS * textSteps(ch));  // 官网打字节奏:标点停顿、字母加速(与声音的两只时钟一致)
    }
    voice.stop();
    // 收尾停留分段检查令牌:切屏取消延迟 ≤100ms(官网所有等待点即时取消的同款语义)
    const holdMs = opts.hold ?? Math.min(5200, 1500 + text.length * 90);
    const holdT0 = performance.now();
    while (performance.now() - holdT0 < holdMs) {
      if (tok !== sayToken) return;
      await sleep(100);
    }
    if (tok !== sayToken) return;
    bubbleEl.classList.add('out');
    bubbleEl.classList.remove('pop');
    await sleep(240);
    if (tok !== sayToken) return;
    bubbleEl.hidden = true;
  }

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const saidOnce = new Set();                // 本轮会话只说一次的台词组
  let ambientFreeAt = 0;                     // 下一句"环境台词"最早可说的时刻
  /** 说一句环境台词(问候/区块解说)。睡着了先被内容叫醒;正忙则返回 false 交给调用方重试。 */
  async function ambient(key, pool) {
    if (saidOnce.has(key) || performance.now() < ambientFreeAt) return true;
    if (document.documentElement.hasAttribute('data-intro')) return false;   // 开屏打字期间保持纯净

    if (key === 'greet' && scrollY > innerHeight * 0.5) return true;         // 已滚离品牌屏,问候作废
    if (ctl.pet.mode === 'sleep') { ctl.act('stand'); await sleep(900); }
    if (ctl.busy() || bubbleEl.classList.contains('pop')) return false;
    saidOnce.add(key);
    say(pick(pool)).then(() => { ambientFreeAt = performance.now() + 6000; });   // 上一句播完隔 6 秒才接下一句
    return true;
  }

  /* 台词库:时段问候与站点 hero 的问候语同一套时段;区块台词按页面内容看菜下饭 */
  const h = new Date().getHours();
  const GREET = h < 5 ? ['夜深了还来看作品集,Koda 知道会超开心的~', '这么晚还在逛…悄悄说,注意休息哦']
    : h < 11 ? ['早上好!新的一天也要元气满满~', '早呀!趁脑子清醒,先看看 RAG 项目?']
    : h < 14 ? ['中午好~看完这页记得去吃饭哦', '中午好!我就在屏幕底下,慢慢逛~']
    : h < 18 ? ['下午好~这页的项目都是真实跑过数据的', '下午好!听说下面的演示可以真的玩']
    : ['晚上好,欢迎来到 Koda 的小天地~', '晚上好!悄悄说:RAG 那页有个在线演示~'];
  const SECTIONS = {
    'index.html': {
      projects: ['这两个项目都是 Koda 亲手写的,点进去有完整复盘~', 'RAG 系统跑过两轮实验,数据都摆在项目页里~'],
      skills: ['这张技能表,是一个个项目喂出来的~', 'Koda 常说:数据不会说谎,我也这么想~'],
      about: ['想了解他?git log 比自我介绍诚实多了~', '关于页里有他的学习轨迹,值得一读~'],
    },
    'rag.html': {
      overview: ['这套 RAG 真的跑过两轮实验,不是嘴炮 demo~', '检索、重排、流式输出,全链路都有数据~'],
      data: ['看实验数据的时候我也在旁边盯着,可认真了~', '数据不会说谎——这是 Koda 的口头禅~'],
      journey: ['演进路上踩的坑,他都老老实实写下来了~', '从 v1 到 v2,每一步都写了为什么~'],
    },
    'boom-arcade.html': {
      overview: ['复古街机!贪吃蛇和恐龙跳跃都能玩~', '这个项目是纯前端的快乐~'],
      safety: ['安全那一节是重点,Koda 特意写的~', '防作弊和内容安全都考虑到了,很细~'],
    },
  };
  const CHATTER = ['我就在这儿,想聊天就戳戳我~', '页面看完了吗?下面还有哦~', '摸摸我的头试试~'];
  /* 逛到页底时换用这组:「下面还有哦」在最后一屏穿帮 */
  const CHATTER_BOTTOM = ['我就在这儿,想聊天就戳戳我~', '都看到底啦~', '摸摸我的头试试~'];
  const chatterPool = () => (scrollY + innerHeight >= document.documentElement.scrollHeight - 120 ? CHATTER_BOTTOM : CHATTER);
  /* 逐项巡讲路线(官网:划到一屏,她走到每一项旁边点亮讲解,再走向下一项)。
     sel + i 定位第 i 个匹配元素;无路线的页面/区块退回单句解说。 */
  const TOURS = {
    'index.html': {
      'b-projects': [
        { sel: '#b-projects .project-card', i: 0, line: '项目一:智能知识库,两轮实验调出来的 RAG' },
        { sel: '#b-projects .project-card', i: 1, line: '项目二:复古街机平台,纯前端的快乐~' },
      ],
      'b-about': [{ sel: '.about-text', i: 0, line: '这里是他自己写的小传,比简历真诚~' }],
    },
  };
  const pageKey = location.pathname.split('/').pop() || 'index.html';

  let tourTok = 0;
  function revealAllWaits(except) {
    document.querySelectorAll('.pet-item-wait').forEach(e => {
      if (!except || !except.has(e)) { e.classList.remove('pet-item-wait'); e.classList.add('pet-item-in'); }
    });
  }
  async function runTour(id, items) {
    const tok = ++tourTok;
    document.querySelectorAll('.pet-spot').forEach(e => e.classList.remove('pet-spot'));
    revealAllWaits(new Set(items.map(it => (document.querySelectorAll(it.sel))[it.i || 0]).filter(Boolean)));  // 被顶掉的旧巡讲:它的待场项先放行
    if (ctl.pet.mode === 'sleep') ctl.act('stand');
    // 官网 leave 语义:滚离这一屏,巡讲立即作废闭嘴
    const secEl = document.getElementById(id);
    const guard = setInterval(() => {
      if (tok !== tourTok || !secEl) { clearInterval(guard); return; }
      const r = secEl.getBoundingClientRect();
      if (r.bottom < innerHeight * 0.35 || r.top > innerHeight * 0.65) {
        clearInterval(guard);
        if (tok === tourTok) {
          tourTok++;
          sayToken++;
          bubbleEl.hidden = true; bubbleEl.classList.remove('pop');
          document.querySelectorAll('.pet-spot').forEach(e => e.classList.remove('pet-spot'));
          revealAllWaits();
          ambientFreeAt = performance.now() + 6000;
        }
      }
    }, 400);
    for (const it of items) {
      if (tok !== tourTok) return;
      const el = (document.querySelectorAll(it.sel))[it.i || 0];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -40 || rect.top > innerHeight + 40) break;   // 用户已滚离这一屏,巡讲收工
      if (ctl.busy()) break;
      // 先让这一项浮出来(官网:内容一项项显示),她再走过去介绍
      el.classList.remove('pet-item-wait');
      el.classList.add('pet-item-in');
      await sleep(500);
      if (tok !== tourTok) break;
      const b = ctl.bounds;
      const anchor = Math.round(Math.max(b.minX + 60, Math.min(rect.x + rect.width / 2, b.maxX - 60)));
      ctl.holdRoam(8);
      ctl.walkTo(anchor, true, 'tour-' + id);
      el.classList.add('pet-spot');
      await arrive(anchor, 2600);
      await say(it.line, { hold: 2000 });
      el.classList.remove('pet-spot');
      if (tok !== tourTok) break;
      await sleep(200);
    }
    clearInterval(guard);
    if (tok === tourTok) revealAllWaits();   // 中途收工:没讲到的项也放出来,不留隐藏的卡片
    document.querySelectorAll('.pet-spot').forEach(e => e.classList.remove('pet-spot'));
    ambientFreeAt = performance.now() + 6000;
  }
  const REACT = {
    pet: ['嘿嘿,好舒服~', '再摸就要收摸头费了哦~', '呼噜呼噜…'],
    grab: ['呀!要带我去哪?', '放我下来啦(晃腿)'],
    throw: ['呜哇——!', '头、头好晕…'],
    drop: ['吓我一跳…', '呼,安全着陆'],
    wake: ['呼啊…我睡过头了吗?'],
  };
  const reactFreeAt = {};
  function onPetEvent(kind, detail) {
    if (kind !== 'touch') return;
    const pool = REACT[detail?.kind];
    if (!pool) return;
    const now = performance.now();
    if (now < (reactFreeAt[detail.kind] ?? 0)) return;
    if (detail.kind === 'pet' && Math.random() > .55) return;   // 摸头不必每次都说话
    reactFreeAt[detail.kind] = now + 16000;
    say(pick(pool), { hold: 1900 });
  }

  /* ---------- 主持人模式(包豪斯网页风格 html[data-theme="bauhaus"]) ----------
     官网风下她不只是背景吉祥物,而是页面主持:登场走位迎宾、滚到区块先
     走到内容旁边再开口讲、安静时偶尔挥手。切回默认风格则恢复纯闲逛。 */
  let hostMode = document.documentElement.dataset.theme === 'bauhaus';
  const arrive = async (x, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (Math.abs(ctl.pet.x - x) < 34) return true;
      if (ctl.pet.mode !== 'walk' && ctl.pet.mode !== 'run') return Math.abs(ctl.pet.x - x) < 90;
      await sleep(120);
    }
    return false;
  };
  /** 官网式的问句:打完字挂选项按钮,问题留到被回答(15 秒没答自收并嘟囔一句)。 */
  let askTimer = 0;
  async function ask(text, options, noWatch) {
    // 注意:问句不设引擎冻结门——官网的 offer 在切屏后照样创建并站住等你
    const tok = ++sayToken;                  // 与 say 共用令牌:新台词可顶掉问题
    bubbleEl.hidden = false;
    bubbleEl.classList.remove('out', 'pop');
    void bubbleEl.offsetWidth;
    bubbleEl.classList.add('pop', 'ask');    // 官网 .ask:更宽,给按钮留位
    bubbleEl.textContent = '';
    await sleep(60);
    for (const ch of text) {
      if (tok !== sayToken) return;          // 被顶掉就闭嘴;气泡归新主人管(问句站住,官网 offer 同款)
      bubbleEl.textContent += ch;
      ctl.talk();
      placeBubble();
      await sleep(28);                       // 与 say 同速(官网规格)
    }
    if (tok !== sayToken) return;
    const box = document.createElement('div');
    box.className = 'pet-ask';
    for (const o of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = o.label;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        clearTimeout(askTimer);
        bubbleEl.hidden = true;
        bubbleEl.classList.remove('pop');
        o.act();
      });
      box.appendChild(btn);
    }
    bubbleEl.appendChild(box);
    placeBubble();
    // 问题挂起期间:滚离品牌屏一半,问题作废闭嘴(官网 offer 的 the screen changes)。
    // noWatch:总结屏的收尾问句不做此守卫——第二屏 scrollY 必然过半,守卫会把它秒杀
    if (!noWatch) {
      const watch = setInterval(() => {
        if (bubbleEl.hidden || tok !== sayToken) { clearInterval(watch); return; }   // 已回答/收起/被顶掉
        if (scrollY > innerHeight * 0.5) {
          clearInterval(watch);
          clearTimeout(askTimer);
          sayToken++;
          bubbleEl.hidden = true;
          bubbleEl.classList.remove('pop');
        }
      }, 400);
    }
    // 官网 offer 语义:问题站住直到被回答或切屏(切屏由上面的 watch 收掉),不设超时
  }

  let entranceBusy = false;
  async function hostEntrance(intro) {
    if (entranceBusy || ctl.busy()) return;   // 迎宾进行中不重入(防止问句说两遍)
    entranceBusy = true;
    let aborted = false;
    // 官网 leave 语义:滚离品牌屏一半(或引擎冻结),登场与问句立即作废闭嘴
    const guard = setInterval(() => {
      if (scrollY > innerHeight * 0.5) {
        clearInterval(guard);
        aborted = true;
        sayToken++; clearTimeout(askTimer);
        bubbleEl.hidden = true; bubbleEl.classList.remove('pop');
        saidOnce.add('greet');
        entranceBusy = false;
      }
    }, 400);
    try {
    if (ctl.pet.mode === 'sleep') ctl.act('stand');
    const b = ctl.bounds;
    const target = Math.round(Math.max(b.minX + 60, Math.min(b.W * .64, b.maxX - 60)));
    ctl.holdRoam(9);
    ctl.walkTo(target, true, 'host-hello');   // 跑去迎宾,和登场同为跑
    await arrive(target, 4000);
    if (aborted) return;
    ctl.act('wave');
    await sleep(1300);
    if (aborted) return;
    if (intro) {
      // 开屏揭幕后的自我介绍,分两段说(官网的短句节奏),第二段带选项站住等回答
      await say('哈喽，我是 Koda 养的大肥鱼', { hold: 1500 });
      ask('你想要了解我的主人吗？', [
        { label: '好呀', act: async () => {
            // 官网节奏:先等回应说完,再划到第二屏
            await say('好呀，跟我来~', { hold: 1400 });
            const boards = document.getElementById('boards');
            if (boards) {
              scrollTo({ top: Math.round(boards.getBoundingClientRect().top + scrollY), behavior: 'smooth' });
            } else {
              const el = document.getElementById('about') || document.getElementById('overview');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          } },
      ]);
    }   /* 用户要求:切风格迎宾词已移除,静默就位 */
    clearInterval(guard);
    } finally { if (!aborted) entranceBusy = false; }
  }

  /* 登场问候 + 区块观察 + 久静闲聊(主持人模式下由迎宾/走位接管)。
     开屏在场时迎宾交给揭幕事件,台词用"大肥鱼"问句(与开屏呼应)。 */
  if (!hostMode) {
    setTimeout(() => ambient('greet', GREET), prev ? 1500 : 2600);
  } else {
    let pendingIntroGreet = introJustPlayed;   // 首访的迎宾已排定,intro-done 那次就不再重复
    document.addEventListener('koda:intro-done', () => {
      if (pendingIntroGreet) { pendingIntroGreet = false; return; }
      hostEntrance(true);
    });
    if (introJustPlayed) setTimeout(() => hostEntrance(true), 900);
    else if (!document.documentElement.hasAttribute('data-intro')) {
      setTimeout(hostEntrance, prev ? 900 : 2100);   // 没有开屏:照常迎宾
    }
  }
  const secPools = SECTIONS[pageKey] || SECTIONS['index.html'];
  for (const [id, pool] of Object.entries(secPools)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if ((TOURS[pageKey] || {})[id]) continue;   // 有巡讲路线的区块交给下面的巡讲系统
    let retried = false;
    new IntersectionObserver(async entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      if (hostMode) return;   // 主持模式:切屏台词由站位系统(entryLine)负责
      // 正忙着说话没接住:8 秒后补说一次,台词不丢
      if (!await ambient('sec:' + id, pool) && !retried) {
        retried = true;
        setTimeout(() => ambient('sec:' + id, pool), 8000);
      }
    }, { threshold: .35 }).observe(el);
  }
  /* 巡讲系统(官网节奏:整屏吸附到位 → 内容一项项浮出 → 她逐项介绍)。
     进屏 5% 时先把巡讲项收进待场,过半屏时开讲;每会话每屏一次。 */
  for (const [id, items] of Object.entries(TOURS[pageKey] || {})) {
    const el = document.getElementById(id);
    if (!el) continue;
    /* 卡片不再走「隐藏待场→巡讲逐项揭示」的编排:揭示触发依赖滚动位置/视口检查,
       手机的滚动恢复与地址栏高度变化会让它落空,返回主页时内容卡在隐藏态
       (悬浮栏返回走 bfcache 有恢复兜底,整页重载的返回没有——两条路都别埋雷)。
       巡讲保留走到旁边说话的部分;revealAllWaits + bfcache 兜底继续留着兜旧状态 */
    new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting)) return;
      if (!hostMode || saidOnce.has('sec:' + id)) return;
      // 350ms 防抖:快速穿屏路过的不开讲,真的停在这一屏才巡讲
      setTimeout(() => {
        if (saidOnce.has('sec:' + id) || !hostMode || document.documentElement.hasAttribute('data-intro')) return;
        const r = el.getBoundingClientRect();
        if (r.top > innerHeight * .55 || r.bottom < innerHeight * .45) return;
        saidOnce.add('sec:' + id);
        runTour(id, items);
      }, 350);
    }, { threshold: .45 }).observe(el);
  }
  /* bfcache 兜底:从详情页返回时若走了页面前进缓存(手机浏览器常态),冻结期的待场
     状态会原样恢复——恢复即全部揭示,卡片不能停在隐藏态 */
  addEventListener('pageshow', e => { if (e.persisted) revealAllWaits(); });
  /* ---------- 功能演示屏(官网 features 的 enter/leave 机制 + 断点续播) ----------
     进屏 enter:从上次停下的那一幕继续演(官网 next 计数器);演完只走回站位不重播。
     离屏 leave:令牌作废、气泡清空、面板说明区收起,总结只在播完后保留。
     Skip:正剧跳到下一幕;重播态跳回总结。数字按钮:播完后可单独重演某一幕。 */
  const featSection = document.getElementById('boards');
  let featTok = 0, featNext = 0, featCur = 0, featDone = false, featMode = null, featEnter = null;
  if (featSection) {
    const FEATS = [
      { title: 'Koda · 2027 届',
        desc: 'LLM 应用开发 / AI 产品。数据不说谎,git log 见真章。'
            + '<span class="cap-skill"><b>LLM 应用</b>RAG 检索 · LangChain · SSE 流式 · 向量数据库</span>'
            + '<span class="cap-skill"><b>语言框架</b>Python · FastAPI · Django · SQL</span>'
            + '<span class="cap-skill"><b>工具方法</b>Git 工作流 · AI 辅助开发 · 实验评估</span>',
        gesture: 'nod',
        lines: [
          { at: 0, text: '先介绍一下我的主人Koda，他的技能都写在这里啦' },
          { at: 600, text: '方向是 LLM 应用开发 / AI 产品，正在找实习~' },
          { at: 600, text: '座右铭：数据不说谎，git log 见真章！' },
        ] },
      { title: '智能知识库问答系统', desc: '两轮实验调参的 RAG:检索、重排、SSE 流式全链路。',
        gesture: null,
        lines: [
          { at: 0, text: '项目一：两轮实验调出来的 RAG，点卡看复盘' },
          { at: 600, text: '检索、重排、SSE 流式，全链路都有数据~' },
          { at: 600, text: '评估集还揪出过一个嵌入 bug，很细！' },
        ] },
      { title: '复古街机平台', desc: '贪吃蛇、恐龙跳跃……纯前端的快乐,安全和防作弊也想清楚了。',
        gesture: 'nod',
        lines: [
          { at: 0, text: '项目二：跑在树莓派上的街机乐园' },
          { at: 600, text: '四款小游戏，账号、排行榜全都有~' },
          { at: 600, text: '安全和防作弊也想清楚了，真的能玩！' },
        ] },
    ];
    const $f = sel => featSection.querySelector(sel);
    const stepLis = [...featSection.querySelectorAll('.feat-steps li')];
    function setCaption(i) {
      const c = $f('.feat-caption');
      c.classList.remove('on');
      void c.offsetWidth;
      if (i == null) return;
      $f('.feat-kicker').textContent = '0' + (i + 1) + ' / 0' + FEATS.length;
      $f('.feat-title').textContent = FEATS[i].title;
      $f('.feat-desc').innerHTML = FEATS[i].desc;
      c.classList.add('on');
    }
    const markStep = i => stepLis.forEach((li, j) => {
      if (j <= i) li.classList.add('on');
      li.classList.toggle('now', j === i);
      li.classList.toggle('past', j < i);
    });
    const panel = html => { $f('.feat-panel').innerHTML = html ? '<div class="feat-card ' + (html.cls || '') + '">' + html.h + '</div>' : ''; return $f('.feat-panel').firstChild; };
    function endDemo() {
      setCaption(null);
      $f('.feat-panel').innerHTML = '';
      $f('.feat-skip').classList.remove('on');
      stepLis.forEach(li => li.classList.remove('now'));
    }
    function showSummary(on) { $f('.feat-summary').classList.toggle('on', on); }
    async function demoProfile(tok) {
      const card = panel({ h: '<p class="feat-label">PROFILE</p>'
        + '<div class="f-row"><span>姓名</span><span class="f-field" data-v="Koda"></span></div>'
        + '<div class="f-row"><span>方向</span><span class="f-field" data-v="LLM 应用开发 / AI 产品"></span></div>'
        + '<div class="f-row"><span>座右铭</span><span class="f-field" data-v="数据不说谎,git log 见真章"></span></div>'
        + '<p class="f-done">● 2027 届 · 就位</p>' });
      for (const f of card.querySelectorAll('.f-field')) {
        if (tok !== featTok) return;
        f.classList.add('focus');
        for (const ch of f.dataset.v) {
          if (tok !== featTok) { f.classList.remove('focus'); return; }
          f.textContent += ch;
          await sleep(55);
        }
        f.classList.remove('focus');
        await sleep(160);
      }
      card.querySelector('.f-done').classList.add('on');
      await sleep(600);
    }
    async function demoRag(tok) {
      const card = panel({ cls: 'f-pcard', h: '<a class="pcard" href="projects/rag.html">'
        + '<span class="pcard-cover" style="background-image:url(assets/shot-chat.png)"></span>'
        + '<span class="pcard-body"><b class="pcard-title">智能知识库问答系统</b>'
        + '<span class="pcard-desc">两轮实验调参的 RAG:检索、重排、SSE 流式全链路。</span>'
        + '<span class="pcard-tags"><i>Python</i><i>LangChain</i><i>FastAPI</i><i>ChromaDB</i><i>SSE</i></span>'
        + '<span class="pcard-go">查看详情 →</span></span></a>' });
      card.classList.add('pet-item-in');
      await sleep(4500);
    }
    async function demoArcade(tok) {
      const card = panel({ cls: 'f-pcard', h: '<a class="pcard" href="projects/boom-arcade.html">'
        + '<span class="pcard-cover" style="background-image:url(assets/shot-arcade.png)"></span>'
        + '<span class="pcard-body"><b class="pcard-title">BoomArcade · 街机乐园</b>'
        + '<span class="pcard-desc">4 款小游戏的在线街机:账号、排行榜、管理后台,全栈部署在一台树莓派上。</span>'
        + '<span class="pcard-tags"><i>Java</i><i>Servlet 6</i><i>JSP</i><i>MySQL</i><i>AI 辅助</i></span>'
        + '<span class="pcard-go">查看详情 →</span></span></a>' });
      card.classList.add('pet-item-in');
      await sleep(4500);
    }
    function toSpot() {
      if (ctl.pet.mode === 'sleep') ctl.act('stand');
      const b = ctl.bounds;
      const spot = Math.round(Math.max(b.minX + 60, Math.min(b.W * .24, b.maxX - 60)));
      ctl.holdRoam(12);
      ctl.walkTo(spot, true, 'feat-host');
      ctl.pet.facing = 1;   // 官网 face(1):面向右侧的演示面板讲解
    }
    /** 官网:每幕一串台词跟着演示节拍走;逐句等说完再接下一句,全部说完本幕才算结束 */
    async function playLines(i, tok) {
      for (const L of FEATS[i].lines) {
        if (L.at) await sleep(L.at);           // 句间小停顿
        if (tok !== featTok) return;
        await say(L.text, { hold: 2000 });
        if (tok !== featTok) return;
      }
    }
    let featSpotX = null;                     // 当前讲解位:被丢走后她要自己走回来(官网同款)
    async function playFeature(i, tok) {
      showSummary(false);
      $f('.feat-skip').classList.add('on');     // 官网:演出期间右上角亮出「跳过」,收场时 endDemo 熄掉
      if (ctl.pet.mode === 'sleep') ctl.act('stand');
      const b = ctl.bounds;
      const spot = Math.round(Math.max(b.minX + 60, Math.min(b.W * .24, b.maxX - 60)));
      featSpotX = spot;
      ctl.holdRoam(12);
      ctl.walkTo(spot, true, 'feat-host');
      ctl.pet.facing = 1;                       // 官网 face(1):面向面板
      await arrive(spot, 3500);                 // 先走到位站稳
      if (tok !== featTok) return;
      markStep(i);                              // 到位后:号码点亮、说明区与面板才出现
      setCaption(i);
      if (FEATS[i].gesture) ctl.act(FEATS[i].gesture);
      // 台词与演示并行跑;两边都收尾(她把话说完)才进下一模块
      await Promise.all([[demoProfile, demoRag, demoArcade][i](tok), playLines(i, tok)]);
      if (tok !== featTok) return;              // 官网语义:被切屏打断,next 停在本幕,回来重演这一幕
    }
    async function wrapUp(tok, kind) {
      featDone = true; featNext = FEATS.length; featCur = FEATS.length;
      stepLis.forEach(li => { li.classList.add('on', 'past'); });
      $f('.feat-steps').classList.add('ready');
      endDemo(); showSummary(true);
      await sleep(800);
      if (tok !== featTok) return;
      ctl.act('wave');
      if (kind === 'tour') {
        // 官网:自然播完 → 先感叹,再用问句引导去下一屏
        say('都给你看完啦~', { hold: 1400 }).then(() => {
          if (tok !== featTok) return;
          ask('要不要去看看完整的项目复盘？', [
            { label: '好呀', act: async () => {
                await say('这边请~', { hold: 1100 });
                const el = document.getElementById('b-projects');   // 包豪斯风的项目区(b- 前缀;#projects 是第一风格的隐藏区块)
                if (el) scrollTo({ top: Math.round(el.getBoundingClientRect().top + scrollY), behavior: 'smooth' });
              } },
          ], true);
        });
      } else {
        // 官网:跳过收场/单幕重播完 → 教用户用数字按钮重播
        say('还想再看哪个？点上面的数字就好。', { hold: 3400 });
      }
      ambientFreeAt = performance.now() + 6000;
    }
    async function tour(from, tok) {
      featMode = 'tour';
      for (let i = from; i < FEATS.length; i++) {
        if (tok !== featTok) return;
        featNext = i; featCur = i;
        await playFeature(i, tok);
        if (tok !== featTok) return;              // 官网:被切屏打断不推进 next,回来重演本幕
        featNext = i + 1;
        await sleep(900);
      }
      if (tok !== featTok) return;
      featMode = null;
      await wrapUp(tok, 'tour');
    }
    async function replay(i, tok) {
      featMode = 'replay';
      featCur = i;
      showSummary(false); endDemo();
      await playFeature(i, tok);
      if (tok !== featTok) return;
      featNext = i + 1;
      featMode = null;
      await wrapUp(tok, 'replay');
    }
    const start = run => { const tk = ++featTok; run(tk).catch(() => {}); };
    const shutUp = () => { sayToken++; clearTimeout(askTimer); bubbleEl.hidden = true; bubbleEl.classList.remove('pop'); };
    $f('.feat-skip').addEventListener('click', () => {
      if (!featMode) return;
      featTok++; shutUp();
      const next = featCur + 1;               // 官网语义:跳过 = 掐断本幕、直接开下一幕(本幕播放期间 featNext 仍停在当前幕,不能用它定位)
      endDemo();
      if (featMode === 'tour' && next < FEATS.length) start(tk => tour(next, tk));
      else start(tk => wrapUp(tk, 'skip'));
    });
    stepLis.forEach((li, i) => li.querySelector('button').addEventListener('click', () => {
      if (!featDone) return;   // 官网:演完(.ready)才可点。live 标志靠进屏观察器补上,快速滚动/掉帧时会滞后,不做门槛
      featTok++; shutUp();
      start(tk => replay(i, tk));
    }));
    var isMobile = function () { return matchMedia('(max-width: 600px)').matches; };
    featEnter = () => {
      if (featSection.classList.contains('live')) return;
      if (!hostMode || document.documentElement.hasAttribute('data-intro')) return;
      featSection.classList.add('live');
      if (featDone) { toSpot(); if (isMobile()) showSummary(true); return; }   // 手机:回到本屏恢复总结
      start(tk => tour(featNext, tk));
    };
    const featLeave = () => {
      if (!featSection.classList.contains('live')) return;
      featSection.classList.remove('live');
      featTok++; shutUp();
      $f('.feat-skip').classList.remove('on');   // 只熄跳过、清气泡
      // 官网 leave 语义:说明区/演示卡/步骤原样冻结在被打断的一幕,回来重演时再重绘
      featMode = null;
      if (featDone) endDemo();   // 官网不变量:总结视图与讲解视图互斥——已演完时先收掉冻结的说明区/演示卡,再铺总结
      // 手机:总结是 fixed 贴顶的,离屏必须真隐藏(桌面 absolute 随区块滚走,演完保留无妨)
      showSummary(isMobile() ? false : featDone);
    };
    new IntersectionObserver(es => {
      // 快速切屏时"离开+进入"会挤进同一批回调,逐条处理两段都要生效,被打断的模块才会从头重演
      for (const e of es) (e.isIntersecting ? featEnter : featLeave)();
    }, { threshold: .45 }).observe(featSection);
    // 讲解/总结期间持续续期漫游保持(官网:宠物站定讲解,不自由闲逛)。
    // 每幕只 holdRoam(12) 会在长台词中途过期,引擎自由漫游接管 → 她开始乱跑
    setInterval(() => {
      if (!(featMode || (featDone && featSection.classList.contains('live')))) return;
      ctl.holdRoam(4);                         // 讲解期间站定,不自由闲逛
      if (holding || featSpotX == null) return;
      const mode = ctl.pet.mode;
      if (mode === 'air' || mode === 'drag' || mode === 'dizzy' || mode === 'walk' || mode === 'run') return;   // 空中/被抱着/正在走:不打扰
      const b = ctl.bounds;
      const spot = Math.max(b.minX + 60, Math.min(featSpotX, b.maxX - 60));
      if (Math.abs(ctl.pet.x - spot) > 70) ctl.walkTo(Math.round(spot), true, 'feat-back');   // 被丢到别处:自己走回讲解位(官网同款)
    }, 1000);
  }

  /* ---------- 每屏站位(官网:切屏后她走到该屏的 spot 再开讲) ----------
     滚动时按"视口中线落在哪个 section"判定当前屏(官网 sectionInView 同款),
     切屏后走到该屏的站位并面向内容;演出/迎宾拥有她时不抢,演完补位。 */
  const SCREEN_SPOTS = { home: 0.24, brand: 0.62, boards: 0.24, projects: 0.24, skills: 0.24, github: 0.24, about: 0.24, 'b-projects': 0.24, 'b-about': 0.24 };
  const SECTION_ORDER = ['home', 'brand', 'boards', 'projects', 'skills', 'github', 'about', 'b-projects', 'b-about'];
  let currentSection = null, spotTick = false;
  function walkToScreenSpot(id) {
    if (!hostMode || document.documentElement.hasAttribute('data-intro')) return;
    if (featMode || entranceBusy) return;                 // 演出/迎宾拥有她
    if (ctl.busy() || ctl.pet.mode === 'sleep') return;
    const frac = SCREEN_SPOTS[id];
    if (frac == null) return;
    const b = ctl.bounds;
    const x = Math.round(Math.max(b.minX + 60, Math.min(b.W * frac, b.maxX - 60)));
    if (Math.abs(ctl.pet.x - x) < 8) { ctl.pet.facing = 1; return; }   // 官网:差距 ≤4 不走
    ctl.holdRoam(10);
    ctl.walkTo(x, true, 'spot-' + id);
    ctl.pet.facing = 1;                                    // 官网 face(1):面向内容
  }
  /* 切屏应景台词(官网 download 屏的 sayFor(pick(...), 4200) 玩法):
     每次切屏随机抽一句、限时自动收;演出/迎宾说话时不抢。 */
  const ENTRY_LINES = {
    home: ['回来啦~', '又见面啦~', '这一屏看完,下面的更有料~'],
    brand: ['回来啦~', '又见面啦~', '这一屏看完,下面的更有料~'],
    projects: ['两张卡都能点进复盘,数据都在里面~', '左边 RAG,右边街机,都能玩真的~'],
    'b-projects': ['两张卡都能点进复盘,数据都在里面~', '左边 RAG,右边街机,都能玩真的~'],
    about: ['看完这页,你就认识他啦~', '你能让我的主人给我挣大白饭吗？'],
    'b-about': ['看完这页,你就认识他啦~'],
  };
  function entryLine(id) {
    if (featMode || entranceBusy) return;                     // 演出/迎宾说话时不抢
    if (document.documentElement.hasAttribute('data-intro')) return;
    const pool = ENTRY_LINES[id];
    if (!pool) return;
    ambientFreeAt = performance.now() + 6000;                 // 说话后给闲聊降降温
    say(pick(pool), { hold: 2800 });                          // 官网 sayFor:每次进入都说,限时自动收
  }
  function onSpotScroll() {
    const mid = innerHeight / 2;
    const id = SECTION_ORDER.find(sid => {
      const el = document.getElementById(sid);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top <= mid && r.bottom > mid;
    });
    if (id && id !== currentSection) { currentSection = id; walkToScreenSpot(id); entryLine(id); }
  }
  addEventListener('scroll', () => {
    if (spotTick) return;
    spotTick = true;
    // setTimeout 而非 rAF:窗口被遮挡时 rAF 停摆,站位/切屏台词不能跟着冻住
    setTimeout(() => { spotTick = false; onSpotScroll(); }, 200);
  }, { passive: true });
  addEventListener('resize', () => requestAnimationFrame(onSpotScroll));
  document.addEventListener('koda:style', () => requestAnimationFrame(onSpotScroll));
  requestAnimationFrame(onSpotScroll);

  setInterval(() => {
    if (performance.now() < ambientFreeAt || document.documentElement.hasAttribute('data-intro')
        || ctl.busy() || ctl.pet.mode === 'sleep'
        || bubbleEl.classList.contains('pop') || Math.random() < .5) return;
    ambientFreeAt = performance.now() + 45000;
    if (hostMode && Math.random() < .4) ctl.act('wave');   // 主持模式:偶尔挥手代替闲聊
    else say(pick(chatterPool()), { hold: 2600 });
  }, 20000);

  /* 开屏"字活过来"的时刻(官网的 morph 节拍):已登场的她原地蹦一下呼应 */
  document.addEventListener('koda:intro-alive', () => {
    if (hostMode && !ctl.busy() && ctl.pet.mode !== 'sleep' && ctl.pet.mode !== 'air') ctl.act('hop');
  });

  /* 风格切换事件:进官网风时 site.js 已排开屏,揭幕后由 intro-done 接管问句;
     回默认 → 打个招呼继续闲逛 */
  document.addEventListener('koda:style', e => {
    const coo = e.detail && e.detail.theme === 'bauhaus';
    if (coo === hostMode) return;
    hostMode = coo;
    // 切走时清掉巡讲状态,不留隐藏的卡片
    document.querySelectorAll('.pet-item-wait, .pet-item-in, .pet-spot')
      .forEach(el => el.classList.remove('pet-item-wait', 'pet-item-in', 'pet-spot'));
    tourTok++;   // 正在进行的巡讲作废
    featTok++;   // 功能演示也作废
    if (coo) {
      if (!document.documentElement.hasAttribute('data-intro')) hostEntrance();
    } else say('这个风格怎么样~', { hold: 2000 });
  });

  /* ---------- 帧循环与窗口变化 ----------
     lastFrameAt 是渲染心跳:窗口被遮挡时 Chromium 停掉 rAF,引擎冻结,
     此时台词/演出全部静默(engineAlive=false)——没人看得见她就不说话。 */
  let last = performance.now();
  let lastFrameAt = 0;
  /* 遮挡检测:rAF 停摆超过 1.5 秒 = 窗口被遮挡(	document.hidden 仍是 false)。
     只有真正被遮挡才静默;可见时的瞬时卡顿不再吞台词(之前"模块一没有介绍"的根因)。 */
  let occluded = true;
  const engineAlive = () => !occluded;
  setInterval(() => {
    const dead = performance.now() - lastFrameAt > 1500;
    if (dead !== occluded) occluded = dead;   // 只切状态:被遮挡时不再开新口,正在说的话让它说完(官网同款)
  }, 800);
  /* 衣柜/设置/打字框任一开着,按钮组就折起——不然叠在面板上(官网同款规则) */
  const panelOpen = () => (wardrobe && !wardrobe.hidden) || (settingsEl && !settingsEl.hidden) || (typeEl && !typeEl.hidden);
  const frame = t => {
    const dt = Math.min(.05, (t - last) / 1000 || 0);
    last = t;
    lastFrameAt = t;
    ctl.step(dt);
    ctl.render();
    stepActs(t);                           // 官网 stepActs:模型动作按词表秒数逐个上台
    placeBubble();
    placeWardrobe();
    if (wheelEl) placeWheel();             // 轮盘跟着她的头顶走
    /* 悬停按钮组:官网 stepTools 同款逐帧决策——光标在她身上(hitPet)/按钮上时亮出,
       离开 0.8s 后折起(TOOLS_LINGER);被拎起/甩出/蹲下(busy)与问答气泡挂着时不出现;
       指针在按钮上时冻结位置(官网:移动的是身体不是控件),离开后滑回身侧 */
    if (toolsEl) {
      const tr = toolsEl.getBoundingClientRect();
      const frozen = overTools || !!(lastPt && lastPt.x >= tr.x - 24 && lastPt.x <= tr.right + 24 && lastPt.y >= tr.y - 24 && lastPt.y <= tr.bottom + 24);
      const near = frozen || !!(lastPt && ctl.hitPet && ctl.hitPet(lastPt));
      if (near) toolsUntil = performance.now() + 800;
      const confirming = bubbleEl.classList.contains('ask') && !bubbleEl.hidden;
      const show = !holding && performance.now() < toolsUntil && !confirming && !panelOpen() && !(ctl.busy && ctl.busy());
      if (show !== toolsOn) { toolsOn = show; showTools(show); }
      if (show && !frozen) placeTools();
    }
    /* 用户台词:官网 placeLines 同款——最新在底部(她的气泡上方 8px,没气泡则头顶上方 46px),
       旧的往上叠、以她气泡/头部为轴水平居中,每条带 ox/oy 相对头部的偏移做缓动跟走(dt*12) */
    {
      const pills = saidPills();
      if (pills.length) {
        const a = ctl.anchor();
        const bubbleUp = !bubbleEl.hidden;
        const bRect = bubbleUp ? bubbleEl.getBoundingClientRect() : null;
        const cx = bRect ? bRect.left + bRect.width / 2 : a.x;
        let bottom = bRect ? bRect.top - 14 : a.y - 46;
        const k = Math.min(1, dt * 12);
        for (let i = pills.length - 1; i >= 0; i--) {
          const el = pills[i];
          el.classList.toggle('older', i !== pills.length - 1);
          if (!el.classList.contains('fading')) {
            const bw = el.offsetWidth, bh = el.offsetHeight;
            const left = Math.max(10, Math.min(cx - bw / 2, Math.max(10, pageW() - bw - 10)));
            const top = Math.max(8, bottom - bh);
            const ox0 = el.dataset.ox !== undefined ? parseFloat(el.dataset.ox) : null;
            const oy0 = el.dataset.oy !== undefined ? parseFloat(el.dataset.oy) : null;
            const ox = ox0 === null ? left - a.x : ox0 + (left - a.x - ox0) * k;
            const oy = oy0 === null ? top - a.y : oy0 + (top - a.y - oy0) * k;
            el.dataset.ox = ox; el.dataset.oy = oy;
            el.style.left = `${(a.x + ox).toFixed(1)}px`;
            el.style.top = `${(a.y + oy).toFixed(1)}px`;
          }
          bottom = top - 14;
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  addEventListener('resize', () => { fit(); ctl.resize(); });
  addEventListener('pagehide', () => saveState(ctl.pet.x / bounds().W, ctl.pet.facing));

  /* GPU 上下文被系统重置(省电/驱动复位/显存吃紧)时显存贴图全部丢失,
     个别驱动恢复瞬间的重传会留下垃圾 → 身体画成纯色块(脸每帧重画所以正常),刷新才能好。
     兜底:监听恢复事件(webglcontext* 不冒泡,捕获阶段在舞台上接),稍候把当前装扮整套重传,免刷新自愈 */
  stage.addEventListener('webglcontextrestored', () => {
    setTimeout(() => { try { ctl.figure.setScheme(ctl.figure.scheme); } catch { /* 失败就等下次换装自然重传 */ } }, 200);
  }, true);

  /* ---------- 官网换装系统 ----------
     双击她打开衣柜:8 套配色 × 3 套服装,切换即刻生效,选择存 localStorage。
     idle 时 figure.preload() 预热全部组合,之后的切换零等待 */
  let wardrobe = null;
  const W_SCHEMES = [   // 命名与官网一致(品牌名,model.json 的 brand)
    { id: 'deepseek', label: 'DeepSeek' }, { id: 'harness', label: 'DeepSeek Harness' },
    { id: 'chatgpt', label: 'ChatGPT' }, { id: 'claude', label: 'Claude' },
    { id: 'gemini', label: 'Gemini' }, { id: 'qwen', label: '千问' },
    { id: 'kimi', label: 'Kimi' }, { id: 'minimax', label: 'MiniMax' },
  ];
  const W_OUTFITS = [{ id: 'maid', label: '女仆装' }, { id: 'cape', label: '冬装' }, { id: 'crew', label: '麦香鱼' }];
  const placeWardrobe = () => {
    if (!wardrobe || wardrobe.hidden) return;
    const w = wardrobe.offsetWidth, W = pageW(), x = Math.round(ctl.pet.x);
    const left = x - 64 - w >= 8 ? x - 64 - w : x + 64;   // 先放左侧(右侧留给悬停按钮组),左边放不下再放右
    wardrobe.style.left = `${Math.max(8, Math.min(left, W - w - 8))}px`;
  };
  const closeWardrobe = () => { if (wardrobe) { wardrobe.hidden = true; wardrobe.classList.remove('open'); } };
  const openWardrobe = () => {
    if (!wardrobe) return;
    wardrobe.hidden = false; wardrobe.classList.add('open');
    const [s0, o0] = (ctl.figure.scheme || savedDress).split('-');
    wardrobe.querySelectorAll('[data-dress]').forEach(b => b.classList.toggle('on', b.dataset.outfit ? b.dataset.outfit === o0 : b.dataset.dress === s0));
    placeWardrobe();
    say(pick(['要给我换个新造型吗？', '今天想让我穿哪一套？', '这件好看吗？']), { hold: 2400 });
  };
  (function buildWardrobe() {
    wardrobe = document.createElement('div');
    wardrobe.className = 'pet-wardrobe'; wardrobe.hidden = true;
    const sw = W_SCHEMES.map(sc =>
      `<button type="button" class="pw-card" data-dress="${sc.id}" title="${sc.label}"><img src="${new URL('vendor/whale/thumbs/' + sc.id + '.png', PET_BASE).href}" alt="${sc.label}"><span>${sc.label}</span></button>`).join('');
    const of = W_OUTFITS.map(o => `<button type="button" data-dress="deepseek-${o.id}" data-outfit="${o.id}">${o.label}</button>`).join('');
    wardrobe.innerHTML = '<div class="pw-head">换装<button type="button" class="pw-close" aria-label="关闭">×</button></div>'
      + '<div class="pw-sec">配色</div><div class="pw-row pw-schemes">' + sw + '</div>'
      + '<div class="pw-sec">服装</div><div class="pw-row pw-outfits">' + of + '</div>';
    wardrobe.querySelector('.pw-close').addEventListener('click', closeWardrobe);
    wardrobe.querySelectorAll('[data-dress]').forEach(btn => btn.addEventListener('click', () => {
      const [curScheme, curOutfit] = (ctl.figure.scheme || savedDress).split('-');
      /* 配色按钮保留当前服装;服装按钮保留当前配色——两个维度互不重置 */
      const id = btn.dataset.outfit ? `${curScheme}-${btn.dataset.outfit}` : `${btn.dataset.dress}-${curOutfit}`;
      /* 官网同款:换配色 0.4s 交叉渐变(引擎 @mix 双贴图混合);换服装是换骨架,保持硬切 */
      ctl.figure.setScheme(id, btn.dataset.outfit ? undefined : { fade: .4 });
      applyAccent(ctl.figure);
      try { localStorage.setItem(DRESS_KEY, id); } catch {}
      const [curS, curO] = (ctl.figure.scheme || savedDress).split('-');
    wardrobe.querySelectorAll('[data-dress]').forEach(b => b.classList.toggle('on',
      b.dataset.outfit ? b.dataset.outfit === curO : b.dataset.dress === curS));
    }));
    stage.appendChild(wardrobe);
  })();
  /* 双击开衣柜已移除:与「轻点触发模型回应」冲突;换装统一走按钮组的「换装」 */
  const toggleWardrobe = () => { if (wardrobe.hidden) openWardrobe(); else closeWardrobe(); };

  /* ---------- 手机版换装轮盘(官网 look wheel 同款):≤600px 时「换装」不开衣柜面板,
     而是在她头顶亮出一排收藏形象——滚轮/手指拨动切换,停在某个形象 300ms 自动穿上,
     点一下立即穿。电脑版(>600px)保持衣柜面板不变 ---------- */
  /* 手机判定:窄屏或触屏(Via 等浏览器 1:1 像素比,手机 innerWidth 可能 >600,
     宽度判定会漏;触屏设备主指针必是 coarse) */
  const isMobileLike = () => innerWidth <= 600 || matchMedia('(pointer: coarse)').matches;
  let wheelEl = null, wheelAt = 0, wheelUntil = 0, wheelTimer = 0, wheelAcc = 0, wheelLastX = 0, wheelDrag = 0;
  const closeWheel = () => { clearTimeout(wheelTimer); wheelTimer = 0; if (wheelEl) { wheelEl.remove(); wheelEl = null; } };
  const drawWheel = () => {
    if (!wheelEl) return;
    const n = wheelEl.children.length;
    /* 无限循环:每个形象按「到当前选中位的环绕最短距离」落位——转过头自动从另一端接上,
       可以一直往一个方向滚 */
    [...wheelEl.children].forEach((b, i) => {
      let d = ((i - wheelAt) % n + n + Math.floor(n / 2)) % n - Math.floor(n / 2);
      const an = Math.abs(d);
      b.style.transform = `translate(-50%,-50%) translateX(${d * 54}px) scale(${Math.max(.6, 1 - .14 * an)})`;
      b.style.opacity = String([1, .55, .3, .12][an] ?? 0);
      b.style.zIndex = String(10 - an);
      b.style.pointerEvents = an > 3 ? 'none' : '';
      b.classList.toggle('on', d === 0);
    });
  };
  const placeWheel = () => {
    if (!wheelEl) return;
    const a = ctl.anchor(), w = wheelEl.offsetWidth, h = wheelEl.offsetHeight;
    wheelEl.style.left = `${Math.max(8, Math.min(Math.round(a.x - w / 2), pageW() - w - 8))}px`;
    wheelEl.style.top = `${Math.max(60, Math.round(a.y - h - 22))}px`;
  };
  const wearWheel = look => {
    clearTimeout(wheelTimer); wheelTimer = 0;
    const cur = ctl.figure.scheme || savedDress;
    if (look === cur) return;
    const [nextS, nextO] = look.split('-');
    const [curS, curO] = cur.split('-');
    /* 换配色保持官网的交叉渐变;换服装是换骨架,保持硬切 */
    ctl.figure.setScheme(look, nextO === curO ? { fade: .4 } : undefined);
    applyAccent(ctl.figure);
    try { localStorage.setItem(DRESS_KEY, look); } catch {}
    if (wardrobe) wardrobe.querySelectorAll('[data-dress]').forEach(b => b.classList.toggle('on',
      b.dataset.outfit ? b.dataset.outfit === nextO : b.dataset.dress === nextS));
  };
  const spinTo = i => {
    if (!wheelEl) return;
    /* 无限循环:wheelAt 是滚过的累计游标,不封顶;形象按环绕距离取模落位 */
    if (i !== wheelAt) { wheelAt = i; drawWheel(); }
    wheelUntil = performance.now() + 8000;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {   // 停 300ms 自动穿上(官网同款;点击路径走立即穿)
      const n = wheelEl ? wheelEl.children.length : 0;
      const b = wheelEl && wheelEl.children[((wheelAt % n) + n) % n];
      if (b) wearWheel(b.dataset.look);
    }, 300);
  };
  const openWheel = () => {
    closeWheel();
    const cur = ctl.figure.scheme || savedDress;
    wheelEl = document.createElement('div');
    wheelEl.className = 'pet-wheel';
    /* 一排收藏形象 = 全部配色×服装组合(服装分组在前:先看同一套衣服的 8 个配色,再换下一套) */
    const items = [];
    W_OUTFITS.forEach(o => W_SCHEMES.forEach(s => items.push({
      look: `${s.id}-${o.id}`, label: s.label,
      thumb: new URL(`vendor/whale/thumbs/${s.id}-${o.id}.png`, PET_BASE).href,
    })));
    wheelEl.style.width = `${(2 * 3 + 1) * 54}px`;   // 7 个形象的宽度(官网 WHEEL_STEP×(WHEEL_SIDE×2+1))
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pet-wheel-item'; b.dataset.look = it.look; b.title = `${it.label}·${W_OUTFITS.find(o => it.look.endsWith('-' + o.id)).label}`;
      b.innerHTML = `<img draggable="false" src="${it.thumb}" alt="${it.label}"><span>${it.label}</span>`;
      wheelEl.appendChild(b);
    });
    stage.appendChild(wheelEl);
    wheelAt = Math.max(0, items.findIndex(it => it.look === cur));
    drawWheel(); placeWheel();
    wheelUntil = performance.now() + 8000;
    say(pick(['头顶这排都是我,挑一个吧~', '拨一拨这排形象,看中哪个点哪个~']), { hold: 1600 });
    /* 触屏:按住轮盘横向拨动切换;轻点某个形象立即穿上(轮盘每次重建,监听随之挂载) */
    wheelEl.addEventListener('pointerdown', e => { wheelLastX = e.clientX; wheelDrag = 0; wheelEl.setPointerCapture(e.pointerId); });
    wheelEl.addEventListener('pointermove', e => {
      if (!wheelEl.hasPointerCapture || !wheelEl.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - wheelLastX; wheelLastX = e.clientX;
      wheelDrag += Math.abs(dx); wheelAcc += dx;
      while (Math.abs(wheelAcc) >= 54) { spinTo(wheelAt + (wheelAcc < 0 ? 1 : -1)); wheelAcc -= 54 * Math.sign(wheelAcc); }
    });
    wheelEl.addEventListener('pointerup', e => {
      if (wheelDrag >= 12) return;   // 是拨动不是点按
      /* setPointerCapture 会把 pointerup 重定向到轮盘本身:用坐标找手指下的形象 */
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const b = el && el.closest && el.closest('.pet-wheel-item');
      if (!b || !wheelEl.contains(b)) return;
      /* 点按:把累计游标按最短环绕距离拨到该形象(行不跳),再穿上 */
      const n = wheelEl.children.length;
      const cur = ((wheelAt % n) + n) % n;
      const c = [...wheelEl.children].indexOf(b);
      wheelAt += ((c - cur) % n + n + Math.floor(n / 2)) % n - Math.floor(n / 2);
      drawWheel();
      wearWheel(b.dataset.look);
    });
    wheelEl.addEventListener('pointercancel', () => { wheelAcc = 0; });
  };
  const toggleWheel = () => { if (wheelEl) closeWheel(); else openWheel(); };
  /* 滚轮切一格(官网 WHEEL_NOTCH 同款):只在轮盘或换装按钮上滚动时生效 */
  addEventListener('wheel', e => {
    if (!wheelEl || !(e.target.closest && e.target.closest('.pet-wheel, .pt-btn[data-act="dress"]'))) return;
    e.preventDefault();
    wheelAcc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(wheelAcc) < 40) return;
    spinTo(wheelAt + Math.sign(wheelAcc));
    wheelAcc = 0;
  }, { passive: false });
  addEventListener('keydown', e => { if (e.key === 'Escape') { closeWheel(); closeWardrobe(); closeSettings(); closeType(); } });

  /* ---------- 悬停按钮组(官网同款):鼠标停在她身上时出现在身侧,走动跟随 ----------
     换装(开衣柜) / 切换风格(站点双主题,走导航按钮的既有换肤路径) / 设置(LLM 提供商与 API Key)。
     指针离开 0.9s 收起;拖拽与衣柜开着时不出现;触屏点她一下显示 4s */
  let toolsEl = null, settingsEl = null, typeEl = null, saidWrap = null, overTools = false, toolsUntil = 0, toolsOn = false;
  let tapMark = null, touchCoolUntil = 0;   // 戳事件:轻点检测与模型回应冷却
  let openSettings = () => {}, openChat = () => {};
  function closeSettings() { if (settingsEl) { settingsEl.hidden = true; settingsEl.classList.remove('open'); } }
  function closeType() { if (typeEl) typeEl.hidden = true; }
  function fadeSaid(el) { if (!el || el.classList.contains('fading')) return; el.classList.remove('entering'); el.classList.add('fading'); setTimeout(() => el.remove(), 450); }
  const placeTools = () => {
    const a = ctl.anchor(), w = toolsEl.offsetWidth, h = toolsEl.offsetHeight, b = bounds();
    const top = Math.round(Math.max(80, Math.min((a.y + b.floorY) / 2 - h / 2, b.floorY - h - 10)));
    const x = Math.round(ctl.pet.x);
    const left = x + 58 + w <= b.W - 8 ? x + 58 : x - 58 - w;   // 先放右侧,放不下放左侧
    toolsEl.style.left = `${Math.max(8, Math.min(left, b.W - w - 8))}px`;
    toolsEl.style.top = `${top}px`;
  };
  /* 官网 popIn/popOut:entering 逐个弹入(0.6s 收尾),leaving 0.16s 折回,期间不接收点击 */
  const toolsAnim = { enter: 0, leave: 0 };
  const showTools = on => {
    if (on) {
      if (toolsEl.classList.contains('leaving')) { clearTimeout(toolsAnim.leave); toolsEl.classList.remove('leaving'); }
      if (toolsEl.classList.contains('on')) return;
      toolsEl.classList.add('on', 'entering');
      clearTimeout(toolsAnim.enter);
      toolsAnim.enter = setTimeout(() => toolsEl.classList.remove('entering'), 600);
    } else {
      if (!toolsEl.classList.contains('on') || toolsEl.classList.contains('leaving')) return;
      clearTimeout(toolsAnim.enter);
      toolsEl.classList.remove('entering');
      toolsEl.classList.add('leaving');
      toolsAnim.leave = setTimeout(() => { toolsEl.classList.remove('on', 'leaving'); }, 160);
    }
  };
  (function buildTools() {
    toolsEl = document.createElement('div');
    toolsEl.className = 'pet-tools';
    const I = {   // 线性图标:T恤=换装,悬浮岛同款脸谱=切换风格,滑杆=设置
      dress: '<svg viewBox="0 0 20 20"><path d="M6.6 2.6 10 4.7l3.4-2.1 4 3.4-2.4 2.2V17H5V8.2L2.6 6z"/></svg>',
      theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M12.2 21a3 3 0 0 0 0-6h-1.4"/></svg>',
      set: '<svg viewBox="0 0 20 20"><path d="M3 6h14M3 10h14M3 14h14"/><circle class="knob" cx="7" cy="6" r="2"/><circle class="knob" cx="13" cy="10" r="2"/><circle class="knob" cx="6" cy="14" r="2"/></svg>',
      dance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4.5h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6l-4.5 3.5v-3.5H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3z"/></svg>',
      like: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 20.3s-7.2-4.6-9.2-9.1a5.1 5.1 0 0 1 9.2-4.3 5.1 5.1 0 0 1 9.2 4.3c-2 4.5-9.2 9.1-9.2 9.1z"/></svg>',
    };
    toolsEl.innerHTML = '<button type="button" class="pt-btn" data-act="dress" aria-label="换装" title="换装">' + I.dress + '</button>'
      + '<button type="button" class="pt-btn" data-act="theme" aria-label="切换风格" title="切换风格">' + I.theme + '</button>'
      + '<button type="button" class="pt-btn" data-act="settings" aria-label="设置" title="设置">' + I.set + '</button>'
      + '<button type="button" class="pt-btn" data-act="dance" aria-label="跳个舞" title="跳个舞">' + I.dance + '</button>'
      + '<button type="button" class="pt-btn" data-act="chat" aria-label="聊聊天" title="聊聊天">' + I.chat + '</button>'
      + '<button type="button" class="pt-btn pt-like" data-act="like" aria-label="点个赞" title="点个赞"><span class="pt-like-badge">0</span>' + I.like + '</button>';
    /* 点赞徽章:先亮本机数,远端全站数到了再替换(常量在模块后段,延迟到求值完再碰) */
    setTimeout(() => {
      const lb = toolsEl.querySelector('.pt-like-badge');
      if (!lb) return;
      try { lb.textContent = likeFmt(parseInt(localStorage.getItem(LIKE_KEY), 10) || 0); } catch { /* 读不到就算了 */ }
      fillLikeBadge(lb);
    }, 0);
    toolsEl.addEventListener('pointerenter', () => { overTools = true; });
    toolsEl.addEventListener('pointerleave', () => { overTools = false; });
    toolsEl.addEventListener('click', e => {
      const btn = e.target.closest('.pt-btn');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'dress') { if (isMobileLike()) toggleWheel(); else toggleWardrobe(); }   // 触屏/窄屏:头顶轮盘;鼠标大屏:衣柜面板
      else if (act === 'theme') {
        const st = document.getElementById('styleToggle');
        if (st) st.click();   // 走站点自己的换肤路径:localStorage 记忆/开屏/广播事件全一致
        else {                // 兜底:没有换肤按钮的页面手动切
          const next = document.documentElement.dataset.theme === 'bauhaus';
          if (next) delete document.documentElement.dataset.theme;
          else document.documentElement.dataset.theme = 'bauhaus';
          try { localStorage.setItem('koda.style', next ? 'apple' : 'bauhaus'); } catch {}
        }
      } else if (act === 'settings') { if (settingsEl && !settingsEl.hidden) closeSettings(); else openSettings(); }
      else if (act === 'dance') {
        ctl.act('dance');
        say(pick(['看我跳一个~', '数据不说谎，舞步也不说谎~']), { hold: 2200 });
      }
      else if (act === 'chat') { if (typeEl && !typeEl.hidden) closeType(); else openChat(); }
      else if (act === 'like') likeOnce(btn);
    });
    [...toolsEl.children].forEach((b, i) => b.style.setProperty('--i', String(i)));   // 官网 stagger:逐个弹出
    /* 挂 body 不挂舞台:舞台带着 WebGL 画布,合成层里画 svg 偶发出碎块伪影;按钮组是瞬态 UI,不需要跨页接续 */
    document.body.appendChild(toolsEl);
  })();

  /* ---------- 设置:大语言模型提供商与 API Key(暂时只有这项;只存本机 localStorage) ---------- */
  const LLM_KEY = 'koda.pet.llm';
  const LLM_PROVIDERS = [
    { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-flash' },
    { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-6-luna'  },
    { id: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com', model: 'claude-haiku-5-5'  },
    { id: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com', model: 'gemini-3.5-flash-lite'  },
    { id: 'qwen', label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash'  },
    { id: 'kimi', label: 'Kimi', url: 'https://api.moonshot.cn/v1', model: 'kimi-k3'  },
    { id: 'minimax', label: 'MiniMax', url: 'https://api.minimax.chat/v1', model: 'MiniMax-M3'  },
    { id: 'zhipu', label: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', cors: false },
    { id: 'custom', label: '自定义', url: '' },
  ];
  (function buildSettings() {
    settingsEl = document.createElement('div');
    settingsEl.className = 'pet-settings';
    settingsEl.hidden = true;
    settingsEl.innerHTML = '<div class="ps-head">设置<button type="button" class="ps-close" aria-label="关闭">×</button></div>'
      + '<label class="ps-row"><span>提供商</span><select class="ps-provider">'
      + LLM_PROVIDERS.map(p => `<option value="${p.id}">${p.label}</option>`).join('')
      + '</select></label>'
      + '<label class="ps-row"><span>API Key</span><input class="ps-key" type="password" autocomplete="off" placeholder="sk-…" /></label>'
      + '<label class="ps-row"><span>接口地址</span><input class="ps-url" type="text" autocomplete="off" placeholder="留空用默认地址" /></label>'
      + '<label class="ps-row"><span>模型</span><input class="ps-model" type="text" autocomplete="off" placeholder="留空用默认模型" /></label>'
      + '<p class="ps-cors" hidden>⚠ 智谱的服务器不允许浏览器直连（跨域限制）：在「接口地址」填一个你的中转地址即可（如 Cloudflare Worker 反代），或改用 DeepSeek 等支持直连的提供商。</p>'
      + '<p class="ps-note">只保存在这台设备的浏览器里(localStorage),不会上传到任何服务器;之后接入对话功能时直接使用。</p>'
      + '<button type="button" class="ps-save">保存</button>';
    document.body.appendChild(settingsEl);
    const $ = s => settingsEl.querySelector(s);
    const syncUrlHint = () => {
      const p = LLM_PROVIDERS.find(x => x.id === $('.ps-provider').value);
      $('.ps-url').placeholder = p && p.url ? `默认 ${p.url}` : 'https://…';
      $('.ps-model').placeholder = p && p.model ? `默认 ${p.model}` : '模型名…';
      const note = $('.ps-cors');
      if (note) note.hidden = !(p && p.cors === false);
    };
    $('.ps-provider').addEventListener('change', syncUrlHint);
    $('.ps-close').addEventListener('click', closeSettings);
    $('.ps-save').addEventListener('click', () => {
      const p = LLM_PROVIDERS.find(x => x.id === $('.ps-provider').value) || LLM_PROVIDERS[0];
      try { localStorage.setItem(LLM_KEY, JSON.stringify({ provider: p.id, apiKey: $('.ps-key').value.trim(), baseUrl: $('.ps-url').value.trim(), model: $('.ps-model').value.trim() })); } catch {}
      const save = $('.ps-save');
      save.textContent = '已保存 ✓'; save.classList.add('done');
      setTimeout(() => { save.textContent = '保存'; save.classList.remove('done'); }, 1600);
      say(pick(['记住啦，谢谢投喂~', '好，钥匙收到啦~']), { hold: 1800 });
    });
    openSettings = () => {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(LLM_KEY) || '{}'); } catch {}
      $('.ps-provider').value = LLM_PROVIDERS.some(p => p.id === saved.provider) ? saved.provider : 'deepseek';
      $('.ps-key').value = saved.apiKey || '';
      $('.ps-url').value = saved.baseUrl || '';
      $('.ps-model').value = saved.model || '';
      syncUrlHint();
      settingsEl.hidden = false; settingsEl.classList.add('open');
      const r = settingsEl.getBoundingClientRect();
      settingsEl.style.left = `${Math.max(10, Math.round((pageW() - r.width) / 2))}px`;
      settingsEl.style.top = `${Math.max(70, Math.round((innerHeight - r.height) / 2))}px`;
    };
  })();

  /* ---------- 对话(官网式):点「说句话」在她头顶弹打字气泡;
     用户的话以虚线气泡挂在她的背侧,她的回复用自己的气泡逐字说出 ---------- */
  const CHAT_PERSONA = '你是 Koda 养的「大肥鱼」，在 Koda 个人网站上的一只鲸鱼娘形象的 AI 伙伴。Koda 是你的主人：2027 届毕业生，方向 LLM 应用开发 / AI 产品，正在找实习；代表作：RAG 智能知识库问答（检索重排 + SSE 流式）、BoomArcade 树莓派街机乐园。你的性格：活泼简洁、偶尔俏皮。规则：每次回复 1~3 句话、口语化、全程用中文；不用 markdown/列表/代码块；不知道就直说；被问 Koda 的信息按上面介绍。\n'
    + '回复里夹带动作标记,这是你在屏幕上的身体表演(像表情包),两种写法:\n'
    + '【词】或【词, 词】放在回复最开头:先做这些,再开始说话。\n'
    + '<词>夹在句子中间:说到那个字时当场做,不换气泡。\n'
    + '例:【开心】今天也辛苦啦!<眨眼>要不要歇一会儿?\n'
    + '词表(表情几秒后回到平常的脸;动作做一下就结束):\n'
    + '表情:开心、眨眼、喜欢、爱心眼、害羞、惊讶、生气、难过、伤心、犯困、思考、得意、嘟嘴、哼、担心、认真、慌张、害怕、期待、星星眼、大哭、疑惑\n'
    + '动作:点头、摇头、转圈、招手、鞠躬、发抖、扑腾、激动、跳舞、摇摆、小跳、跳起来、转身、张望、坐下、睡觉、晕\n'
    + '标记要贴合回复的情绪,比如:被夸→【害羞】哪、哪有啦…;被问难题→【认真】让我想想…;听到好消息→【期待, 小跳】真的吗!数据不说谎~。'
    + '你还能帮主人操作网页,页面指令也写在【】标记里(导航类放回复最后,执行后页面会切换):打开rag(去看RAG项目复盘)、打开街机(BoomArcade页)、回主页、去项目、去技能、去关于、去顶部、去底部、换风格。'
    + '比如用户说"帮我打开RAG界面"→【点头, 打开rag】这就带你去~;用户想看技能→【去技能】技能都在这屏~。用户戳了你一下时你会收到【touch】事件:用一两句话自然地回应这个互动即可。';
  const LLM_DEFAULT_URLS = Object.fromEntries(LLM_PROVIDERS.map(p => [p.id, p.url]));
  const LLM_DEFAULT_MODELS = Object.fromEntries(LLM_PROVIDERS.map(p => [p.id, p.model || '']));
  /* 跨页记忆:sessionStorage 按标签页存最近 16 条,翻页/刷新不断片(关标签才清) */
  const CHAT_KEY = 'koda.pet.chat';
  const loadChat = () => { try { const a = JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); return Array.isArray(a) ? a.slice(-16) : []; } catch { return []; } };
  const saveChat = () => { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory.slice(-16))); } catch {} };
  let chatHistory = loadChat();
  let chatBusy = false;   // 防重复提交:回车+连点发送会触发两次 submit,消息就出双份
  const saidPills = () => [...document.querySelectorAll('.pet-said')];
  const addSaid = text => {          // 官网 lines 同构:每条消息一个独立气泡,挂在 body,居中于她头顶向上堆叠
    const pill = document.createElement('div');
    pill.className = 'pet-bubble heard said pop pet-said'; pill.textContent = text;
    pill.addEventListener('click', () => fadeSaid(pill));   // 官网:点一下立即收起
    document.body.appendChild(pill);
    const arr = saidPills();
    arr.forEach((el, i) => el.classList.toggle('older', i !== arr.length - 1));   // 官网 .older:旧台词变淡
    while (arr.length > 3) fadeSaid(arr[0]);
    /* 官网:回复期间台词不淡出,回复气泡关掉 1s 后才淡;没被回答 8s 后淡 */
    const fadeWhenIdle = () => { if (chatBusy) { setTimeout(fadeWhenIdle, 800); return; } fadeSaid(pill); };
    setTimeout(fadeWhenIdle, 8000);
  };

  (function buildChatUi() {
    typeEl = document.createElement('div');
    typeEl.className = 'pet-type'; typeEl.hidden = true;
    typeEl.innerHTML = '<div class="pt-wait" hidden>大肥鱼正在吐泡泡，稍等一下下…</div>'
      + '<div class="pt-form"><input type="text" maxlength="300" placeholder="和她说说…" autocomplete="off" /><button type="button" class="pt-send">发送</button></div>';
    document.body.appendChild(typeEl);
    const input = typeEl.querySelector('input');
    typeEl.addEventListener('keydown', e => { if (e.key === 'Escape') { closeType(); e.stopPropagation(); } });
    input.addEventListener('keydown', e => e.stopPropagation());
    /* 不用 form:站点的全局 click 处理器会取消隐式提交;显式按钮 + Enter 直调 sendChat */
    const sendChat = async () => {
      if (chatBusy) return;                  // 上一条还没回完:吞掉重复提交(回车+连点会触发两次)
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      closeType();
      chatBusy = true;
      typeEl.querySelector('.pt-wait').hidden = false;
      try {
        addSaid(text);                       // 每条发送的消息都显示(官网同款),没配置也显示
        const cfg = (() => { try { return JSON.parse(localStorage.getItem(LLM_KEY) || 'null'); } catch { return null; } })();
        if (!cfg || !cfg.apiKey) {
          say('我还不知道去哪找大脑——先点设置，填好提供商和 API Key 呀~', { hold: 2600 });
          openSettings();
          return;
        }
        chatHistory.push({ role: 'user', content: text });
        saveChat();
        try { ctl.doWord('thinking'); } catch {}   // 等回复:思考脸(表情词必须走 ctl.do,ctl.act 只认动作)
        try {
          const beats = parseBeats((await llmCall(cfg, chatHistory)) || '……');
          const clean = (await playBeats(beats, 2200)) || '……';   // 逐段演出:动作排队、锚点随打字触发
          chatHistory.push({ role: 'assistant', content: clean });
          if (chatHistory.length > 16) chatHistory = chatHistory.slice(-16);
          saveChat();
          setTimeout(() => { saidPills().forEach(fadeSaid); }, 1000);   // 回答后 1s 淡出(官网)
          const performed = beats.some(b => b.actions.length || b.anchors.length);
          if (!performed) { try { ctl.doWord('happy'); } catch {} }   // 模型没给表情才兜底,别盖掉它选的
        } catch (err) {
          say('呜…大脑断线了（' + ((err && err.message) || '未知错误') + '）。检查一下设置里的地址和钥匙~', { hold: 2600 });
          setTimeout(() => { saidPills().forEach(fadeSaid); }, 1000);
          try { ctl.doWord('sad'); } catch {}
        }
      } finally { chatBusy = false; typeEl.querySelector('.pt-wait').hidden = true; }
    };
    typeEl.querySelector('.pt-send').addEventListener('click', sendChat);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } e.stopPropagation(); });
    if (chatHistory.length) {   // 跨页接力:新页面把她记住的最后一句挂回身旁,翻页不断片
      const lastUser = [...chatHistory].reverse().find(m => m.role === 'user');
      if (lastUser) addSaid(lastUser.content);
    }
    openChat = () => {
      typeEl.hidden = false;
      const a = ctl.anchor(), w = typeEl.offsetWidth;
      typeEl.style.left = `${Math.round(Math.max(10, Math.min(a.x - w * .4, pageW() - w - 10)))}px`;
      typeEl.style.top = `${Math.round(Math.max(70, a.y - typeEl.offsetHeight - 40))}px`;
      typeEl.querySelector('.pt-wait').hidden = !chatBusy;   // 上一条还在等回复:提示而不是沉默
      input.focus();
    };
  })();

  /* 官网 pet_say 同款标记协议(src/script.ts 移植):
     【词, 词】阻断——先做完这些再说后面的;<词> 内联——打字打到那个字时做(边说边变脸)。
     词表=官网鲸鱼 figure.json 全量 37 词(表情几秒后回平常的脸,动作按表排队);未收录标记剥除。 */
  const ACT_WORDS = { '开心': 'happy', '高兴': 'happy', '眨眼': 'wink', '喜欢': 'love', '爱心': 'love', '爱心眼': 'love',
    '害羞': 'shy', '惊讶': 'surprised', '吃惊': 'surprised', '生气': 'angry', '难过': 'sad', '伤心': 'sad',
    '犯困': 'sleepy', '困': 'sleepy', '思考': 'thinking', '想想': 'thinking', '得意': 'smug', '嘚瑟': 'smug',
    '嘟嘴': 'pout', '哼': 'pout', '担心': 'worried', '着急': 'worried', '认真': 'determined', '坚定': 'determined',
    '慌张': 'flustered', '窘': 'flustered', '害怕': 'scared', '吓到': 'scared', '期待': 'excited', '星星眼': 'excited',
    '大哭': 'cry', '哭': 'cry', '疑惑': 'confused', '问号': 'confused', '平静': 'neutral',
    '站起': 'stand', '站': 'stand', '跳': 'jump', '跳起来': 'jump', '小跳': 'hop', '蹦': 'hop',
    '张望': 'look', '看看': 'look', '转身': 'turn', '点头': 'nod', '摇头': 'shake', '转圈': 'spin',
    '坐下': 'sit', '坐': 'sit', '睡觉': 'sleep', '睡': 'sleep', '晕': 'dizzy', '转晕': 'dizzy',
    '走走': 'walk', '散步': 'walk', '跑': 'run', '跑起来': 'run', '招手': 'wave', '打招呼': 'wave',
    '鞠躬': 'bow', '发抖': 'shiver', '哆嗦': 'shiver', '扑腾': 'flap', '激动': 'flap', '跳舞': 'dance', '摇摆': 'dance',
    '打开rag': '@rag', '去rag': '@rag', 'rag页': '@rag', '打开街机': '@boom', '去街机': '@boom', '街机页': '@boom',
    '回主页': '@home', '回首页': '@home', '去项目': '@projects', '去技能': '@skills', '去关于': '@about',
    '去顶部': '@top', '去底部': '@bottom', '换风格': '@theme',
    'happy': 'happy', 'wink': 'wink', 'love': 'love', 'shy': 'shy', 'surprised': 'surprised', 'angry': 'angry',
    'sad': 'sad', 'sleepy': 'sleepy', 'thinking': 'thinking', 'excited': 'excited', 'determined': 'determined',
    'cry': 'cry', 'confused': 'confused', 'nod': 'nod', 'shake': 'shake', 'spin': 'spin', 'wave': 'wave',
    'bow': 'bow', 'dance': 'dance', 'jump': 'jump' };
  /* 官网 figure.json 的 seconds:动作队列按它逐个间隔(表情播完再接下一个) */
  const VOCAB_SECONDS = { neutral: .9, happy: .9, wink: .9, love: .9, shy: .9, surprised: .9, angry: .9, sad: .9,
    sleepy: .9, thinking: .9, smug: .9, pout: .9, worried: .9, determined: .9, flustered: .9, scared: .9,
    excited: .9, cry: .9, confused: .9, stand: 1.2, jump: 1.2, hop: .9, look: 2.7, turn: .4, nod: .8, shake: .8,
    spin: .8, sit: .8, sleep: .8, dizzy: 3.2, walk: 12, run: 12, wave: 1.7, bow: 1.7, shiver: 1.9, flap: 1.5, dance: 3.4 };

  /* 回复 → beats(官网 parseScript 同构):【】切段,<...> 挂成锚点(at=字序号,打字时触发) */
  const parseBeats = reply => {
    const s = String(reply || '');
    const idOf = inner => inner.split(/[,，、\s]+/).map(w => ACT_WORDS[w.trim()]).filter(Boolean);
    const beats = [];
    let cur = { actions: [], text: '', anchors: [] };
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '【') {
        const end = s.indexOf('】', i + 1);
        if (end < 0) { cur.text += s.slice(i); break; }
        if (cur.text.trim() || cur.anchors.length) beats.push(cur);
        cur = { actions: idOf(s.slice(i + 1, end)), text: '', anchors: [] };
        i = end + 1;
        continue;
      }
      if (ch === '<' || ch === '＜') {
        const close = ch === '<' ? '>' : '＞';
        const end = s.indexOf(close, i + 1);
        const inner = end < 0 ? '' : s.slice(i + 1, end);
        if (end < 0 || inner.length > 32 || /\n/.test(inner)) { cur.text += ch; i++; continue; }
        const acts2 = idOf(inner);
        if (acts2.length) cur.anchors.push({ at: cur.text.length, actions: acts2 });
        i = end + 1;
        continue;
      }
      cur.text += ch; i++;
    }
    beats.push(cur);
    /* 兼容:模型仍会把开头写成 [词]/(词)/*词*,剥掉当作动作 */
    const head = /^(?:\[|\(|（|\*)\s*([^\]\)）*]{1,8})\s*(?:\]|\)|）|\*)/;
    let m;
    while ((m = beats[0].text.match(head)) && ACT_WORDS[m[1].trim()]) {
      beats[0].actions.push(ACT_WORDS[m[1].trim()]);
      beats[0].text = beats[0].text.slice(m[0].length).trim();
    }
    return beats.filter(b => b.text.trim() || b.actions.length || b.anchors.length);
  };

  /* 官网 stepActs 同款动作队列:逐个做,每个按词表 seconds 间隔;做的时候闲逛闭嘴(holdRoam) */
  const actQ = [];
  let actQUntil = 0;
  const queueActs = ids => {
    if (!ids?.length) return;
    actQ.push(...ids);
    try { ctl.holdRoam(8); } catch { /* 控制器还没就绪 */ }
  };
  /* ---------- 页面指令(@开头的词):她不只是做表情,还能操作网页——滚动到某屏、
     走到项目卡旁边"亲手"点进去、切换风格。只有白名单动作,模型给不出任意代码 ---------- */
  const IN_PROJECTS = /\/projects\//.test(location.pathname);
  const scrollToSec = (...ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) { scrollTo({ top: Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY - innerHeight * .06)), behavior: 'smooth' }); return; }
    }
  };
  /* 走到项目卡旁,到位后亲手点进去(跨页记忆让她在新页面接着陪你逛) */
  const openProject = async page => {
    if (IN_PROJECTS) {   // 已经在项目页里:同名页滚到开头,不同名直接走
      if (location.pathname.endsWith(page)) { scrollToSec('overview'); return; }
      location.href = page;
      return;
    }
    const card = document.querySelector(`a[href*="${page}"]`);
    const b = ctl.bounds;
    const r = card?.getBoundingClientRect();
    const target = r ? Math.round(Math.max(b.minX + 60, Math.min(r.x + r.width / 2, b.maxX - 60))) : Math.round(b.W * .62);
    try { ctl.holdRoam(9); ctl.walkTo(target, true, 'open-' + page); await arrive(target, 3200); } catch { /* 被拎起等:照常点 */ }
    if (card) card.click(); else location.href = 'projects/' + page;
  };
  const PAGE_ACTS = {
    '@rag': () => openProject('rag.html'),
    '@boom': () => openProject('boom-arcade.html'),
    '@home': () => { location.href = (IN_PROJECTS ? '../' : '') + 'index.html'; },
    '@projects': () => scrollToSec('projects', 'b-projects', 'overview'),
    '@skills': () => scrollToSec('skills', 'b-about', 'overview'),
    '@about': () => scrollToSec('about', 'b-about', 'overview'),
    '@top': () => scrollTo({ top: 0, behavior: 'smooth' }),
    '@bottom': () => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }),
    '@theme': () => document.getElementById('styleToggle')?.click(),
  };
  const stepActs = now => {
    if (now < actQUntil || !actQ.length) return;
    if (ctl.busy && ctl.busy()) return;   // 拖拽/空中/下蹲时不抢戏
    const a = actQ.shift();
    if (PAGE_ACTS[a]) { try { PAGE_ACTS[a](); } catch { /* 页面动作失败不拖累表情 */ } actQUntil = now + 2400; return; }
    try { ctl.doWord(a); } catch { /* 词表外 */ }
    actQUntil = now + (VOCAB_SECONDS[a] ?? 1) * 1000;
  };
  /* 回复(可能多段)→ 逐段演出;返回干净的正文(进对话历史) */
  const playBeats = async (beats, lastHold) => {
    let full = '';
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      queueActs(b.actions);
      if (b.text) {
        full += (full ? ' ' : '') + b.text;
        await say(b.text, { hold: i === beats.length - 1 ? lastHold : 900, anchors: b.anchors });
      }
    }
    return full;
  };

  /* OpenAI 兼容 / Anthropic / Gemini 三种形状,按提供商分发 */
  const fetchT = (url, opts, ms = 30000) => { const c = new AbortController();
    const timer = setTimeout(() => c.abort(), ms);
    return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(timer)); };
  async function llmCall(cfg, history) {
    const sys = CHAT_PERSONA;
    const base = (cfg.baseUrl || LLM_DEFAULT_URLS[cfg.provider] || '').replace(/\/+$/, '');
    const model = cfg.model || LLM_DEFAULT_MODELS[cfg.provider] || '';
    if (cfg.provider === 'anthropic') {
      const r = await fetchT(base + '/v1/messages', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: 400, system: sys, messages: history }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + (t ? '：' + t.slice(0, 90) : '')); }
      const j = await r.json();
      return (j.content || []).map(c => c.text || '').join('');
    }
    if (cfg.provider === 'gemini') {
      const r = await fetchT(`${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: sys }] },
          contents: history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }) });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + (t ? '：' + t.slice(0, 90) : '')); }
      const j = await r.json();
      return ((j.candidates || [])[0] || { content: { parts: [] } }).content.parts.map(p => p.text || '').join('');
    }
    // OpenAI 兼容(deepseek/openai/qwen/kimi/minimax/custom)
    const r = await fetchT(base + '/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, ...history], max_tokens: 400, temperature: 0.8 }) });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + (t ? '：' + t.slice(0, 90) : '')); }
    const j = await r.json().catch(() => { throw new Error('响应不是 JSON'); });
    return ((j.choices || [])[0] || { message: {} }).message.content || '';
  }

  /* ---------- 戳事件 → 模型回应(官网 poke 唤醒的网页版):冷却 15s,忙/打字中不触发;
     触摸闲聊不进对话历史(即兴的),失败就算了(身体反射已经演过) ---------- */
  let touchBusy = false;
  const maybeTouchSay = async () => {
    if (touchBusy || chatBusy || performance.now() < touchCoolUntil) return;
    if (!typeEl || !typeEl.hidden) return;   // 用户正在打字:别打扰
    const cfg = (() => { try { return JSON.parse(localStorage.getItem(LLM_KEY) || 'null'); } catch { return null; } })();
    if (!cfg || !cfg.apiKey) return;         // 没配置:纯本地反射,不引导不打扰
    touchBusy = true; touchCoolUntil = performance.now() + 15000;
    try {
      const hist = chatHistory.slice(-4);
      const beats = parseBeats((await llmCall(cfg, [...hist, { role: 'user', content: '[touch] 用户刚才戳了你一下，用一两句话回应这个互动' }])) || '');
      await playBeats(beats, 1800);
    } catch { /* 触摸闲聊失败就算了 */ }
    touchBusy = false;
  };

  /* ---------- 点赞:白底圆钮 + 粉色实心爱心 + 计数徽章(参考 lvyovo-wiki)。
     计数走 Abacus(免费计数 API,CORS 开箱即用,GitHub Pages 可直连):
     /hit 自增并返回 {value: n},全站访客共享同一个数;/get 只读不增。
     远端拉取失败(服务挂/被墙/超时)自动退回本机 localStorage——按钮永远有反应。
     想换自建服务(Cloudflare Worker 等):改 LIKE_API 一行,返回 {value} 同形状即可 ---------- */
  /* 计数端可被 localStorage 临时覆盖(控制台
     localStorage.setItem('koda.pet.likeApi', 'https://...') 即时生效,见 like-worker/README.md)。
     默认:自建 Worker(koda.loveelysia.qzz.io,数据在主人自己的 Cloudflare D1 里) */
  const LIKE_API = (() => { try { return localStorage.getItem('koda.pet.likeApi') || 'https://koda.loveelysia.qzz.io'; } catch { return 'https://koda.loveelysia.qzz.io'; } })();
  const LIKE_NS = 'koda987-site';
  const LIKE_NAME = 'like';
  const LIKE_KEY = 'koda.pet.likes';   // 本机兜底计数
  const likeFmt = n => n > 999 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  let likeBusy = false;
  let likeKnown = null;   // 最近一次已知的全站赞数(开屏 get 填充,点赞 hit 校准)
  function likeOnce(btn) {
    if (likeBusy) return;
    likeBusy = true;
    setTimeout(() => { likeBusy = false; }, 350);   // 350ms 后即可再点:别让远端慢吞掉点击(每次点击各记一票)
    /* 乐观更新:点击瞬间就 +1 亮出来(用已知全站数或本机数),远端结果到了再校准——
       网络再慢按钮也有即时反馈 */
    const base = likeKnown ?? (() => { try { return parseInt(localStorage.getItem(LIKE_KEY), 10) || 0; } catch { return 0; } })();
    const count = base + 1;
    const badge = btn.querySelector('.pt-like-badge');
    if (badge) badge.textContent = likeFmt(count);
    try { localStorage.setItem(LIKE_KEY, String(count)); } catch {}
    /* 远端自增:后台跑,不挡爱心演出;结果只增不减地校准徽章 */
    if (LIKE_API) (async () => {
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 2500);
        const r = await fetch(`${LIKE_API}/hit/${LIKE_NS}/${LIKE_NAME}`, { signal: c.signal }).finally(() => clearTimeout(t));
        const j = await r.json();
        if (j && typeof j.value === 'number' && j.value >= count) { likeKnown = j.value; if (badge) badge.textContent = likeFmt(j.value); }
      } catch { /* 远端不行:乐观数已亮出,本机也记了 */ }
    })();
    btn.classList.add('burst');
    setTimeout(() => btn.classList.remove('burst'), 700);
    // 爱心迸发:小爱心从按钮四散飘起
    for (let i = 0; i < 6; i++) {
      const h = document.createElement('span');
      h.className = 'pt-heart';
      h.textContent = '♥';
      h.style.left = 6 + Math.random() * 22 + 'px';
      btn.appendChild(h);
      const dx = (Math.random() - .5) * 46, dy = -(36 + Math.random() * 40);
      h.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 1 },
                 { transform: `translate(${dx}px,${dy}px) scale(1.15)`, opacity: 0 }],
                { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.2,.7,.3,1)' })
        .onfinish = () => h.remove();
    }
    try { ctl.doWord('love'); } catch {}   // 点赞爱心眼(表情词走 ctl.do)
    say(pick(['谢谢喜欢~', '收到一颗心，数据不说谎！', '哇，被喜欢啦~']), { hold: 1800 });
  }
  /* 开屏就把全站共享的赞数填上(拿不到就维持本机数,不打扰任何人) */
  async function fillLikeBadge(badge) {
    if (!badge || !LIKE_API) return;
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000);
      const r = await fetch(`${LIKE_API}/get/${LIKE_NS}/${LIKE_NAME}`, { signal: c.signal }).finally(() => clearTimeout(t));
      const j = await r.json();
      if (j && typeof j.value === 'number' && j.value >= (parseInt(badge.textContent, 10) || 0)) { likeKnown = j.value; badge.textContent = likeFmt(j.value); }
    } catch { /* 拿不到就维持本机数 */ }
  }
  /* 预热已移除:figure.preload() 会一口气拉全部 24 种配色×服装(≈14MB、1272 张贴图)——
     弱网下它和首屏抢带宽(登场被拖到几十秒),还会在高并发解码下产出坏位图,
     之后切换配色就渲染成蓝色积木块。现在切换时按需加载(约 2MB/套,经 IDB 缓存,
     同一套第二次切换瞬时);慢网进度反馈见 boot 里的进度气泡 */
  /* ?petdebug:控制台里看她的状态、已说过的台词和冷却,调台词节奏用 */
  if (new URLSearchParams(location.search).has('petdebug')) {
    window.__pet = {
      ctl,
      parseBeats, playBeats, queueActs,
      get chatBusy() { return chatBusy; },
      get said() { return [...saidOnce]; },
      get freeAt() { return ambientFreeAt; },
      say, ambient,
    };
  }
}

/* 续访:立即启动(贴图已缓存),抢在页面转场结束前把她画出来,接力不断档;
   首访(官网风且开屏在播):等开屏"字活过来"(koda:intro-alive)再启动,从右侧跑入登场;
   揭幕登场,和打出的 "Koda... Koda?" 呼应;其余情况 load 后挑空闲时机 */
const idle = cb => ('requestIdleCallback' in window)
  ? requestIdleCallback(cb, { timeout: 4000 })
  : setTimeout(cb, 2000);
let introJustPlayed = false;   // boot 由开屏揭幕事件带起:迎宾用"大肥鱼"问句与开屏呼应
if (stage && prev) boot();
else if (stage) {
  let introOn = false;
  try { introOn = document.documentElement.dataset.theme === 'bauhaus' && sessionStorage.getItem('koda.intro') === '1'; } catch { /* 无法读就算不播 */ }
  if (introOn) {
    let started = false;
    const go = viaIntro => { if (!started) { started = true; introJustPlayed = viaIntro; boot(); } };
    document.addEventListener('koda:intro-alive', () => go(true), { once: true });   // 字"活过来"时她空降登场
    setTimeout(() => go(false), 6500);   // 兜底:开屏没播或事件错过,最多等 6.5 秒
    // 页面在后台时刷新,动画/定时器全被节流,上面两个都不来,boot 会挂到分钟级——
    // 切回前台的那一刻直接放行(开屏早播过了,空降或跑入都成立)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) go(false); }, { once: true });
  } else if (document.readyState === 'complete') idle(boot);
  else addEventListener('load', () => idle(boot), { once: true });
}
