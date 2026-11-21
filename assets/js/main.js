/* Site behaviour:
   1. scroll-reveal for every element marked [data-reveal]
   2. the "Up" button on case pages slides in when you start scrolling
   3. reliable muted autoplay for videos */
(function () {
  'use strict';

  var REVEAL = {
    rootMargin: '0px',             // reveal as soon as the element enters the viewport (same as the Webflow original;
                                   // a negative margin would leave elements at the very end of the page hidden)
    stagger: 90,                   // ms between elements that appear in the same moment
    maxStagger: 5,                 // cap, so a long batch never waits too long
    duration: 800                  // keep in sync with custom.css
  };

  // ---- 1. scroll reveal -----------------------------------------------------
  var items = document.querySelectorAll('[data-reveal]');

  function finish(el) {
    // Drop the animated properties afterwards: no leftover GPU layers / filters on big images.
    el.style.transitionDelay = '';
    el.classList.add('is-done');
  }

  function reveal(el, delay) {
    if (delay) el.style.transitionDelay = delay + 'ms';
    el.classList.add('is-revealed');
    var done = false;
    function end() { if (!done) { done = true; finish(el); } }
    el.addEventListener('transitionend', function (e) {
      if (e.target === el && e.propertyName === 'opacity') end();
    });
    setTimeout(end, REVEAL.duration + delay + 150); // fallback if transitionend never fires
  }

  if (items.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        var batch = entries.filter(function (e) { return e.isIntersecting; })
          .map(function (e) { return e.target; })
          .sort(function (a, b) {
            var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return (ra.top - rb.top) || (ra.left - rb.left);
          });
        batch.forEach(function (el, i) {
          io.unobserve(el);
          reveal(el, Math.min(i, REVEAL.maxStagger) * REVEAL.stagger);
        });
      }, { threshold: 0, rootMargin: REVEAL.rootMargin });
      items.forEach(function (el) { io.observe(el); });
    } else {
      items.forEach(function (el) { el.classList.add('is-revealed', 'is-done'); });
    }
  }
  window.__revealReady = true; // tells the failsafe in <head> that this script is running

  // ---- 2. "Up" button (case pages) ------------------------------------------
  // Same behaviour as the original Webflow interaction: the button sits 121px below its
  // place at the top of the page and slides up during the first 2% of the scroll.
  var up = document.querySelector('.up');
  if (up) {
    var HIDDEN_Y = 121, RANGE = 0.02, EASE = 0.2;
    var shown = 0;                      // smoothed scroll progress
    var raf = 0;

    var progress = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    var apply = function () {
      var target = progress();
      shown += (target - shown) * EASE;
      if (Math.abs(target - shown) < 0.0002) shown = target;
      var y = HIDDEN_Y * Math.max(0, 1 - shown / RANGE);
      up.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      raf = shown === target ? 0 : requestAnimationFrame(apply);
    };
    var kick = function () { if (!raf) raf = requestAnimationFrame(apply); };

    shown = progress();                 // right position immediately (e.g. page reloaded mid-scroll)
    up.style.transform = 'translate3d(0,' + (HIDDEN_Y * Math.max(0, 1 - shown / RANGE)).toFixed(2) + 'px,0)';
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);
  }

  // ---- 3. autoplaying videos must be muted + inline --------------------------
  // Set the properties explicitly (attributes alone are ignored by some browsers)
  // and retry play() if it was blocked.
  document.querySelectorAll('video[autoplay]').forEach(function (v) {
    v.muted = true;
    v.setAttribute('playsinline', '');
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  });
})();
