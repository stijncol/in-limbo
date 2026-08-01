// Local-only tag graph — an Obsidian-style force-directed view of how the
// archive's tags relate. Nodes are tags (theme = filled dot, medium = ring),
// edges mean "these two tags appear on the same video"; the more often they
// co-occur, the stronger the pull and the heavier the line.
// Served only by scripts/preview-server.js; production never links this.
(function () {
  'use strict';

  var INK = '#000', ACCENT = '#1e40af', GROUND = '#e2e5e9';

  // Tag pairs are keyed as JSON rather than a joined string: tag names hold
  // spaces and punctuation, so no plain separator is safe to split back on.
  function pairKey(a, b) { return JSON.stringify(a < b ? [a, b] : [b, a]); }

  // ── 1. Read the archive straight out of the rendered grid ───────────────
  // Every card carries its tags as spans; .tag-medium marks the medium ones.
  var themeCount = new Map(), mediumCount = new Map(), pairCount = new Map();
  var tagVideos = new Map(); // tag name -> the films carrying it

  document.querySelectorAll('.card[data-video-id]').forEach(function (card) {
    var tags = [];
    card.querySelectorAll('.tags span[data-tag]').forEach(function (s) {
      var name = (s.getAttribute('data-tag') || '').trim();
      if (!name) return; // trailing commas in the tag fields leave empty entries
      tags.push({ name: name, medium: s.classList.contains('tag-medium') });
    });
    // The blurred thumb is already in the page, so its src is free to reuse
    var thumbImg = card.querySelector('.thumb img.baked-blur');
    var film = {
      title: card.getAttribute('data-title') || '',
      src: thumbImg ? thumbImg.getAttribute('src') : null,
      card: card
    };
    tags.forEach(function (t) {
      var m = t.medium ? mediumCount : themeCount;
      m.set(t.name, (m.get(t.name) || 0) + 1);
      if (!tagVideos.has(t.name)) tagVideos.set(t.name, []);
      tagVideos.get(t.name).push(film);
    });
    for (var i = 0; i < tags.length; i++) {
      for (var j = i + 1; j < tags.length; j++) {
        var a = tags[i].name, b = tags[j].name;
        if (a === b) continue;
        var key = pairKey(a, b);
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  });

  var nodes = [], index = new Map();
  function addNodes(counts, isMedium) {
    counts.forEach(function (count, name) {
      index.set(name, nodes.length);
      nodes.push({ name: name, count: count, medium: isMedium, x: 0, y: 0, vx: 0, vy: 0 });
    });
  }
  addNodes(themeCount, false);
  addNodes(mediumCount, true);

  var allEdges = [];
  pairCount.forEach(function (weight, key) {
    var parts = JSON.parse(key);
    var a = index.get(parts[0]), b = index.get(parts[1]);
    if (a === undefined || b === undefined) return;
    allEdges.push({ a: a, b: b, w: weight });
  });

  if (!nodes.length) return; // nothing to draw

  var maxCount = nodes.reduce(function (m, n) { return Math.max(m, n.count); }, 1);
  var maxWeight = allEdges.reduce(function (m, e) { return Math.max(m, e.w); }, 1);
  nodes.forEach(function (n) { n.r = 4 + 9 * Math.sqrt(n.count / maxCount); });

  // Nearly half of all tag pairs share at least one video, which draws as an
  // unreadable hairball. The threshold keeps only pairs that recur, so real
  // affinities stand out; 1 shows every incidental link.
  var threshold = 2, edges = [], neighbours = [];

  function applyThreshold(t) {
    threshold = t;
    edges = allEdges.filter(function (e) { return e.w >= t; });
    neighbours = nodes.map(function () { return new Set(); });
    edges.forEach(function (e) { neighbours[e.a].add(e.b); neighbours[e.b].add(e.a); });
  }
  applyThreshold(threshold);

  // ── 2. Chrome: launch button + overlay ──────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    '#graph-btn{position:fixed;top:calc(var(--rail-h) * 0.055 - 9px);right:calc(var(--rail-x) + var(--margin));',
      'width:33px;height:33px;border-radius:50%;border:1px solid #000;background:transparent;color:#000;',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:20;',
      'transition:color .15s ease,border-color .15s ease}',
    '#graph-btn:hover{color:' + ACCENT + ';border-color:' + ACCENT + '}',
    '#graph-btn svg{display:block}',
    // Sits over the archive rather than replacing it: the grid stays faintly
    // visible, blurred back under an almost-opaque grey veil. Stays in the
    // layout (hidden, not display:none) so veil and blur can be transitioned;
    // visibility is delayed on the way out so the fade can finish first.
    '#graph-view{position:fixed;inset:0;z-index:1200;background:rgba(226,229,233,0.9);',
      '-webkit-backdrop-filter:blur(0px);backdrop-filter:blur(0px);display:flex;flex-direction:column;',
      'opacity:0;visibility:hidden;pointer-events:none;',
      'transition:opacity .45s ease,backdrop-filter .45s ease,-webkit-backdrop-filter .45s ease,',
      'visibility 0s linear .45s}',
    '#graph-view.open{opacity:1;visibility:visible;pointer-events:auto;',
      '-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);',
      'transition:opacity .45s ease,backdrop-filter .45s ease,-webkit-backdrop-filter .45s ease,visibility 0s}',
    '#graph-head{display:flex;align-items:baseline;gap:18px;padding:22px 28px 14px;',
      'font-family:"IBM Plex Sans",Helvetica,Arial,sans-serif;font-weight:300;font-size:13px;color:#111}',
    '#graph-head b{font-weight:700;font-size:16px;font-family:"Neue Haas Unica",sans-serif}',
    '#graph-head .legend{display:flex;gap:14px;color:#666;align-items:center}',
    '#graph-head .legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px}',
    '#graph-head .legend .theme i{background:#000}',
    '#graph-head .legend .medium i{border:0.5px solid #000}',
    '#graph-head .thresh{color:#666;display:flex;align-items:baseline;gap:7px}',
    '#graph-head .thresh button{border:none;background:none;padding:0;cursor:pointer;font:inherit;color:#888;',
      'transition:color .15s ease}',
    '#graph-head .thresh button:hover{color:#111}',
    '#graph-head .thresh button.on{color:' + ACCENT + ';font-weight:500}',
    '#graph-head .hint{margin-left:auto;color:#888}',
    '#graph-close{border:none;background:none;padding:0;cursor:pointer;color:#666;font:inherit;',
      'letter-spacing:.05em;transition:color .2s}',
    '#graph-close:hover{color:' + ACCENT + '}',
    '#graph-canvas{flex:1;width:100%;display:block;cursor:grab}',
    '#graph-canvas.dragging{cursor:grabbing}',
    '@media (max-width:900px){#graph-btn{top:auto;bottom:18px;right:18px}#graph-head{padding:16px 18px 10px;gap:12px;flex-wrap:wrap}#graph-head .hint{display:none}}'
  ].join('');
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.id = 'graph-btn';
  btn.setAttribute('aria-label', 'tag graph');
  // Three points — the graph reduced to its nodes, in the same dot vocabulary
  // as the favicon, the margin pattern and the rail's density matrix
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">' +
    '<circle cx="12" cy="6.5" r="2"/><circle cx="6.5" cy="16.5" r="2"/><circle cx="17.5" cy="16.5" r="2"/></svg>';
  document.body.appendChild(btn);

  var view = document.createElement('div');
  view.id = 'graph-view';
  view.innerHTML =
    '<div id="graph-head">' +
      '<b>tag graph</b>' +
      '<span class="legend"><span class="theme"><i></i>theme</span><span class="medium"><i></i>medium</span></span>' +
      '<span class="thresh">shared videos: ' +
        '<button data-t="1">1</button><button data-t="2">2</button><button data-t="3">3</button>' +
      '</span>' +
      '<span class="hint">drag to rearrange &middot; click a tag to filter the archive</span>' +
      '<button id="graph-close">close &#10005;</button>' +
    '</div>' +
    '<canvas id="graph-canvas"></canvas>';
  document.body.appendChild(view);

  var canvas = view.querySelector('#graph-canvas');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, raf = null;

  // ── Films on hover ──────────────────────────────────────────────────────
  // Two columns of stills beside the hovered tag. Images come from the page's
  // own thumbs, so nothing extra is fetched for stills already on screen.
  var HOVER_DELAY = 150, HOVER_FADE = 200; // ms — settle before the stills appear
  var imgCache = new Map();
  function filmImage(src) {
    if (!src) return null;
    if (!imgCache.has(src)) { var im = new Image(); im.src = src; imgCache.set(src, im); }
    var img = imgCache.get(src);
    return (img.complete && img.naturalWidth) ? img : null;
  }
  // Rects of the stills as last drawn, for hit-testing and sticky hover
  var filmRects = [];

  function drawFilm(f, x, y, w, h, alpha, lit) {
    var img = filmImage(f.src);
    ctx.globalAlpha = alpha;
    if (img) ctx.drawImage(img, x, y, w, h);
    else { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); }
    ctx.strokeStyle = lit ? ACCENT : 'rgba(0,0,0,0.55)';
    ctx.lineWidth = lit ? 1 : 0.5;
    ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
    ctx.globalAlpha = 1;
  }


  // ── 3. Force layout ─────────────────────────────────────────────────────
  var REPULSION = 14000, SPRING = 0.0016, IDEAL = 170, GRAVITY = 0.009, DAMP = 0.82;
  // Repulsion and springs never quite balance, so without cooling the nodes
  // drift for ever. Heat decays until motion stops; dragging or a fresh layout
  // warms it back up. Decay is by elapsed time, not by frame: thumbnail
  // dithering can starve the animation loop, and a per-frame decay would then
  // leave the graph drifting for many seconds.
  var heat = 1, HEAT_MIN = 0.012, TAU = 560, lastT = 0;
  function reheat(v) { heat = Math.max(heat, v); }

  function seed() {
    // Themes on an inner ring, mediums on an outer one — a sane starting point
    // so the simulation settles quickly instead of exploding out of a clump.
    var t = 0, m = 0;
    var nt = nodes.filter(function (n) { return !n.medium; }).length || 1;
    var nm = nodes.length - nt || 1;
    nodes.forEach(function (n) {
      var a, rad;
      if (n.medium) { a = (m++ / nm) * Math.PI * 2; rad = Math.min(W, H) * 0.34; }
      else { a = (t++ / nt) * Math.PI * 2; rad = Math.min(W, H) * 0.15; }
      n.x = W / 2 + Math.cos(a) * rad;
      n.y = H / 2 + Math.sin(a) * rad;
      n.vx = n.vy = 0;
    });
    heat = 1; lastT = 0;
  }

  function step() {
    var now = performance.now();
    var dt = lastT ? Math.min(120, now - lastT) : 16;
    lastT = now;
    // Settled and nothing being dragged — hold still and just keep drawing
    if (heat <= HEAT_MIN && !dragged) return;
    heat = dragged ? Math.max(heat, 0.35)
                   : Math.max(HEAT_MIN, heat * Math.exp(-dt / TAU));

    var i, j, a, b, dx, dy, d2, d, f;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j];
        dx = b.x - a.x; dy = b.y - a.y;
        d2 = dx * dx + dy * dy || 0.01;
        d = Math.sqrt(d2);
        f = REPULSION / d2;
        dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f;
        b.vx += dx * f; b.vy += dy * f;
      }
    }
    edges.forEach(function (e) {
      var a = nodes[e.a], b = nodes[e.b];
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      // Heavier co-occurrence pulls harder, so related tags cluster
      var f = (d - IDEAL) * SPRING * (0.5 + e.w / maxWeight);
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    });
    nodes.forEach(function (n) {
      n.vx += (W / 2 - n.x) * GRAVITY;
      n.vy += (H / 2 - n.y) * GRAVITY;
      if (n === dragged) { n.vx = n.vy = 0; return; }
      n.vx *= DAMP; n.vy *= DAMP;
      // Scaled by heat, so movement fades out instead of never ending
      n.x += n.vx * heat; n.y += n.vy * heat;
      var pad = n.r + Math.min(60, W * 0.1);
      n.x = Math.max(pad, Math.min(W - pad, n.x));
      n.y = Math.max(n.r + 14, Math.min(H - n.r - 14, n.y));
    });

    // Gravity keeps the cluster compact but leaves it sitting wherever it
    // happened to settle. Translating it rigidly onto the canvas centre puts
    // it squarely in the middle without disturbing the layout itself.
    if (!dragged) recentre();
  }

  function recentre() {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      if (n.x - n.r < minX) minX = n.x - n.r;
      if (n.x + n.r > maxX) maxX = n.x + n.r;
      if (n.y - n.r < minY) minY = n.y - n.r;
      if (n.y + n.r > maxY) maxY = n.y + n.r;
    });
    // Centre on the middle of the window, not of the canvas: the canvas starts
    // below the header, so canvas-centring leaves the cluster sitting low. How
    // far down the canvas begins varies by browser, so read it rather than
    // assume a header height.
    var rect = canvas.getBoundingClientRect();
    var targetX = Math.min(Math.max(window.innerWidth / 2 - rect.left, W * 0.25), W * 0.75);
    var targetY = Math.min(Math.max(window.innerHeight / 2 - rect.top, H * 0.25), H * 0.75);
    var dx = targetX - (minX + maxX) / 2;
    var dy = targetY - (minY + maxY) / 2;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
    nodes.forEach(function (n) { n.x += dx; n.y += dy; });
  }

  // ── 4. Render ───────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var lit = hovered !== null ? neighbours[hovered] : null;

    // At rest every link is a light dotted line, so the field reads as texture
    // rather than structure; selecting a tag draws its own links solid and blue.
    edges.forEach(function (e) {
      var active = hovered !== null && (e.a === hovered || e.b === hovered);
      var a = nodes[e.a], b = nodes[e.b];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      if (active) {
        ctx.setLineDash([]);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 0.35 + 1.05 * (e.w / maxWeight);
      } else {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = hovered === null ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 0.4 + 1.5 * (e.w / maxWeight);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]); // nodes and their rings stay solid

    nodes.forEach(function (n, i) {
      var on = hovered === null || i === hovered || lit.has(i);
      ctx.globalAlpha = on ? 1 : 0.18;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (n.medium) {
        ctx.fillStyle = GROUND; ctx.fill();
        ctx.strokeStyle = i === hovered ? ACCENT : INK; ctx.lineWidth = 1; ctx.stroke();
      } else {
        ctx.fillStyle = i === hovered ? ACCENT : INK; ctx.fill();
      }
      ctx.font = (i === hovered ? '500 ' : '300 ') + '12px "IBM Plex Sans",Helvetica,Arial,sans-serif';
      ctx.textBaseline = 'middle';
      // Flip the label to the left half-way across, so long tag names on the
      // right never run off the canvas (matters most on narrow screens)
      var flip = n.x > W * 0.58;
      ctx.textAlign = flip ? 'right' : 'left';
      var lx = n.x + (flip ? -(n.r + 5) : n.r + 5);
      // Links radiate straight through the labels, so lay a halo in the ground
      // colour behind the text — it keeps the name legible on top of them
      ctx.strokeStyle = GROUND;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeText(n.name, lx, n.y);
      ctx.fillStyle = i === hovered ? ACCENT : '#111';
      ctx.fillText(n.name, lx, n.y);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    });

    drawFilms();
  }

  // The stills for the hovered tag, in two columns beside it.
  // Positions are recorded in filmRects so the pointer can pick them up.
  function drawFilms() {
    filmRects = [];
    if (hovered === null) return;
    var films = tagVideos.get(nodes[hovered].name) || [];
    if (!films.length) return;

    var reveal = Math.max(0, Math.min(1, (performance.now() - hoverAt - HOVER_DELAY) / HOVER_FADE));
    if (reveal <= 0) return;

    var node = nodes[hovered];
    ctx.textBaseline = 'middle';

    {
      var m = films.length;
      var COLS = 2, gap = 10, marginX = 32, marginV = 40, GAP = 22;
      var rows = Math.ceil(m / COLS);

      // Keep clear of the tag's own label, which sits on one side of the node
      ctx.font = '500 12px "IBM Plex Sans",Helvetica,Arial,sans-serif';
      var labelFlip = node.x > W * 0.58;
      var labelW = ctx.measureText(node.name).width;
      function spaceOn(s) {
        return s > 0
          ? W - (node.x + node.r + GAP + (labelFlip ? 0 : labelW + 10)) - marginX
          : (node.x - node.r - GAP - (labelFlip ? labelW + 10 : 0)) - marginX;
      }
      // The graph clusters mid-canvas, so a tag's own half is the open one:
      // tags on the left open leftwards, tags on the right open rightwards.
      var side = node.x < W / 2 ? -1 : 1;
      var avail = spaceOn(side);
      var MIN = COLS * 60 + gap;
      // Near the very edge there may be no room — fall back to the other side
      if (avail < MIN && spaceOn(-side) > avail) { side = -side; avail = spaceOn(side); }
      avail = Math.max(90, avail);

      // Stills only — no heading, no captions; rows are spaced by the same
      // gap as the columns
      var tw2 = Math.min(104, Math.floor((avail - gap) / COLS));
      var th2 = Math.round(tw2 * 9 / 16);
      var cell = th2 + gap;
      // Shrink the cells rather than overflow when a tag carries many films
      if (rows * cell - gap > H - marginV * 2) {
        var maxCell = (H - marginV * 2 + gap) / rows;
        th2 = Math.max(20, Math.floor(maxCell - gap));
        tw2 = Math.round(th2 * 16 / 9);
        if (COLS * tw2 + gap > avail) {
          tw2 = Math.floor((avail - gap) / COLS);
          th2 = Math.round(tw2 * 9 / 16);
        }
        cell = th2 + gap;
      }

      var blockW = COLS * tw2 + gap;
      var blockH = rows * cell - gap;
      var offset = node.r + GAP + ((side > 0) === !labelFlip ? labelW + 10 : 0);
      var x0 = side > 0 ? node.x + offset : node.x - offset - blockW;
      x0 = Math.max(marginX, Math.min(W - marginX - blockW, x0));
      var y0 = Math.max(marginV, Math.min(H - marginV - blockH, Math.round(node.y - blockH / 2)));

      films.forEach(function (f, i) {
        var col = i % COLS, row = Math.floor(i / COLS);
        var x = x0 + col * (tw2 + gap);
        var y = y0 + row * cell;
        var lit2 = hoveredFilm === i;
        drawFilm(f, x, y, tw2, th2, reveal, lit2);
        filmRects.push({ i: i, f: f, x: x, y: y, w: tw2, h: th2 });
      });
    }
  }

  function frame() { step(); draw(); raf = requestAnimationFrame(frame); }

  // Returns true when the canvas actually changed size, so callers can leave
  // the layout alone otherwise (resizing clears the canvas).
  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === W && h === H && canvas.width === Math.round(w * dpr)) return false;
    W = w; H = h;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  // ── 5. Interaction ──────────────────────────────────────────────────────
  var hovered = null, dragged = null, downAt = null, moved = false;
  var hoverAt = 0, hoveredFilm = null;

  function setHover(i) {
    if (i === hovered) return;
    hovered = i;
    hoveredFilm = null;
    hoverAt = performance.now(); // restart the reveal delay
  }
  function pickFilm(p) {
    for (var i = 0; i < filmRects.length; i++) {
      var r = filmRects[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
    }
    return null;
  }

  function at(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function pick(p) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], dx = p.x - n.x, dy = p.y - n.y;
      if (dx * dx + dy * dy < (n.r + 7) * (n.r + 7)) return i;
    }
    return null;
  }

  canvas.addEventListener('mousemove', function (ev) {
    var p = at(ev);
    if (dragged) { dragged.x = p.x; dragged.y = p.y; moved = true; return; }
    var over = pick(p);
    if (over !== null) { setHover(over); hoveredFilm = null; return; }
    // Reaching for one of the stills must not drop the hover that produced them
    var fi = pickFilm(p);
    if (fi !== null) { hoveredFilm = fi; return; }
    setHover(null);
  });
  canvas.addEventListener('mousedown', function (ev) {
    var p = at(ev);
    if (pickFilm(p) !== null) return; // handled on mouseup, never a drag
    var i = pick(p);
    if (i === null) return;
    dragged = nodes[i]; downAt = i; moved = false;
    reheat(0.5); // let the neighbours give way again
    canvas.classList.add('dragging');
  });
  window.addEventListener('mouseup', function (ev) {
    // A still under the cursor opens that film rather than filtering the tag
    if (!dragged && view.classList.contains('open')) {
      var fi = pickFilm(at(ev));
      if (fi !== null && filmRects[fi]) { openFilm(filmRects[fi].f); return; }
    }
    if (dragged && !moved && downAt !== null) filterBy(nodes[downAt].name);
    dragged = null; downAt = null;
    canvas.classList.remove('dragging');
  });
  canvas.addEventListener('mouseleave', function () { setHover(null); });

  // The lightbox sits below this overlay, so the graph steps aside first
  function openFilm(film) {
    close();
    var thumb = film.card && film.card.querySelector('.thumb');
    if (thumb) setTimeout(function () { thumb.click(); }, 60);
  }

  // Clicking a tag runs the site's own filter, then drops back to the archive
  function filterBy(tag) {
    var target = document.querySelector('.filters button[data-filter="' + tag.replace(/"/g, '\\"') + '"]');
    if (target) target.click();
    close();
  }

  var FADE = 450, stopTimer = null;

  function open() {
    clearTimeout(stopTimer);
    view.classList.add('open');
    document.body.style.overflow = 'hidden';
    resize(); seed();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function close() {
    view.classList.remove('open');
    document.body.style.overflow = '';
    hovered = dragged = null;
    hoveredFilm = null;
    filmRects = [];
    // Keep the simulation running until the fade-out is over, otherwise the
    // graph freezes mid-dissolve
    clearTimeout(stopTimer);
    stopTimer = setTimeout(function () {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }, FADE);
  }

  var threshBtns = view.querySelectorAll('.thresh button');
  function markThresh() {
    threshBtns.forEach(function (b) { b.classList.toggle('on', +b.dataset.t === threshold); });
  }
  threshBtns.forEach(function (b) {
    b.addEventListener('click', function () { applyThreshold(+b.dataset.t); markThresh(); reheat(0.6); });
  });
  markThresh();

  btn.addEventListener('click', open);
  // The intro text names the graph and links to it, so the three dots in the
  // corner aren't the only way in
  document.querySelectorAll('a.graph-link').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); open(); });
  });
  view.querySelector('#graph-close').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && view.classList.contains('open')) close();
  });
  window.addEventListener('resize', function () { if (view.classList.contains('open')) resize(); });
  // A window resize event misses everything else that can move the canvas —
  // a scrollbar appearing, page zoom, a mobile URL bar collapsing. Watching the
  // element itself keeps W/H honest in any browser.
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      if (!view.classList.contains('open')) return;
      if (resize()) reheat(0.4); // let the layout adapt to the new box
    }).observe(canvas);
  }
})();
