// 共享动效：滚动入场 / 数字滚动 / 截图轻视差
// 全部尊重系统的 prefers-reduced-motion 设置
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

    /* ---------- 4. 项目卡 3D 倾斜 + 光泽跟随（仅鼠标等精确指针设备） ---------- */
    var fine = window.matchMedia('(pointer: fine)').matches;
    if (fine && !reduced) {
        document.querySelectorAll('.project-card').forEach(function (card) {
            var raf = null;
            card.addEventListener('pointermove', function (e) {
                if (raf) return;
                raf = requestAnimationFrame(function () {
                    var r = card.getBoundingClientRect();
                    var x = (e.clientX - r.left) / r.width;    // 0 ~ 1 横向位置
                    var y = (e.clientY - r.top) / r.height;    // 0 ~ 1 纵向位置
                    card.style.setProperty('--ry', ((x - 0.5) * 8).toFixed(2) + 'deg');
                    card.style.setProperty('--rx', ((0.5 - y) * 6).toFixed(2) + 'deg');
                    card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
                    card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
                    raf = null;
                });
            });
            card.addEventListener('pointerleave', function () {
                card.style.setProperty('--rx', '0deg');
                card.style.setProperty('--ry', '0deg');
            });
        });
    }

    /* ---------- 5. 流式打字（首页 hero —— 用我项目里的方式向访客问好） ---------- */
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
        if (reduced) {
            sub.textContent = lines[1];
        } else {
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
            }, 900);                                     // 等 hero 入场动画完成
        }
    }

    /* ---------- 6. 实时时钟（导航栏，秒针跳动） ---------- */
    var clock = document.getElementById('siteClock');
    if (clock) {
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        var wd = ['日', '一', '二', '三', '四', '五', '六'];
        var tickClock = function () {
            var d = new Date();
            clock.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                ' 周' + wd[d.getDay()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        };
        tickClock();
        setInterval(tickClock, 1000);
    }

    /* ---------- 7. 建站天数 / 控制台彩蛋 / 标签页彩蛋 ---------- */
    var daysEl = document.getElementById('siteDays');
    if (daysEl) {
        daysEl.textContent = Math.max(1, Math.ceil((Date.now() - new Date(2026, 8, 14)) / 86400000));
    }

    console.log(
        '%c◈ Koda%c\n' +
        '正在寻找 LLM 应用开发 / AI 产品实习\n' +
        'GitHub → https://github.com/Koda987\n' +
        '（你能翻到控制台，说明足够细心——我们一定会聊得来 :)）',
        'font-size:22px;font-weight:700;color:#5b4fcf;',
        'font-size:12px;color:#6e6e73;line-height:1.8;'
    );

    var pageTitle = document.title;
    document.addEventListener('visibilitychange', function () {
        document.title = document.hidden ? '👋 还回来看 Koda 吗' : pageTitle;
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

    // 出场：点击站内文档链接 → 先播离场再跳转（仅兜底环境）
    if (!vtActive && !reduced) {
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
            // 被点击的模块（项目卡/链接组）向左上角飞出，其余内容渐白隐去
            var module = a.closest('.project-card') || a.closest('.hero-links') || a;
            module.classList.add('fly-away');
            document.body.classList.add('page-exit');
            setTimeout(function () { location.href = href; }, 450);
        });
    }
})();
