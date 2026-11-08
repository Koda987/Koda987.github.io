// 共享动效：滚动入场 / 数字滚动 / 截图轻视差
// 动效策略：打字机、时钟、呼吸点、极光等小幅动效永远播放；
// 入场飞入、3D 倾斜、视差、数字滚动、页面切换等大幅位移尊重系统"减少动态效果"设置
(function () {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- 1. 滚动入场（一次性淡入上移） ---------- */
    var els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
        els.forEach(function (el) { el.classList.add('in'); });
    } else {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    e.target.classList.add('in');
                    io.unobserve(e.target);
                }
            });
        }, { threshold: 0.08 });
        els.forEach(function (el) { io.observe(el); });
    }

    /* ---------- 2. 数字滚动（黑色数据幕的大数字） ---------- */
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function countUp(el) {
        var target = parseInt(el.getAttribute('data-target'), 10) || 0;
        var prefix = el.getAttribute('data-prefix') || '';
        var dur = 1400;
        var start = null;
        function frame(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / dur, 1);
            el.textContent = prefix + Math.round(easeOutCubic(p) * target);
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    var counters = document.querySelectorAll('.cnt');
    if (counters.length && 'IntersectionObserver' in window && !reduced) {
        var cio = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    countUp(e.target);
                    cio.unobserve(e.target);
                }
            });
        }, { threshold: 0.6 });
        counters.forEach(function (el) { cio.observe(el); });
    } else {
        // 不支持或用户要求减少动效：直接显示最终数字
        counters.forEach(function (el) {
            el.textContent = (el.getAttribute('data-prefix') || '') +
                             (el.getAttribute('data-target') || '0');
        });
    }

    /* ---------- 3. 截图 3D 视差（滚动时漂移 + 轻微透视俯仰） ---------- */
    var shots = document.querySelectorAll('.shot-frame');
    if (shots.length && !reduced) {
        var ticking = false;
        function update() {
            var vh = window.innerHeight;
            shots.forEach(function (f) {
                var r = f.getBoundingClientRect();
                var mid = (r.top + r.bottom) / 2;
                var off = (mid - vh / 2) / vh;      // 元素中心偏离视口中心的比例
                f.style.transform =
                    'perspective(1000px) translateY(' + (off * -14).toFixed(1) + 'px)' +
                    ' rotateX(' + (off * 2.4).toFixed(2) + 'deg)';
            });
            ticking = false;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; requestAnimationFrame(update); }
        }, { passive: true });
        update();
    }

    /* ---------- 4.（已移除）卡片 3D 倾斜 + 光泽跟随 ----------
       对齐参考站：悬浮只做快速弹性缩放（CSS --s 管道），不再写倾斜/光标变量 */

    /* ---------- 5. 流式打字（首页 hero —— 用我项目里的方式向访客问好）
       打字机是小幅"第一印象"动效，永远播放，不随系统减少动效设置关闭 ---------- */
    var sub = document.querySelector('[data-typing]');
    if (sub) {
        var h = new Date().getHours();
        var greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
        var lines = [
            greet + '，很高兴见到你。',
            '把大模型能力落成能用的产品。',
            'RAG 检索 · SSE 流式 · 数据驱动调参。',
            '此刻的字，正用我自己项目里的方式逐字浮现。'
        ];
        sub.classList.add('typing');
        var li = 0, ci = 0, deleting = false;
        setTimeout(function tick() {
            var line = lines[li];
            if (!deleting) {
                ci++;
                sub.textContent = line.slice(0, ci);
                if (ci === line.length) {
                    deleting = true;
                    setTimeout(tick, 2400);          // 打完整句停顿
                    return;
                }
                setTimeout(tick, 45 + Math.random() * 55);
            } else {
                ci--;
                sub.textContent = line.slice(0, ci);
                if (ci === 0) {
                    deleting = false;
                    li = (li + 1) % lines.length;
                    setTimeout(tick, 420);           // 换句前小停顿
                    return;
                }
                setTimeout(tick, 16);
            }
        }, 900);                                         // 等 hero 入场动画完成
    }

    /* ---------- 6. 实时时钟（导航栏 + Hero Bento 卡，秒针跳动） ---------- */
    var clock = document.getElementById('siteClock');
    var heroClock = document.getElementById('heroClock');
    var heroDate = document.getElementById('heroDate');
    var greetEn = document.getElementById('greetEn');
    var greetZh = document.getElementById('greetZh');
    if (clock || heroClock) {
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        var wd = ['日', '一', '二', '三', '四', '五', '六'];
        var tickClock = function () {
            var d = new Date();
            if (clock) {
                clock.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                    ' 周' + wd[d.getDay()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
            }
            if (heroClock) {
                heroClock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
            }
            if (heroDate) {
                heroDate.textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + wd[d.getDay()];
            }
            // 时段问候：跟随时钟整点自动切换（5-11 早上 / 11-14 中午 / 14-18 下午 / 其余晚上，凌晨算夜深）
            if (greetEn && greetZh) {
                var h = d.getHours();
                var g = h < 5 ? ['Good Night', '夜深了']
                     : h < 11 ? ['Good Morning', '早上好']
                     : h < 14 ? ['Good Noon', '中午好']
                     : h < 18 ? ['Good Afternoon', '下午好']
                     : ['Good Evening', '晚上好'];
                greetEn.textContent = g[0];
                greetZh.textContent = g[1];
            }
        };
        tickClock();
        setInterval(tickClock, 1000);
    }

    /* ---------- 7. 建站天数 / 控制台彩蛋 / 标签页彩蛋 ---------- */
    var daysEl = document.getElementById('siteDays');
    if (daysEl) {
        daysEl.textContent = Math.max(1, Math.ceil((Date.now() - new Date(2026, 8, 14)) / 86400000));
    }

    /* ---------- 7.1 GitHub 提交总数（实时拉取 + 本地缓存兜底） ----------
       用 Commit Search API 按作者名统计全部公开仓库的提交（含未来新仓库，
       单次请求零维护）；Search API 有独立限流额度；失败时回退 localStorage 缓存值 */
    var commitEl = document.getElementById('commitCount');
    if (commitEl) {
        var cachedCommits = localStorage.getItem('gh-commit-total');
        if (cachedCommits) {
            commitEl.textContent = cachedCommits;
            document.querySelectorAll('.commit-mirror').forEach(function (m) { m.textContent = cachedCommits; });
        }
        fetch('https://api.github.com/search/commits?q=author:Koda987&per_page=1')
            .then(function (res) { return res.json(); })
            .then(function (d) {
                if (d && d.total_count > 0) {
                    commitEl.textContent = d.total_count;
                    document.querySelectorAll('.commit-mirror').forEach(function (m) { m.textContent = d.total_count; });
                    localStorage.setItem('gh-commit-total', d.total_count);
                }
            })
            .catch(function () { /* 拉取失败保持初始值/缓存值 */ });
    }

    console.log(
        '%c◈ Koda%c\n' +
        '正在寻找 LLM 应用开发 / AI 产品实习\n' +
        'GitHub → https://github.com/Koda987\n' +
        '（你能翻到控制台，说明足够细心——我们一定会聊得来 :)）',
        'font-size:22px;font-weight:700;color:#5b4fcf;',
        'font-size:12px;color:#6e6e73;line-height:1.8;'
    );

    /* ---------- 9. 首屏 Bento 卡逐张浮现（每张错峰 180ms） ----------
       释放时机可被开屏接管：官网风首页首访先播开屏，播完再错峰放行。 */
    var cells = document.querySelectorAll('.bento .reveal');
    var bentoReleased = false;
    var releaseBento = function () {
        if (bentoReleased) return;
        bentoReleased = true;
        if (cells.length && !reduced) {
            cells.forEach(function (el, i) {
                el.style.transitionDelay = (i * 180) + 'ms';
            });
            void document.body.offsetWidth;     // 先锁延迟，再释放压制的样式
            document.body.classList.remove('boot-hold');
            setTimeout(function () {            // 序列结束后清掉内联延迟，
                cells.forEach(function (el) { el.style.transitionDelay = ''; });
                document.body.classList.add('bento-settled');   // 并把卡片悬浮切到快速弹性
            }, 3200);
        } else {
            document.body.classList.remove('boot-hold');
        }
    };
    if (introEligible()) {                      // 函数声明在下面第 10 节，已提升
        playIntro();
        document.addEventListener('koda:intro-done', releaseBento);
        setTimeout(releaseBento, 8500);         // 兜底：开屏任何卡壳也必放行
    } else {
        releaseBento();
    }

    var pageTitle = document.title;
    document.addEventListener('visibilitychange', function () {
        document.title = document.hidden ? '👋 还回来看 Koda 吗' : pageTitle;
    });

    /* ---------- 7.5 导航滑动胶囊 + 当前板块追踪（layoutId 的手写等价） ---------- */
    var pill = document.querySelector('.nav-pill');
    var linksWrap = document.querySelector('.nav-links');
    var spyLinks = {};
    document.querySelectorAll('.nav-link[href^="#"]').forEach(function (a) {
        spyLinks[a.getAttribute('href').slice(1)] = a;
    });
    var curSec = null;

    function movePill(link) {
        if (!pill) return;
        if (!link) { pill.classList.remove('show'); return; }
        var r = link.getBoundingClientRect();
        var w = linksWrap.getBoundingClientRect();
        pill.style.width = r.width + 'px';
        pill.style.transform = 'translateY(-50%) translateX(' + (r.left - w.left) + 'px)';
        pill.classList.add('show');
    }

    if ('IntersectionObserver' in window && Object.keys(spyLinks).length) {
        var navSpy = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                curSec = e.target;
                Object.keys(spyLinks).forEach(function (k) {
                    var on = k === e.target.id;
                    spyLinks[k].classList.toggle('active', on);
                    if (on) movePill(spyLinks[k]);
                });
            });
        }, { rootMargin: '-40% 0px -55% 0px' });
        document.querySelectorAll('section[id], header[id]').forEach(function (s) {
            navSpy.observe(s);
        });
    }
    window.addEventListener('resize', function () {
        var active = document.querySelector('.nav-link.active');
        if (active) movePill(active);
    });

    // 跳转前的旧内容让位：当前板块内可见卡片按 30ms 错峰缩小淡出
    function exitCurrentSection() {
        if (reduced) return;
        var sec = curSec || document.querySelector('.hero');
        if (!sec) return;
        var els = sec.querySelectorAll('.reveal.in, .project-card, .spec, .quote, .shot, .cell');
        els.forEach(function (el, i) {
            if (el.classList.contains('exit-out')) return;
            setTimeout(function () { el.classList.add('exit-out'); }, (i % 8) * 30);
        });
    }

    // bfcache 回退时清理离场残留
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) {
            document.querySelectorAll('.exit-out').forEach(function (el) {
                el.classList.remove('exit-out');
                el.style.transitionDelay = '';
            });
            document.querySelectorAll('.fly-away').forEach(function (el) {
                el.classList.remove('fly-away');
            });
            document.body.classList.remove('page-exit');
        }
    });

    /* ---------- 8. 页面切换动画 ----------
       原生 View Transitions 可用（部署后的 http/https + 新浏览器）→ 交给 CSS；
       否则（本地 file:// 等）用 JS 兜底：离场动画后跳转 + 进场浮入。
    -------------------------------------------------- */
    var vtActive = false;
    try {
        vtActive = window.CSS && CSS.supports &&
            CSS.supports('selector(::view-transition-group(root))') &&
            /^https?:$/.test(location.protocol);
    } catch (e) { vtActive = false; }

    // 进场：本页加载时整体轻浮（仅兜底环境）
    if (!vtActive && !reduced) {
        document.body.classList.add('page-enter');
    }

    // 出场：点击站内文档链接 → 旧内容错峰让位 →（兜底环境：模块飞走）→ 跳转
    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 ||
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest ? e.target.closest('a') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (a.target === '_blank') return;
        if (a.origin !== location.origin) return;                          // 外链/跨源
        if (href.charAt(0) === '#' || !/\.html($|[?#])/.test(href)) return; // 锚点/非页面链接
        e.preventDefault();
        exitCurrentSection();                                              // 旧内容 30ms 错峰让位
        if (!vtActive && !reduced) {                                       // 兜底环境：模块飞走 + 渐白
            var module = a.closest('.project-card') || a.closest('.hero-links') || a;
            module.classList.add('fly-away');
            document.body.classList.add('page-exit');
        }
        // 原生 VT 路径：让位动画先走 160ms，再触发导航（VT 拍旧页快照时已完成让位）
        setTimeout(function () { location.href = href; }, vtActive ? 160 : 450);
    });
    /* ---------- 10. 网页风格切换（默认 Apple 白 ⇄ 官网页风 coo） ----------
       <html data-theme="bauhaus"> 整体换肤（style.css 末段），localStorage 记忆，
       页面 <head> 里的内联脚本负责首帧前恢复、避免闪白；
       切换时广播 koda:style 事件，pet.js 听到后进入/退出「主持人模式」。 */
    var styleBtn = document.getElementById('styleToggle');
    if (styleBtn) {
        var syncBtn = function () {
            styleBtn.classList.toggle('on', document.documentElement.dataset.theme === 'bauhaus');
        };
        syncBtn();
        styleBtn.addEventListener('click', function () {
            var next = document.documentElement.dataset.theme === 'bauhaus' ? 'apple' : 'bauhaus';
            if (next === 'bauhaus') document.documentElement.dataset.theme = 'bauhaus';
            else delete document.documentElement.dataset.theme;
            try { localStorage.setItem('koda.style', next); } catch (e) {}
            syncBtn();
            // 换肤的 500ms 里给全站挂过渡，颜色平滑滑过去而不是硬切
            document.documentElement.classList.add('style-switching');
            setTimeout(function () {
                document.documentElement.classList.remove('style-switching');
            }, 500);
            if (next === 'bauhaus') playIntro();     // 切到包豪斯风：播开屏（函数在第 11 节，已提升）
            if (next === 'bauhaus' && !document.getElementById('bh-font')) {
                var l = document.createElement('link');
                l.id = 'bh-font'; l.rel = 'stylesheet';
                l.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=Noto+Sans+SC:wght@500;900&display=swap';
                document.head.appendChild(l);
            }
            document.dispatchEvent(new CustomEvent('koda:style', { detail: { theme: next } }));
        });
    }
    /* ---------- 10.5 品牌首屏滚动同步 ----------
       滚离品牌首屏一半后给 body 挂 past-brand,官网风下顶栏才浮现;
       必须常驻——只在开屏时注册的话,翻页重访(不开屏)顶栏会永远隐身。 */
    var syncBrand = function () {
        var brand = document.querySelector('.brand-screen');
        document.body.classList.toggle('past-brand',
            !brand || scrollY > innerHeight * 0.5);   // 无品牌屏的页面(项目详情页)恒显示
    };
    addEventListener('scroll', syncBrand, { passive: true });
    addEventListener('load', syncBrand);
    document.addEventListener('koda:style', syncBrand);
    syncBrand();

    /* ---------- 11. 官网风开屏（致敬 coo.palailab.org 的 opening） ----------
       条件：官网风 + 首页 + 本会话首次 + 未减弱动效。空屏上打字 "Koda... Koda?"
       （光标先空跳 → 首个词 → 省略号 → 停顿 → 第二个词 → 问号），随后文字淡出、
       揭幕淡出，Bento 卡错峰浮现、三色环缓缓亮起；鲸鱼在 pet.js 里等同一事件
       踩着揭幕空降登场。 */
    function introEligible() {
        var firstOfSession = false;
        try { firstOfSession = !sessionStorage.getItem('koda.intro'); } catch (e) {}
        return document.documentElement.dataset.theme === 'bauhaus'
            && /(^|\/)(index\.html)?$/.test(location.pathname)     // 首页（/ 或 index.html）
            && !reduced
            && firstOfSession;
    }
    function playIntro() {
        try { sessionStorage.setItem('koda.intro', '1'); } catch (e) {}
        var root = document.documentElement;
        root.setAttribute('data-intro', '');
        var veil = document.createElement('div');
        veil.id = 'intro-screen';
        veil.innerHTML = '<div class="intro-line"><span class="intro-text"></span><span class="intro-caret"></span></div>';
        document.body.appendChild(veil);
        var text = veil.querySelector('.intro-text');
        var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        // 逐字弹出（官网 glyph-pop:每个字从下方以弹簧曲线跳进来,光标跟在后面）
        var type = function (str, ms) {
            return new Promise(function (r) {
                var i = 0;
                (function tick() {
                    if (i < str.length) {
                        var g = document.createElement('span');
                        g.className = 'g';
                        g.textContent = str[i++];
                        text.appendChild(g);
                        setTimeout(tick, ms);
                    } else r();
                })();
            });
        };
        var done = false;
        var finish = function () {
            if (done) return;
            done = true;
            scrollTo(0, 0);   /* 开屏期间若滚轮带走了背后内容,揭幕前先归位(仍被盖着,看不见) */
            veil.querySelector('.intro-line').classList.add('out');
            setTimeout(function () {
                veil.classList.add('out');
                setTimeout(function () {
                    veil.remove();
                    root.removeAttribute('data-intro');
                    document.dispatchEvent(new CustomEvent('koda:intro-done'));
                }, 600);
            }, 300);
        };
        wait(550)                               // 光标先空跳一会儿
            .then(function () { return type('Koda', 120); })       // 名字先落
            .then(function () { return wait(350); })
            .then(function () { return type('，一名正在沉淀的开发者', 170); })   // 标语慢打
            .then(function () { return wait(650); })               // 官网 questionHold:满句停留
            .then(function () {                                    // 字"活过来"的时刻:鲸鱼此刻登场/蹦一下
                document.dispatchEvent(new CustomEvent('koda:intro-alive'));
                return wait(900);
            })
            .then(finish);
        setTimeout(finish, 8000);                // 兜底：任何卡壳 8 秒内必揭幕
    }
})();

    /* ---------- 12. V3 界面（第一风格）：人设图视差 ---------- */
    (function () {
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var v3 = document.querySelector('.v3');
        if (!v3) return;
        var hb = v3.querySelector('.hero-bg');
        if (hb && !reduced) {
            addEventListener('scroll', function () {
                if (scrollY < innerHeight) hb.style.transform = 'scale(1.04) translateY(' + (scrollY * .10).toFixed(1) + 'px)';
            }, { passive: true });
        }
    })();

/* ================= V3 皮肤细节：滚动进度条 + 鼠标柔光 =================
   节点常驻、CSS 按主题门控显示（html:not([data-theme="bauhaus"])），
   切到包豪斯风自动隐藏，无需拆装监听。 */
(function () {
    var bar = document.createElement('div'); bar.id = 'scrollProgress';
    var glow = document.createElement('div'); glow.className = 'cursor-glow';
    document.body.prepend(bar); document.body.prepend(glow);
    var upd = function () {
        var max = document.documentElement.scrollHeight - innerHeight;
        bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
    };
    addEventListener('scroll', upd, { passive: true }); upd();
    if (matchMedia('(pointer:fine)').matches) {
        document.addEventListener('pointermove', function (e) {
            glow.style.opacity = '.9';
            glow.style.left = e.clientX + 'px';
            glow.style.top = e.clientY + 'px';
        });
    }
})();
