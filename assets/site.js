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

    /* ---------- 3. 截图轻视差（滚动时缓慢漂移，制造纵深） ---------- */
    var shots = document.querySelectorAll('.shot-frame');
    if (shots.length && !reduced) {
        var ticking = false;
        function update() {
            var vh = window.innerHeight;
            shots.forEach(function (f) {
                var r = f.getBoundingClientRect();
                var mid = (r.top + r.bottom) / 2;
                var off = (mid - vh / 2) / vh;      // 元素中心偏离视口中心的比例
                f.style.transform = 'translateY(' + (off * -14).toFixed(1) + 'px)';
            });
            ticking = false;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; requestAnimationFrame(update); }
        }, { passive: true });
        update();
    }
})();
