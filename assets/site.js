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
})();
