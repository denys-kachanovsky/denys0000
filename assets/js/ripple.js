/* Water-ripple hover effect for pictures.
   Moving the mouse over a picture leaves soft ripples behind it: the picture is refracted
   like the surface of water and settles back by itself.

   How it works (small, dependency-free WebGL2):
   1. Moving the mouse over a picture drops "drops" along its path. Every drop sends out a ring wave
      (a short packet of a sine wave) that spreads and fades. The waves of all drops are added up
      into a screen-sized displacement map (a pushing direction + strength for every pixel).
   2. One shared transparent canvas (fixed, pointer-events: none) redraws ONLY the picture that is
      being hovered on top of the original one, shifting every pixel according to the map, like
      looking through water. The overlay shows the same picture, so at rest it is invisible and it
      simply fades away.
   - Mouse / pen only. Disabled on touch screens, with prefers-reduced-motion and without WebGL2.
   - Tune the look with CONFIG (live: window.__ripple.config in the console). */
(function () {
  'use strict';

  var CONFIG = {
    selector: 'img.image, img.image-13, img.image-half, img.image-9, img.cover-img',
    strength: 12,        // px, how far the picture is pushed at the crest of a wave
    wavelength: 34,      // px between two wave crests
    packetWidth: 40,     // px, how many rings a drop sends out (bigger = more rings)
    spread: 250,         // px, how far a ring travels in the end
    spreadTime: 0.6,     // s, travel speed (smaller = faster)
    decay: 2.3,          // 1/s, how fast the waves fade (bigger = shorter)
    amplitude: 0.3,      // strength of one drop (many drops add up)
    spawnDistance: 12,   // px of mouse travel between two drops
    maxSprites: 80,
    fadeIn: 0.12,        // s, overlay appears
    fadeOut: 0.35        // s, overlay disappears after the ripples have settled
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduce || !fine) return;

  window.__ripple = { config: CONFIG };

  var DEAD = 0.012;                // a drop is removed when its strength falls below this

  var canvas, gl, ok = false, failed = false;
  var progSprite, progImage, vao, fboTex, fbo, fw = 0, fh = 0;
  var vw = 0, vh = 0, dpr = 1;
  var sprites = [];
  var images = new Map();          // img -> { tex, src, fade, radius, last }
  var hovered = null, raf = 0, lastSpawn = { x: -999, y: -999, t: 0 };
  var strokeAlpha = 0.1;

  // ---- GL helpers --------------------------------------------------------------------------------
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p: p, u: u };
  }

  // A drop: a quad around the drop that grows with its ring. The fragment shader writes the push
  // vector of the ring wave. Signed numbers cannot be added in an 8-bit texture, so the vector is
  // stored as (+x, -x, +y, -y) and rebuilt in the picture shader.
  var SPRITE_VS = '#version 300 es\n' +
    'in vec2 aPos; uniform vec2 uCenter, uView; uniform float uQuad; out vec2 vLocal;\n' +
    'void main(){ vLocal = (aPos - .5) * uQuad; vec2 p = vLocal + uCenter;\n' +
    '  gl_Position = vec4(p.x/uView.x*2.-1., 1.-p.y/uView.y*2., 0., 1.); }';
  var SPRITE_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform float uR, uW, uL, uAmp; in vec2 vLocal; out vec4 o;\n' +
    'void main(){\n' +
    '  float dist = length(vLocal);\n' +
    '  vec2 dir = dist > .001 ? vLocal / dist : vec2(0.);\n' +
    '  float x = dist - uR;\n' +                                              // distance from the ring
    '  float v = uAmp * exp(-(x*x) / (uW*uW)) * cos(6.2831853 * x / uL);\n' +  // wave packet
    '  v *= smoothstep(0., uL * .5, dist);\n' +                               // no sharp spike in the middle
    '  vec2 p = dir * v;\n' +
    '  o = vec4(max(p.x, 0.), max(-p.x, 0.), max(p.y, 0.), max(-p.y, 0.));\n' +
    '}';

  var IMAGE_VS = '#version 300 es\n' +
    'in vec2 aPos; uniform vec4 uRect; uniform vec2 uView;\n' +
    'void main(){ vec2 p = (uRect.xy - 1.) + aPos * (uRect.zw + 2.);\n' +
    '  gl_Position = vec4(p.x/uView.x*2.-1., 1.-p.y/uView.y*2., 0., 1.); }';
  var IMAGE_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uTex, uDisp; uniform vec4 uRect; uniform vec2 uViewPx;\n' +
    'uniform float uDpr, uZoom, uStrength, uRadius, uStroke, uFade; out vec4 o;\n' +
    'float sdRoundRect(vec2 p, vec2 h, float r){ vec2 q = abs(p) - h + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }\n' +
    'void main(){\n' +
    '  vec2 css = vec2(gl_FragCoord.x, uViewPx.y - gl_FragCoord.y) / uDpr;\n' +
    '  vec2 size = uRect.zw;\n' +
    '  vec2 uv = (css - uRect.xy) / size;\n' +
    '  float d = sdRoundRect(css - (uRect.xy + size*.5), size*.5, uRadius);\n' +
    '  float a = 1. - smoothstep(-.5, .5, d);\n' +
    '  uv = (uv - .5) / uZoom + .5;\n' +                                    // hover zoom of the card
    '  vec4 w = texture(uDisp, gl_FragCoord.xy / uViewPx);\n' +             // wave push under this pixel
    '  vec2 push = vec2(w.r - w.g, w.b - w.a);\n' +
    '  vec2 off = push * uStrength / size;\n' +                             // px -> picture coordinates
    '  vec4 c = texture(uTex, clamp(uv + off, 0., 1.));\n' +
    '  float ring = 1. - smoothstep(.5, 1.5, -d);\n' +                      // the 1px inside stroke
    '  vec3 rgb = mix(c.rgb, vec3(1.), ring * uStroke);\n' +
    '  float al = a * uFade * c.a;\n' +
    '  o = vec4(rgb * al, al);\n' +
    '}';

  function setup() {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9990;display:none;';
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl2');
    document.body.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); disable(); });

    progSprite = program(SPRITE_VS, SPRITE_FS);
    progImage = program(IMAGE_VS, IMAGE_FS);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    fboTex = gl.createTexture();
    fbo = gl.createFramebuffer();

    var cs = getComputedStyle(document.documentElement).getPropertyValue('--media-stroke');
    var m = cs && cs.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)$/);
    strokeAlpha = m ? parseFloat(m[1]) : 0.1;
    ok = true;
  }

  function disable() {
    failed = true; ok = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0; images.clear(); sprites.length = 0;
    if (canvas) canvas.style.display = 'none';
  }

  function resize() {
    var w = window.innerWidth, h = window.innerHeight, d = Math.min(window.devicePixelRatio || 1, 2);
    if (w === vw && h === vh && d === dpr) return;
    vw = w; vh = h; dpr = d;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    // displacement map at half resolution (it only holds soft shapes)
    fw = Math.max(2, Math.ceil(w / 2)); fh = Math.max(2, Math.ceil(h / 2));
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- pictures ------------------------------------------------------------------------------------
  function geometry(img) {
    var cover = img.classList.contains('cover-img');
    var box = cover ? img.parentElement : img;        // the card clips the picture (and its hover zoom)
    var r = box.getBoundingClientRect(), zoom = 1;
    if (cover) {
      var t = getComputedStyle(img).transform, m = t && t !== 'none' && t.match(/matrix\(\s*([-\d.e]+)/);
      if (m) zoom = parseFloat(m[1]) || 1;
    }
    // the browser paints pictures on whole device pixels; do the same so that the overlay lines up exactly
    var l = Math.round(r.left * dpr) / dpr, t = Math.round(r.top * dpr) / dpr;
    var rt = Math.round(r.right * dpr) / dpr, bt = Math.round(r.bottom * dpr) / dpr;
    return { x: l, y: t, w: rt - l, h: bt - t, zoom: zoom, box: box };
  }

  function entryFor(img) {
    var e = images.get(img);
    var src = img.currentSrc || img.src;
    if (e && e.src === src) { e.last = performance.now(); return e; }
    if (!img.complete || !img.naturalWidth) return null;
    if (e) gl.deleteTexture(e.tex);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (err) { gl.deleteTexture(tex); return null; }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    e = { tex: tex, src: src, fade: 0, active: false, last: performance.now(), radius: 0 };
    images.set(img, e);
    // keep at most 6 textures in memory
    if (images.size > 6) {
      images.forEach(function (v, k) {
        if (images.size > 6 && k !== img && v.fade === 0) { gl.deleteTexture(v.tex); images.delete(k); }
      });
    }
    return e;
  }

  // ---- input ---------------------------------------------------------------------------------------
  function spawn(x, y, now) {
    if (sprites.length >= CONFIG.maxSprites) sprites.shift();
    sprites.push({ x: x, y: y, t0: now });
    lastSpawn.x = x; lastSpawn.y = y; lastSpawn.t = now;
  }

  function onMove(e) {
    if (failed || e.pointerType === 'touch') return;
    var el = e.target && e.target.closest ? e.target.closest(CONFIG.selector) : null;
    if (el && el.closest('[data-reveal]:not(.is-done)')) el = null;   // still fading in on scroll
    if (!el) { hovered = null; start(); return; }
    if (!ok) {
      try { setup(); } catch (err) { disable(); return; }
    }
    var ent = entryFor(el);
    if (!ent) { hovered = null; return; }
    if (!ent.radius) {
      var cs = getComputedStyle(geometry(el).box);
      ent.radius = parseFloat(cs.borderTopLeftRadius) || 0;
    }
    hovered = el;
    var now = performance.now() / 1000;
    if (Math.hypot(e.clientX - lastSpawn.x, e.clientY - lastSpawn.y) >= CONFIG.spawnDistance || now - lastSpawn.t > 0.06) {
      spawn(e.clientX, e.clientY, now);
    }
    start();
  }
  document.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('mouseleave', function () { hovered = null; start(); });
  window.addEventListener('blur', function () { hovered = null; });
  // keep the overlay glued to the picture while the page scrolls or is resized
  window.addEventListener('scroll', function () { start(); }, { passive: true });
  window.addEventListener('resize', function () { start(); });

  // ---- render loop ---------------------------------------------------------------------------------
  function start() { if (ok && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

  var last = 0;
  function frame(ts) {
    raf = 0;
    if (!ok) return;
    var now = ts / 1000, dt = last ? Math.min(0.1, now - last) : 0.016;
    last = now;
    resize();

    // 1. drops -> displacement map. Everything is a function of the age of the drop.
    var alive = [];
    for (var i = 0; i < sprites.length; i++) {
      var s = sprites[i], age = now - s.t0;
      s.amp = CONFIG.amplitude * Math.exp(-CONFIG.decay * age);               // the wave dies out
      if (s.amp < DEAD) continue;
      s.ring = CONFIG.spread * (1 - Math.exp(-age / CONFIG.spreadTime));      // radius of the ring, slows down
      s.quad = 2 * (s.ring + 2.4 * CONFIG.packetWidth);                       // area the wave covers
      alive.push(s);
    }
    sprites = alive;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fw, fh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (sprites.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);                       // add the ripples up
      gl.useProgram(progSprite.p);
      gl.bindVertexArray(vao);
      gl.uniform2f(progSprite.u.uView, vw, vh);
      gl.uniform1f(progSprite.u.uW, CONFIG.packetWidth);
      gl.uniform1f(progSprite.u.uL, CONFIG.wavelength);
      for (var k = 0; k < sprites.length; k++) {
        var q = sprites[k];
        gl.uniform2f(progSprite.u.uCenter, q.x, q.y);
        gl.uniform1f(progSprite.u.uQuad, q.quad);
        gl.uniform1f(progSprite.u.uR, q.ring);
        gl.uniform1f(progSprite.u.uAmp, q.amp);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    // 2. redraw the pictures that are (or were just) hovered
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    var busy = sprites.length > 0, anyVisible = false;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);          // premultiplied alpha
    gl.useProgram(progImage.p);
    gl.bindVertexArray(vao);
    gl.uniform2f(progImage.u.uView, vw, vh);
    gl.uniform2f(progImage.u.uViewPx, canvas.width, canvas.height);
    gl.uniform1f(progImage.u.uDpr, dpr);
    gl.uniform1f(progImage.u.uStrength, CONFIG.strength);
    gl.uniform1f(progImage.u.uStroke, strokeAlpha);
    gl.uniform1i(progImage.u.uTex, 0);
    gl.uniform1i(progImage.u.uDisp, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.activeTexture(gl.TEXTURE0);

    images.forEach(function (ent, img) {
      // a picture takes part while it is hovered and until its ripples have died out
      if (img === hovered) ent.active = true;
      else if (!sprites.length) ent.active = false;
      var want = ent.active ? 1 : 0;
      var rate = want ? 1 / CONFIG.fadeIn : -1 / CONFIG.fadeOut;
      ent.fade = Math.max(0, Math.min(1, ent.fade + rate * dt));
      if (ent.fade <= 0) return;
      anyVisible = true;
      if (ent.fade < 1 || !want) busy = true;            // fading in / out
      var g = geometry(img);
      var sig = g.x + '|' + g.y + '|' + g.w + '|' + g.h + '|' + g.zoom;
      if (sig !== ent.sig) busy = true;                  // scrolling, resizing or the card's hover zoom
      ent.sig = sig;
      if (g.w < 2 || g.h < 2 || g.y > vh || g.y + g.h < 0 || g.x > vw || g.x + g.w < 0) return;
      gl.bindTexture(gl.TEXTURE_2D, ent.tex);
      gl.uniform4f(progImage.u.uRect, g.x, g.y, g.w, g.h);
      gl.uniform1f(progImage.u.uZoom, g.zoom);
      gl.uniform1f(progImage.u.uRadius, ent.radius);
      gl.uniform1f(progImage.u.uFade, ent.fade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    canvas.style.display = anyVisible ? 'block' : 'none';
    if (busy) raf = requestAnimationFrame(frame);
  }
})();
