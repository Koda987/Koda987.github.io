/* 大肥鱼的说话声:动物森友会式音节库(官方 cortico-world-desktop-pet/web/speech 同款数据,
   播放算法与官方 speech.js 同源移植,AGPL 同许可)。
   差异:官方由 World 服务端把文本拆成音节(POST /api/speech,IPA 转换);
   网页静态版改用本地汉字→拼音表(voice-pinyin.json,pypinyin 生成,加载时倒排)。
   两只时钟:气泡按自己的节奏逐字揭示,声音最多每秒起 13 个单元,落后于文本、在文本后结束;
   标点后保持静音(VOICE_GAP),落后超过 MAX_LAG 丢弃弱音节。
   短语内的音高:句首抬升、缓降、疑问上扬、感叹更亮,普通话按声调轻微起伏(TONES)。 */

const VOICE_GAP = {
  ',': .14, '，': .14, '、': .14, ';': .2, '；': .2, ':': .2, '：': .2,
  '.': .45, '。': .45, '!': .5, '！': .5, '?': .5, '？': .5, '…': .3, '~': .1, '～': .1,
};
const TEXT_PAUSE = {
  ',': 5, '，': 5, '、': 5, ';': 6, '；': 6, ':': 6, '：': 6,
  '.': 9, '。': 9, '!': 9, '！': 9, '?': 9, '？': 9, '…': 4, '~': 3, '～': 3,
};
export const STEP_MS = 50;   // 官网:打字一步 = 1/20 秒(约每秒 20 字),pet.js 打字循环同用
const ALPHABET = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\s'’-]/u;
export const textSteps = ch => TEXT_PAUSE[ch] ?? (ALPHABET.test(ch) ? .4 : 1);
const MAX_LAG = 1;
const TONES = { 1: [.8, .8], 2: [-.6, 1.6], 3: [-1, -1.8, -.6], 4: [1.6, -1.2], 5: [-.8, -.8] };
const TONE_AMOUNT = .35, STRESS_ST = 1, GAIN = .45, UPS = 13, BANK_HZ = 364;

export function createVoice({ base }) {
  const bankBase = new URL('vendor/speech/', base);   // 音库在 vendor/speech(与 whale 同级)
  let ctx = null, master = null;
  let bank = null, decoding = null;
  let on = true, hz = 400;
  let text = '', byAt = null, waiting = [], asked = false;
  let inv = null, charOf = null;
  const playing = new Set(), timers = new Set();
  let rnd = 1234567;
  const random = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };

  function out() {
    if (!on) return null;
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { on = false; return null; }
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    /* 下载与解码都不需要「运行中」状态:挂起期间照常进行,手势解锁的瞬间声音即完全就绪
       (此前解码被运行状态门控,手势后还要再等解码,首几句总是哑的) */
    if (!bank) void fetchBank();
    else if (!bank.buffer && bank.bytes && !decoding) {
      decoding = ctx.decodeAudioData(bank.bytes.slice(0)).then(
        b => { bank.buffer = b; decoding = null; },
        err => { console.error('说话声没能解码:', err); bank = null; decoding = null; });
    }
    if (ctx.state !== 'running') return null;
    if (!bank || !bank.buffer) return null;
    return { ctx, master };
  }
  function fetchBank() {
    const get = (name, how) => fetch(new URL(name, bankBase)).then(r => (r.ok ? r[how]() : Promise.reject(new Error(`HTTP ${r.status}`))));
    bank = { units: null, buffer: null, bytes: null };
    bank.fetching = Promise.all([get('zh.json', 'json'), get('zh.ogg', 'arrayBuffer')]).then(([manifest, bytes]) => {
      bank.units = new Map(Object.entries(manifest.units));
      bank.hz = manifest.hz; bank.bytes = bytes;
    }, err => { console.error('说话声音库没能加载:', err); bank = null; on = false; });
    return bank.fetching;
  }
  /* 汉字→拼音表:加载并倒排成 字码 → {key, tone} */
  async function loadInv() {
    if (charOf) return charOf;
    try { inv = await (await fetch(new URL('pinyin.json', bankBase))).json(); } catch { inv = {}; }
    charOf = {};
    for (const key in inv) for (const tone in inv[key]) for (const c of inv[key][tone]) charOf[c] = { key, tone };
    return charOf;
  }

  /* 文本 → 音节单元(客户端拼音表替代官方 World 的 IPA 服务):{at, key, tone, pos, of, weak, end} */
  async function unitsOf(t) {
    const map = await loadInv();
    if (!map) return [];
    const units = [];
    let phrase = [];
    const flush = endCh => {
      const of = phrase.length;
      phrase.forEach((u, k) => units.push({ ...u, pos: k, of, weak: k < of - 2, end: endCh || '' }));
      phrase = [];
    };
    for (let i = 0; i < t.length; i++) {
      const ch = t[i], code = ch.codePointAt(0);
      const isHan = code >= 0x3400 && code <= 0x9FFF;
      if (VOICE_GAP[ch] !== undefined) { flush(ch); continue; }   // 停顿标记:收束短语,语调按标记
      if (isHan) { const m = map[code]; if (m) phrase.push({ at: i, key: m.key, tone: m.tone }); continue; }
      if (ALPHABET.test(ch) || /[\s'’-]/u.test(ch)) continue;     // 字母/空格:留在线内,不出声
      flush(''); continue;                                        // 其他符号:收束短语
    }
    flush('');
    return units;
  }

  /* ---------- the voice clock(官网同款) ---------- */
  const clock = {
    last: -Infinity, end: 0, free: 0, gap: 0,
    reset(now) { this.last = -Infinity; this.end = now; this.free = now; this.gap = 0; },
    mark(ch) { this.gap += VOICE_GAP[ch] ?? 0; this.free = this.end + this.gap; },
    place(now, { weak, final }, len) {
      const t = Math.max(now, this.last + 1 / UPS, this.free);
      const lag = t - now;
      if (!final && (lag > 2 * MAX_LAG || (lag > MAX_LAG && weak))) return null;
      this.last = t; this.end = Math.max(this.end, t + len); this.gap = 0;
      return t;
    },
  };

  /* ---------- playback(官网同款曲线数学) ---------- */
  function play(o, u, t) {
    const [off, len] = bank.units.get(u.key);
    const { ctx, master } = o;
    const rate = hz / bank.hz;
    const q = /[?？]/.test(u.end), ex = /[!！]/.test(u.end), last = u.pos === u.of - 1;
    let st = (u.pos === 0 ? .8 : 0) - .06 * u.pos + (random() - .5) * .4 + (ex ? 1 : 0) + (u.stress ? STRESS_ST : 0);
    let bend = 0;
    if (q && u.pos === u.of - 2) st += 1.5;
    if (q && last) { st += 2; bend = 3; }
    if (/…/.test(u.end || '') && last) st -= .8;
    const tone = u.tone ? TONES[u.tone] : [0, 0];
    const curve = new Float32Array(8);
    for (let k = 0; k < 8; k++) {
      const p = k / 7, x = p * (tone.length - 1), a = Math.floor(x), b = Math.min(tone.length - 1, a + 1);
      const ts = (tone[a] + (tone[b] - tone[a]) * (x - a)) * TONE_AMOUNT;
      curve[k] = rate * 2 ** ((st + ts + bend * p) / 12);
    }
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = bank.buffer;
    src.playbackRate.setValueCurveAtTime(curve, t, len / rate);
    g.gain.value = GAIN * (ex ? 1.26 : 1);
    src.connect(g); g.connect(master);
    src.start(t, off, len);
    playing.add(src);
    src.onended = () => playing.delete(src);
  }

  /* ---------- 对外 API:begin(文本) / reveal(字序号) / stop() ---------- */
  function speak(o, i) {
    const ch = text[i];
    if (VOICE_GAP[ch] !== undefined) clock.mark(ch);
    const now = o.ctx.currentTime + .02;
    if (clock.end < now - 2) clock.reset(now);
    for (const u of byAt.get(i) ?? []) {
      if (!bank.units.has(u.key)) continue;
      const len = bank.units.get(u.key)[1] / (hz / bank.hz);
      const t = clock.place(now, { weak: u.weak, final: u.pos >= u.of - 2 }, len);
      if (t !== null) play(o, u, t);
    }
  }
  function ask() {
    if (asked || !text) return;
    asked = true;
    const t = text;
    unitsOf(t).then(units => {
      if (text !== t) return;
      byAt = new Map();
      for (const u of units) { if (!byAt.has(u.at)) byAt.set(u.at, []); byAt.get(u.at).push(u); }
      const o = out();
      if (o) for (const i of waiting) speak(o, i);
      waiting = [];
    }, err => { console.error('说话声没能拆成音节:', err); if (text === t) { byAt = new Map(); waiting = []; } });
  }

  return {
    configure({ enabled } = {}) { if (typeof enabled === 'boolean') { on = enabled; if (on) void fetchBank(); else this.stop(); } },
    /* 预热:开屏就把音库/拼音表拉好、建好音频上下文;手势时再调一次把 suspended 的上下文唤醒。
       幂等:已下载的库不会重拉。没有它,第一句台词开口时才开始下载,整句多半是哑的 */
    warm() {
      if (!on) return;
      void loadInv();
      if (!bank) void fetchBank();
      out();
    },
    get active() { return Boolean(out()); },
    begin(t) {
      if (t === text) return;
      text = t; byAt = null; waiting = []; asked = false;
      if (on) ask();
    },
    reveal(i) {
      const o = out();
      if (!o) return false;
      if (byAt) speak(o, i); else { waiting.push(i); ask(); }
      return true;
    },
    stop() {
      for (const s of playing) { try { s.stop(); } catch { /* 未开始 */ } }
      playing.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clock.reset(0);
      text = ''; byAt = null; waiting = []; asked = false;
    },
  };
}
