/* Cursor trail: a thin line that follows the mouse and fades out behind it.
   - Mouse / pen only (disabled on touch devices and with prefers-reduced-motion).
   - Canvas is fixed, pointer-events: none, so it never blocks clicks.
   - The animation loop stops by itself when the mouse is idle.
   Tweak the look with the CONFIG values below. */
(function () {
  'use strict';

  var CONFIG = {
    lifetime: 650,   // ms a point of the line stays visible (trail length)
    dotSize: 24,     // px, diameter of the dot the line starts from (0 = no dot)
    maxWidth: 2.2,   // px, line thickness at the head
    follow: 0.28,    // 0..1, how quickly the head catches up with the cursor (lower = smoother/laggier)
    minStep: 0.6,    // px, ignore tiny movements
    color: '255,255,255',
    opacity: 0.85
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduce || !fine) return;

  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;' +
    'z-index:9999;mix-blend-mode:difference;';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  var dpr = 1, w = 0, h = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  resize();
  window.addEventListener('resize', resize);

  var points = [];             // {x, y, t}
  var target = null;           // pointer position
  var head = null;             // smoothed head position
  var running = false;
  var lastMove = 0;            // timestamp of the last pointer movement (drives the dot fade)

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    lastMove = performance.now();
    target = { x: e.clientX, y: e.clientY };
    if (!head) head = { x: target.x, y: target.y };
    start();
  }, { passive: true });

  // Pointer left the window: let the trail fade out and forget the head.
  document.addEventListener('pointerleave', function () { target = null; head = null; });
  document.documentElement.addEventListener('mouseleave', function () { target = null; head = null; });

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function frame(now) {
    // advance the smoothed head and record it
    if (target && head) {
      head.x += (target.x - head.x) * CONFIG.follow;
      head.y += (target.y - head.y) * CONFIG.follow;
      var last = points[points.length - 1];
      if (!last || Math.hypot(head.x - last.x, head.y - last.y) > CONFIG.minStep) {
        points.push({ x: head.x, y: head.y, t: now });
      }
    }
    // drop expired points
    while (points.length && now - points[0].t > CONFIG.lifetime) points.shift();

    ctx.clearRect(0, 0, w, h);
    draw(now);
    var dotAlpha = drawDot(now);

    var settled = !target || !head ||
      Math.hypot(target.x - head.x, target.y - head.y) < CONFIG.minStep;
    if (points.length || !settled || dotAlpha > 0) {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  // The dot the line starts from. Fully visible while the mouse moves,
  // fades out over `lifetime` ms after it stops. Returns the alpha it was drawn with.
  function drawDot(now) {
    if (!CONFIG.dotSize || !head) return 0;
    var life = 1 - (now - lastMove) / CONFIG.lifetime;
    if (life <= 0) return 0;
    ctx.fillStyle = 'rgba(' + CONFIG.color + ',' + (life * life * CONFIG.opacity).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(head.x, head.y, CONFIG.dotSize / 2, 0, Math.PI * 2);
    ctx.fill();
    return life;
  }

  function draw(now) {
    var n = points.length;
    if (n < 2) return;
    for (var i = 1; i < n; i++) {
      var p0 = points[i - 1], p1 = points[i];
      var life = 1 - (now - p1.t) / CONFIG.lifetime;      // 1 = fresh, 0 = gone
      if (life <= 0) continue;
      var a = life * life;                                  // ease: fades faster at the tail
      ctx.strokeStyle = 'rgba(' + CONFIG.color + ',' + (a * CONFIG.opacity).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.2, CONFIG.maxWidth * life);
      ctx.beginPath();
      if (i >= 2) {
        // smooth the polyline with quadratic curves through segment midpoints
        var pm = points[i - 2];
        ctx.moveTo((pm.x + p0.x) / 2, (pm.y + p0.y) / 2);
        ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      } else {
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      }
      ctx.stroke();
    }
  }
})();
