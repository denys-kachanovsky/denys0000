/* Site behaviour: entrance animation + reliable muted autoplay for videos. */
(function () {
  'use strict';

  // 1. Fade/slide/unblur elements marked with [data-reveal] when they scroll into view.
  var items = document.querySelectorAll('[data-reveal]');
  if (items.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-revealed');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0 });
      items.forEach(function (el) { io.observe(el); });
    } else {
      items.forEach(function (el) { el.classList.add('is-revealed'); });
    }
  }

  // 2. Autoplaying videos must be muted + inline; set the properties explicitly
  //    (attributes alone are ignored by some browsers) and retry play() if blocked.
  document.querySelectorAll('video[autoplay]').forEach(function (v) {
    v.muted = true;
    v.setAttribute('playsinline', '');
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  });
})();
