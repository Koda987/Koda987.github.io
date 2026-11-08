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

import { createWhaleFigure } from './vendor/whale/figure.js';

/* ---------- 门控 ---------- */
const webglOK = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
})();
const ready = () => matchMedia('(prefers-reduced-motion: reduce)').matches || !webglOK || innerWidth <= 600;

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
     document 级监听 + 引擎自己的命中测试,不挡页面任何点击 */
  stage = document.createElement('div');
  stage.id = 'pet-stage';
  stage.innerHTML =
    '<svg aria-hidden="true">' +
      '<ellipse class="shadow" cx="0" cy="0" rx="0" ry="0"/>' +
      '<g class="pet"></g>' +
      '<g class="fx"></g>' +
    '</svg>';
  document.body.appendChild(stage);
  svgEl = stage.querySelector('svg');
}

/* 角色比例:与官网一致——基础 0.78,矮窗口缩到 0.86 倍,大屏(≥1600/1900/2400 宽)逐级放大;
   --pet-s 留作整体微调旋钮,默认 1 */
const petScale = () => {
  const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--pet-s'));
  const big = innerWidth >= 2400 && innerHeight >= 1300 ? 1.35
    : innerWidth >= 1900 && innerHeight >= 1000 ? 1.2
    : innerWidth >= 1600 && innerHeight >= 860 ? 1.1 : 1;
  return (Number.isFinite(s) ? s : 1) * .78 * big * (innerHeight < 650 ? .86 : 1);
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

async function boot() {
  if (!stage) return;
  const die = () => { stage.remove(); stage = null; };
  let ctl;
  try {
    const figure = await createWhaleFigure(undefined, { scheme: 'deepseek' });
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
  } catch { die(); return; }   // 贴图拉不下来之类:整个不出现,页面照常
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
    if (!ctl.pointerDown(pt(e))) return;
    holding = true;
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
    if (cur) { document.body.style.cursor = cur; cursorSet = true; }
    else if (cursorSet) { document.body.style.cursor = ''; cursorSet = false; }
  }, true);
  const releaseAt = p => {
    holding = false;
    document.documentElement.classList.remove('pet-grab');
    ctl.pointerUp(p);
    if (cursorSet) { document.body.style.cursor = ''; cursorSet = false; }
  };
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
    for (const ch of text) {
      if (tok !== sayToken) return;          // 被新台词顶掉:气泡已归新主人,不要动它(更不能藏掉问句)
      bubbleEl.textContent += ch;
      ctl.talk();                            // 口型跟着字走
      placeBubble();
      await sleep(28);                       // 官网 typeInto 的 26ms/字规格
    }
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
  const CHATTER = ['我就在这儿,想聊天就戳戳我~', '页面看完了吗?下面还有哦~', '(小声) 摸摸我的头试试~', '扔我可以,轻点扔…'];
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
  const HOST_GREET = ['官网风格,主持模式上线~', '换好衣服啦,今天由我带你逛~', '这个风格是不是很眼熟?'];
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
    } else say(pick(HOST_GREET), { hold: 2400 });
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
    let prepped = false;
    new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting) || prepped) return;
      if (!hostMode || saidOnce.has('sec:' + id) || document.documentElement.hasAttribute('data-intro')) return;
      prepped = true;
      items.forEach(it => {
        const t = (document.querySelectorAll(it.sel))[it.i || 0];
        if (t) t.classList.add('pet-item-wait');
      });
    }, { threshold: .05 }).observe(el);
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
          { at: 0, text: '先介绍一下我的主人Koda，他的技能都写在左边啦' },
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
    async function playFeature(i, tok) {
      showSummary(false);
      $f('.feat-skip').classList.add('on');     // 官网:演出期间右上角亮出「跳过」,收场时 endDemo 熄掉
      if (ctl.pet.mode === 'sleep') ctl.act('stand');
      const b = ctl.bounds;
      const spot = Math.round(Math.max(b.minX + 60, Math.min(b.W * .24, b.maxX - 60)));
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
                const el = document.getElementById('projects');
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
    featEnter = () => {
      if (featSection.classList.contains('live')) return;
      if (!hostMode || document.documentElement.hasAttribute('data-intro')) return;
      featSection.classList.add('live');
      if (featDone) { toSpot(); return; }
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
      showSummary(featDone);
    };
    new IntersectionObserver(es => {
      // 快速切屏时"离开+进入"会挤进同一批回调,逐条处理两段都要生效,被打断的模块才会从头重演
      for (const e of es) (e.isIntersecting ? featEnter : featLeave)();
    }, { threshold: .45 }).observe(featSection);
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
    about: ['这里是他自己的小传,比简历真诚~', '看完这页,你就认识他啦~', '你能让我的主人给我挣大白饭吗？'],
    'b-about': ['这里是他自己的小传,比简历真诚~', '看完这页,你就认识他啦~'],
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
    else say(pick(CHATTER), { hold: 2600 });
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
    } else say('回到经典白啦,有事叫我~', { hold: 2000 });
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
  const frame = t => {
    const dt = Math.min(.05, (t - last) / 1000 || 0);
    last = t;
    lastFrameAt = t;
    ctl.step(dt);
    ctl.render();
    placeBubble();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  addEventListener('resize', () => { fit(); ctl.resize(); });
  addEventListener('pagehide', () => saveState(ctl.pet.x / bounds().W, ctl.pet.facing));

  /* ?petdebug:控制台里看她的状态、已说过的台词和冷却,调台词节奏用 */
  if (new URLSearchParams(location.search).has('petdebug')) {
    window.__pet = {
      ctl,
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
  } else if (document.readyState === 'complete') idle(boot);
  else addEventListener('load', () => idle(boot), { once: true });
}
