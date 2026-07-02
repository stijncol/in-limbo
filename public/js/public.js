  // Thumbnails + dithering (m1: mono-blue palette via Floyd-Steinberg in Lab space).
  // Unbaked thumbs only — baked thumbs skip this path and stream the pre-rendered PNG.
  const M1_WIDTH = 800;

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function rgbToLab(r, g, b) {
    function toLinear(v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
    const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
    const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    const fx = f(x / 0.95047), fy = f(y), fz = f(z / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labDist(lab1, lab2) {
    const dL = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function buildMonoPalette() {
    const H = 210, S = 0.333;
    const shades = [];
    for (let i = 0; i < 8; i++) {
      let l = 85 - i * (65 / 7);
      const s = S * (1 - 0.55 * 0.7);
      l = Math.min(95, l + (85 - l) * 0.55 * 0.6);
      l = Math.min(95, l + 12);
      shades.push(hslToRgb(H, s, l / 100));
    }
    const all = [...shades, [248, 245, 238], [120, 120, 120]];
    all.sort((a, b) => (b[0] * 0.299 + b[1] * 0.587 + b[2] * 0.114) - (a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114));
    return all;
  }

  const M1_PALETTE = buildMonoPalette();
  const M1_PALETTE_LAB = M1_PALETTE.map(c => rgbToLab(c[0], c[1], c[2]));

  function ditherImage(img, thumb) {
    const canvas = document.createElement('canvas');
    const w = M1_WIDTH;
    const h = Math.round(w * (9/16));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (imgRatio > canvasRatio) {
      sw = img.naturalHeight * canvasRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / canvasRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

    // Preprocess: shadow lift, brightness, gamma, contrast
    const raw = ctx.getImageData(0, 0, w, h);
    const pd = raw.data;
    for (let i = 0; i < pd.length; i += 4) {
      let pr = pd[i], pg = pd[i+1], pb = pd[i+2];
      pr = 60 + pr * 195 / 255; pg = 60 + pg * 195 / 255; pb = 60 + pb * 195 / 255;
      pr += 40; pg += 40; pb += 40;
      pr = 255 * Math.pow(Math.max(0, Math.min(255, pr)) / 255, 1 / 1.4);
      pg = 255 * Math.pow(Math.max(0, Math.min(255, pg)) / 255, 1 / 1.4);
      pb = 255 * Math.pow(Math.max(0, Math.min(255, pb)) / 255, 1 / 1.4);
      pr = ((pr / 255 - 0.5) * 0.8 + 0.5) * 255;
      pg = ((pg / 255 - 0.5) * 0.8 + 0.5) * 255;
      pb = ((pb / 255 - 0.5) * 0.8 + 0.5) * 255;
      pd[i]   = Math.max(0, Math.min(255, pr));
      pd[i+1] = Math.max(0, Math.min(255, pg));
      pd[i+2] = Math.max(0, Math.min(255, pb));
    }

    const preProc = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      preProc[i*3]   = pd[i*4];
      preProc[i*3+1] = pd[i*4+1];
      preProc[i*3+2] = pd[i*4+2];
    }

    // Floyd-Steinberg in Lab space against M1_PALETTE.
    // shimmer=true adds per-pixel noise for the hover loop.
    function render(shimmer) {
      const rd = new Float32Array(preProc);
      if (shimmer) {
        for (let i = 0; i < w * h; i++) {
          const n = (Math.random() - 0.5) * 20;
          rd[i*3] += n; rd[i*3+1] += n; rd[i*3+2] += n;
        }
      }
      const outImg = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const qr = Math.max(0, Math.min(255, rd[idx*3]));
          const qg = Math.max(0, Math.min(255, rd[idx*3+1]));
          const qb = Math.max(0, Math.min(255, rd[idx*3+2]));
          const pxLab = rgbToLab(qr, qg, qb);
          let bestIdx = 0, bestDist = Infinity;
          for (let p = 0; p < M1_PALETTE_LAB.length; p++) {
            const d = labDist(pxLab, M1_PALETTE_LAB[p]);
            if (d < bestDist) { bestDist = d; bestIdx = p; }
          }
          const [nr, ng, nb] = M1_PALETTE[bestIdx];
          const er = qr - nr, eg = qg - ng, eb = qb - nb;
          if (x + 1 < w) {
            rd[(idx+1)*3] += er*7/16; rd[(idx+1)*3+1] += eg*7/16; rd[(idx+1)*3+2] += eb*7/16;
          }
          if (y + 1 < h && x > 0) {
            rd[(idx+w-1)*3] += er*3/16; rd[(idx+w-1)*3+1] += eg*3/16; rd[(idx+w-1)*3+2] += eb*3/16;
          }
          if (y + 1 < h) {
            rd[(idx+w)*3] += er*5/16; rd[(idx+w)*3+1] += eg*5/16; rd[(idx+w)*3+2] += eb*5/16;
          }
          if (y + 1 < h && x + 1 < w) {
            rd[(idx+w+1)*3] += er*1/16; rd[(idx+w+1)*3+1] += eg*1/16; rd[(idx+w+1)*3+2] += eb*1/16;
          }
          outImg.data[idx*4]   = nr;
          outImg.data[idx*4+1] = ng;
          outImg.data[idx*4+2] = nb;
          outImg.data[idx*4+3] = 255;
        }
      }
      ctx.putImageData(outImg, 0, 0);
    }

    render(false);
    canvas.style.imageRendering = 'pixelated';
    thumb.appendChild(canvas);

    let shimmerActive = false;
    let shimmerFrame = null;
    function shimmerLoop() {
      if (!shimmerActive) return;
      render(true);
      setTimeout(() => { shimmerFrame = requestAnimationFrame(shimmerLoop); }, 120);
    }
    thumb.addEventListener('mouseenter', () => { shimmerActive = true; shimmerLoop(); });
    thumb.addEventListener('mouseleave', () => {
      shimmerActive = false;
      if (shimmerFrame) cancelAnimationFrame(shimmerFrame);
      render(false);
    });
  }

  // Hover handler for baked thumbnails.
  // Pixel dissolve (D): yellow version materialises pixel-by-pixel, then dissolves
  // back out, looping as long as the cursor is over the thumbnail.
  // On mouseleave the canvas fades out over 1s (nasuizen).
  function setupBakedHover(thumb) {
    const sharp = thumb.querySelector('.baked-sharp');
    if (!sharp) return;
    let canvas = null, ctx = null, yellowData = null, shimmerActive = false;
    let dissolveFrame = null, dissolveIndices = null;
    let dissolveRevealed = 0, dissolveTimer = null;

    const DC_YR = 255, DC_YG = 230, DC_YB = 0, DC_OP = 0.08;
    function toLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    const DC_YLUM = 0.2126 * toLin(DC_YR) + 0.7152 * toLin(DC_YG) + 0.0722 * toLin(DC_YB);

    function initCanvas() {
      if (canvas || !sharp.naturalWidth) return false;
      canvas = document.createElement('canvas');
      canvas.width = sharp.naturalWidth;
      canvas.height = sharp.naturalHeight;
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;image-rendering:pixelated';
      thumb.appendChild(canvas);
      ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(sharp, 0, 0, canvas.width, canvas.height);
        const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);
        yellowData = new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
        const yd = yellowData.data;
        for (let i = 0; i < yd.length; i += 4) {
          const pL = 0.2126 * toLin(yd[i]) + 0.7152 * toLin(yd[i+1]) + 0.0722 * toLin(yd[i+2]);
          if (DC_YLUM < pL) {
            yd[i]   = Math.round(yd[i]   + (DC_YR - yd[i])   * DC_OP);
            yd[i+1] = Math.round(yd[i+1] + (DC_YG - yd[i+1]) * DC_OP);
            yd[i+2] = Math.round(yd[i+2] + (DC_YB - yd[i+2]) * DC_OP);
          }
        }
        const n = raw.width * raw.height;
        dissolveIndices = new Uint32Array(n);
        for (let i = 0; i < n; i++) dissolveIndices[i] = i;
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = dissolveIndices[i]; dissolveIndices[i] = dissolveIndices[j]; dissolveIndices[j] = t;
        }
        dissolveFrame = new ImageData(raw.width, raw.height); // starts transparent
        return true;
      } catch(e) { return false; }
    }

    // Dissolve in: pixels appear one-by-one over ~2s, then stay still
    function dissolveTick() {
      if (!shimmerActive || !yellowData) return;
      const n = yellowData.width * yellowData.height;
      const BATCH = Math.ceil(n / 20); // 20 steps × 50ms ≈ 1s total
      const end = Math.min(dissolveRevealed + BATCH, n);
      for (let k = dissolveRevealed; k < end; k++) {
        const px = dissolveIndices[k] * 4;
        dissolveFrame.data[px]   = yellowData.data[px];
        dissolveFrame.data[px+1] = yellowData.data[px+1];
        dissolveFrame.data[px+2] = yellowData.data[px+2];
        dissolveFrame.data[px+3] = 255;
      }
      dissolveRevealed = end;
      ctx.putImageData(dissolveFrame, 0, 0);
      if (dissolveRevealed < n) dissolveTimer = setTimeout(dissolveTick, 50);
      // fully revealed: stays still until mouseleave
    }

    thumb.addEventListener('mouseenter', () => {
      if (sharp._hideTimer) { clearTimeout(sharp._hideTimer); sharp._hideTimer = null; }
      sharp.style.visibility = 'visible';
      sharp.style.opacity = '1';
      if (!canvas) initCanvas();
      if (canvas && yellowData) {
        shimmerActive = true;
        dissolveFrame.data.fill(0);
        dissolveRevealed = 0;
        canvas.style.transition = '';
        canvas.style.opacity = '';
        canvas.style.display = 'block';
        dissolveTick();
      }
    });

    thumb.addEventListener('mouseleave', () => {
      shimmerActive = false;
      clearTimeout(dissolveTimer);
      if (canvas) {
        canvas.style.transition = 'opacity 1s ease';
        canvas.style.opacity = '0';
        setTimeout(() => {
          if (!shimmerActive && canvas) {
            canvas.style.display = 'none';
            canvas.style.transition = '';
            canvas.style.opacity = '';
          }
        }, 1050);
      }
      sharp.style.opacity = '0';
      sharp._hideTimer = setTimeout(() => { sharp.style.visibility = 'hidden'; sharp._hideTimer = null; }, 500);
    });
  }

  // After page load, preload all sharp images in background
  function preloadSharpImages() {
    document.querySelectorAll('.baked-sharp[data-sharp]').forEach(img => {
      if (!img.src) img.src = img.dataset.sharp;
    });
  }
  if (document.readyState === 'complete') { preloadSharpImages(); }
  else { window.addEventListener('load', preloadSharpImages); }

  document.querySelectorAll('.card[data-video-id]').forEach(card => {
    const id = card.dataset.videoId;
    const type = card.dataset.videoType;
    const thumb = card.querySelector('.thumb');
    const isBaked = !!(thumb && thumb.dataset.baked === 'true');
    const img = card.querySelector('.baked-blur') || card.querySelector('img');
    img.crossOrigin = 'anonymous';

    if (isBaked) {
      // Baked: fade in blur on load, set up sharp hover
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.5s ease';
      const revealBaked = () => requestAnimationFrame(() => requestAnimationFrame(() => {
        img.style.opacity = '1';
        setupBakedHover(thumb);
      }));
      if (img.complete && img.naturalWidth) {
        revealBaked();
      } else {
        img.addEventListener('load', revealBaked);
      }
    } else {
      img.addEventListener('load', () => {
        try { ditherImage(img, thumb); } catch(e) {}
      });
    }

    if (type === 'youtube') {
      let ytId = id;
      try {
        if (id.includes('youtube.com') || id.includes('youtu.be')) {
          const u = new URL(id);
          ytId = u.searchParams.get('v') || u.pathname.slice(1);
        }
      } catch(e) {}
      if (!isBaked) img.src = 'https://img.youtube.com/vi/' + ytId + '/hqdefault.jpg';
      const ytKey = window.__CONFIG__.ytKey;
      if (ytKey) {
        fetch('https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + ytId + '&key=' + ytKey)
          .then(r => r.json())
          .then(data => {
            const item = data.items && data.items[0];
            if (!item) return;
            const iso = item.contentDetails.duration;
            const dur = card.querySelector('.card-duration');
            if (dur) {
              const parts = [];
              if (iso) {
                const m = iso.match(/PT(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?/);
                if (m) {
                  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), sec = parseInt(m[3] || 0);
                  const totalSec = h * 3600 + min * 60 + sec;
                  if (totalSec > 0) parts.push((h * 60 + min) + ':' + String(sec).padStart(2, '0'));
                }
              }
              if (item.contentDetails.definition) parts.push(item.contentDetails.definition.toUpperCase());
              if (parts.length) dur.textContent = parts.join(' · ');
            }
          })
          .catch(() => {});
      }
    } else {
      // oEmbed: thumbnail + duration fallback (always works, no auth)
      fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+id)
        .then(r => r.json())
        .then(data => {
          if (!isBaked) {
            let u = data.thumbnail_url || '';
            img.src = u.replace(/_[0-9]+x[0-9]+/, '_640') || ('https://vumbnail.com/'+id+'.jpg');
            if (data.title) img.alt = data.title;
          }
          const dur = card.querySelector('.card-duration');
          if (dur && !dur.textContent && data.duration) {
            const m = Math.floor(data.duration / 60);
            const s = data.duration % 60;
            dur.textContent = m + ':' + String(s).padStart(2, '0');
          }
        })
        .catch(() => { if (!isBaked) img.src = 'https://vumbnail.com/'+id+'.jpg'; });
      // Proxy: overwrites with accurate duration + real resolution when available
      fetch('/api/vimeo/' + id)
        .then(r => r.json())
        .then(data => {
          if (!data.duration && !data.width) return;
          const dur = card.querySelector('.card-duration');
          if (dur) {
            const parts = [];
            if (data.duration) {
              const m = Math.floor(data.duration / 60);
              const s = data.duration % 60;
              parts.push(m + ':' + String(s).padStart(2, '0'));
            }
            if (data.width) {
              const w = data.width;
              parts.push(w >= 3840 ? '4K' : w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'SD');
            }
            if (parts.length) dur.textContent = parts.join(' · ');
          }
        })
        .catch(() => {});
    }
  });

  // Trim tags to single line
  function trimTags() {
    document.querySelectorAll('.card .tags').forEach(container => {
      const tags = Array.from(container.querySelectorAll('span'));
      if (tags.length < 2) return;
      // Reset: show all, remove old +N
      tags.forEach(tag => { if (!tag.dataset.tag && !tag.classList.contains('tag-medium')) return; tag.style.display = ''; });
      container.querySelectorAll('span:not([data-tag]):not(.tag-medium)').forEach(el => el.remove());
      
      // Skip if container is hidden
      if (container.offsetParent === null) return;
      
      const firstTop = tags[0].offsetTop;
      let hiddenCount = 0;
      tags.forEach(tag => {
        if (tag.offsetTop > firstTop) {
          tag.style.display = 'none';
          hiddenCount++;
        }
      });
      
      if (hiddenCount > 0) {
        const more = document.createElement('span');
        more.textContent = '+' + hiddenCount;
        more.style.opacity = '0.4';
        more.style.cursor = 'default';
        more.style.whiteSpace = 'nowrap';
        container.appendChild(more);
        
        while (more.offsetTop > firstTop && container.querySelectorAll('span:not([style*="display: none"])').length > 2) {
          const visible = Array.from(container.querySelectorAll('span:not([style*="display: none"])')); 
          const lastVisible = visible[visible.length - 2];
          if (lastVisible && lastVisible !== more) {
            lastVisible.style.display = 'none';
            hiddenCount++;
            more.textContent = '+' + hiddenCount;
          } else {
            break;
          }
        }
      }
    });
  }
  setTimeout(trimTags, 100);
  const lightbox = document.getElementById('lightbox');
  const lbIframe = document.getElementById('lb-iframe');
  const lbTitle = document.getElementById('lb-title');
  const lbAuthors = document.getElementById('lb-authors');
  const lbYear = document.getElementById('lb-year');
  const lbDesc = document.getElementById('lb-desc');
  const lbDescWrap = document.getElementById('lb-desc-wrap');
  const lbReadMore = document.getElementById('lb-read-more');

  document.querySelector('.grid').addEventListener('click', e => {
    const card = e.target.closest('.card[data-video-id]');
    if (card && e.target.closest('.thumb')) {
      const id = card.dataset.videoId;
      const type = card.dataset.videoType;
      if (type === 'youtube') {
        lbIframe.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0';
      } else {
        lbIframe.src = 'https://player.vimeo.com/video/' + id + '?autoplay=1&title=0&byline=0&portrait=0';
      }
      lbTitle.textContent = card.dataset.title || '';
      lbAuthors.textContent = card.dataset.authors || '';
      lbYear.textContent = card.dataset.year || '';
      lbDesc.textContent = card.dataset.desc || '';
      lbDescWrap.classList.remove('open');
      lbReadMore.textContent = 'read synopsis ↓';
      lightbox.classList.add('open');
      lockBody();
    }
  });

  // iOS Safari ignores overflow:hidden on body; the position:fixed pattern
  // locks scroll reliably on all platforms (scroll position saved/restored)
  let lockScrollY = 0;
  function lockBody() {
    lockScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = -lockScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
  }
  function unlockBody() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.overflow = '';
    window.scrollTo(0, lockScrollY);
  }

  lbReadMore.addEventListener('click', () => {
    const isOpen = lbDescWrap.classList.toggle('open');
    lbReadMore.textContent = isOpen ? 'close synopsis ↑' : 'read synopsis ↓';
  });

  function closeLightbox() {
    lightbox.classList.remove('open');
    lbIframe.src = '';
    lbDescWrap.classList.remove('open');
    unlockBody();
  }
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox || e.target.closest('.lb-close')) closeLightbox();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Filters
  const grid = document.querySelector('.grid');
  const filtersBar = document.querySelector('.filters');
  const introBlock = document.getElementById('intro-block');
  let activeFilter = 'all';
  let activeType = 'tag';
  let userArchiveOpen = false;     // archive opened deliberately (plus button)
  let archiveAutoOpened = false;   // archive opened automatically by zooming out
  let introAutoHidden = false;     // intro hidden automatically by zooming out

  // The intro block occupies two grid cells; when it is not in the grid the
  // .intro-off class lets two extra archive teasers fill its place so the
  // row rhythm before the show-all row stays intact
  function updateIntroOffClass() {
    const introInGrid = aboutActive && scaleIndex === 0 && activeFilter === 'all';
    grid.classList.toggle('intro-off', !introInGrid);
  }

  // Dynamically limit visible tags so + always stays on the first line
  const filtersRow = document.getElementById('filters-row');
  const themeTags = filtersRow.querySelector('.theme-tags');
  const filtersExtra = document.getElementById('filters-extra');
  const expandBtn = document.getElementById('tag-expand');

  function enforceFirstLine() {
    if (filtersBar.classList.contains('show-all')) return;
    // Reset: move all filtersExtra buttons back into themeTags before expandBtn
    Array.from(filtersExtra.querySelectorAll('button[data-filter]')).forEach(btn => {
      themeTags.insertBefore(btn, expandBtn);
    });
    // Use the "all" button as the baseline for line 1. Buttons differ a few px
    // in height (superscript counts), so centering offsets them slightly —
    // only treat a clear jump as a wrap, not sub-row alignment differences.
    const ROW_TOL = 8;
    const allBtn = themeTags.querySelector('button[data-filter="all"]');
    const firstTop = allBtn ? allBtn.offsetTop : 0;
    // Move any tags that wrapped to filtersExtra
    let hasOverflow = false;
    Array.from(themeTags.querySelectorAll('button[data-filter]:not([data-filter="all"])')).forEach(btn => {
      if (btn.offsetTop > firstTop + ROW_TOL) { filtersExtra.appendChild(btn); hasOverflow = true; }
    });
    const hasMediumTags = !!document.querySelector('.medium-tags button[data-filter]');
    expandBtn.style.display = (!hasOverflow && !hasMediumTags) ? 'none' : '';
    // Keep pulling the last visible tag out until + fits on line 1
    let guard = 50;
    while (expandBtn.offsetTop > firstTop + ROW_TOL && guard-- > 0) {
      const visible = Array.from(themeTags.querySelectorAll('button[data-filter]:not([data-filter="all"])'));
      if (!visible.length) break;
      filtersExtra.insertBefore(visible[visible.length - 1], filtersExtra.firstChild);
    }
  }

  // Run after first paint, after fonts are ready, and on any container resize
  setTimeout(() => requestAnimationFrame(enforceFirstLine), 0);
  document.fonts.ready.then(() => requestAnimationFrame(enforceFirstLine));
  new ResizeObserver(() => { if (!filtersBar.classList.contains('show-all')) requestAnimationFrame(enforceFirstLine); }).observe(filtersRow);
  // Re-run after window resizes settle (orientation change on phones)
  let efTimer;
  window.addEventListener('resize', () => {
    clearTimeout(efTimer);
    efTimer = setTimeout(() => { if (!filtersBar.classList.contains('show-all')) enforceFirstLine(); }, 150);
  });

  // Tag expand toggle
  document.getElementById('tag-expand').addEventListener('click', () => {
    if (activeType === 'search') {
      clearSearchInputs();
      applyFilter('all', 'tag');
    }
    filtersBar.classList.add('show-all');
    requestAnimationFrame(positionScaleCtrl);
  });

  document.getElementById('tag-collapse').addEventListener('click', () => {
    filtersBar.classList.remove('show-all');
    requestAnimationFrame(() => { enforceFirstLine(); positionScaleCtrl(); });
  });

  // Support both inline intro search and filter-bar search
  const searchInput = document.getElementById('search-input');
  const filterBarSearch = document.querySelector('.filters-search-input');

  function clearSearchInputs() {
    if (searchInput) searchInput.value = '';
    if (filterBarSearch) filterBarSearch.value = '';
    var rsi = document.getElementById('rail-search-input');
    if (rsi) rsi.value = '';
  }

  function runSearch(q) {
    if (!q) { applyFilter('all', 'tag'); return; }
    activeFilter = 'search';
    activeType = 'search';
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => btn.classList.remove('active'));
    grid.classList.add('show-archive');
    if (introBlock) introBlock.style.display = 'none';
    updateIntroOffClass();
    const archiveToggleEl = document.getElementById('archive-toggle');
    if (archiveToggleEl) archiveToggleEl.style.display = 'none';
    updateArchiveCloseBtn();
    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const title = (card.dataset.title || '').toLowerCase();
      const authors = (card.dataset.authors || '').toLowerCase();
      const tutor = (card.dataset.tutor || '').toLowerCase();
      const tags = (card.dataset.tags || '').toLowerCase();
      const desc = (card.dataset.desc || '').toLowerCase();
      const match = title.includes(q) || authors.includes(q) || tutor.includes(q) || tags.includes(q) || desc.includes(q);
      card.classList.toggle('hidden', !match);
    });
  }

  if (searchInput) searchInput.addEventListener('input', () => runSearch(searchInput.value.toLowerCase().trim()));
  if (filterBarSearch) filterBarSearch.addEventListener('input', () => runSearch(filterBarSearch.value.toLowerCase().trim()));

  function applyFilter(value, type) {
    activeFilter = value;
    activeType = type || 'tag';
    document.body.classList.toggle('has-filter', value !== 'all');
    if (value === 'all') { filtersBar.classList.remove('show-all'); requestAnimationFrame(positionScaleCtrl); }
    if (type !== 'search') clearSearchInputs();
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    filtersExtra.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    document.querySelectorAll('.card-year').forEach(y => {
      y.style.color = (activeType === 'year' && y.dataset.year === value) ? '#1e40af' : '';
    });
    document.querySelectorAll('a.year-filter').forEach(a => {
      a.classList.toggle('active', type === 'year' && a.dataset.year === value);
    });
    document.querySelectorAll('.card .tags span[data-tag]').forEach(s => s.classList.remove('active'));
    if (value !== 'all' && type === 'tag') {
      document.querySelectorAll('.card .tags span[data-tag="' + value + '"]').forEach(s => s.classList.add('active'));
    }

    // Show/hide intro block + archive toggle when filtering
    const isFiltered = value !== 'all';
    if (introBlock) introBlock.style.display = (isFiltered || !aboutActive || scaleIndex > 0) ? 'none' : '';
    updateIntroOffClass();
    const archiveToggleEl = document.getElementById('archive-toggle');
    if (archiveToggleEl) archiveToggleEl.style.display = isFiltered ? 'none' : '';

    if (value === 'all') {
      grid.classList.toggle('show-archive', userArchiveOpen || archiveAutoOpened);
    } else {
      grid.classList.add('show-archive');
    }
    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const isArchive = card.dataset.featured === 'false';
      if (value === 'all') {
        card.classList.toggle('hidden', isArchive && !userArchiveOpen && !archiveAutoOpened
          && !card.classList.contains('archive-preview') && !card.classList.contains('archive-preview-extra'));
      } else if (type === 'year') {
        card.classList.toggle('hidden', card.dataset.year !== value);
      } else {
        const tags = card.dataset.tags;
        card.classList.toggle('hidden', !tags.split(',').includes(value));
      }
    });
    updateArchiveCloseBtn();
  }

  filtersBar.addEventListener('click', e => {
    const btn = e.target.closest('button[data-filter]');
    if (btn) applyFilter(btn.dataset.filter, 'tag');
  });

  document.querySelector('.grid').addEventListener('click', e => {
    if (e.target.matches('.tags span[data-tag]')) {
      applyFilter(e.target.dataset.tag, 'tag');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (e.target.matches('.card-year[data-year]')) {
      const year = e.target.dataset.year;
      if (activeType === 'year' && activeFilter === year) applyFilter('all', 'tag');
      else applyFilter(year, 'year');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Year filter links in intro text
  document.querySelectorAll('.year-filter').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      applyFilter(link.dataset.year, 'year');
      // Keep intro visible when filtering from text
      if (introBlock && aboutActive && scaleIndex === 0) introBlock.style.display = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Archive reveal: the plus in the ghost preview row shows the full archive;
  // the minus cell at the end (normal view only) folds it back to highlights
  const archiveToggle = document.getElementById('archive-toggle');
  const archiveCloseBtn = document.getElementById('archive-close-btn');

  function updateArchiveCloseBtn() {
    if (!archiveCloseBtn) return;
    const visible = userArchiveOpen && activeFilter === 'all' && scaleIndex === 0;
    archiveCloseBtn.style.display = visible ? 'flex' : 'none';
  }

  function revealArchiveCards() {
    grid.classList.add('show-archive');
    archiveToggle.classList.add('is-open');
    document.querySelectorAll('.card[data-featured="false"]').forEach(card => {
      card.classList.remove('hidden');
    });
    setTimeout(trimTags, 50);
  }

  function foldArchiveCards() {
    grid.classList.remove('show-archive');
    archiveToggle.classList.remove('is-open');
    document.querySelectorAll('.card[data-featured="false"]').forEach(card => {
      card.classList.toggle('hidden',
        !card.classList.contains('archive-preview') && !card.classList.contains('archive-preview-extra'));
    });
  }

  // Deliberate open (plus button): sticks across zoom changes
  function openArchive() {
    if (!userArchiveOpen) {
      userArchiveOpen = true;
      archiveAutoOpened = false;
      revealArchiveCards();
    }
    updateArchiveCloseBtn();
  }

  function closeArchive() {
    userArchiveOpen = false;
    archiveAutoOpened = false;
    foldArchiveCards();
    updateArchiveCloseBtn();
  }

  document.getElementById('archive-btn').addEventListener('click', openArchive);
  if (archiveCloseBtn) archiveCloseBtn.addEventListener('click', closeArchive);
  // Grid scale control (desktop only — hidden on mobile via CSS)
  const scaleDown = document.getElementById('scale-down');
  const scaleUp = document.getElementById('scale-up');
  const scaleSteps = [3, 5, 7];
  let scaleIndex = 0;
  var aboutActive = true;

  // Density readout: rebuild the 2×N dot matrix to match the current column
  // count (3 / 5 / 7) — more dots = more columns = smaller thumbnails
  const scaleMatrix = document.getElementById('scale-matrix');
  function renderScaleMatrix() {
    if (!scaleMatrix) return;
    var cols = scaleSteps[scaleIndex];
    scaleMatrix.style.gridTemplateColumns = 'repeat(' + cols + ', 3px)';
    var dots = '';
    for (var i = 0; i < cols * 2; i++) dots += '<i></i>';
    scaleMatrix.innerHTML = dots;
  }
  renderScaleMatrix();

  function positionScaleCtrl() {
    // Rail layout is fully CSS-driven now — nothing to position in JS.
  }
  window.addEventListener('resize', positionScaleCtrl);
  window.addEventListener('load', function() { requestAnimationFrame(positionScaleCtrl); });
  requestAnimationFrame(positionScaleCtrl);

  function applyScale(idx) {
    const prev = scaleIndex;
    scaleIndex = idx;

    // Compact views show the whole archive (before the FLIP snapshot below so
    // the revealed cards take part in the animation). If the user never opened
    // it deliberately, fold it again when returning to the normal view.
    if (idx > 0) {
      if (!userArchiveOpen && !archiveAutoOpened) {
        archiveAutoOpened = true;
        revealArchiveCards();
      }
    } else if (archiveAutoOpened && !userArchiveOpen) {
      archiveAutoOpened = false;
      foldArchiveCards();
    }
    updateArchiveCloseBtn();

    // FLIP — First: snapshot every visible card's position and size
    const cards = Array.from(grid.querySelectorAll('.card:not(.hidden)'))
      .filter(c => getComputedStyle(c).display !== 'none');
    const firstRects = cards.map(c => c.getBoundingClientRect());

    // Intro block going away: remove from flow NOW so lastRects are correct.
    // (Deferring display:none causes a mid-animation reflow that breaks the FLIP.)
    if (introBlock && idx !== 0 && prev === 0) {
      introBlock.style.display = 'none';
      if (aboutPanel) aboutPanel.classList.remove('active');
      if (aboutActive) introAutoHidden = true;
      aboutActive = false;
      var inlimboLbl = document.getElementById('inlimbo-btn');
      if (inlimboLbl) inlimboLbl.classList.remove('active');
    }
    // Intro block coming back: put it in the DOM before recording lastRects
    // so cards land in their correct final positions with the block present.
    // Restore the intro unless the user deliberately closed it meanwhile.
    if (introBlock && idx === 0 && prev !== 0) {
      if (aboutPanel) aboutPanel.classList.remove('active');
      if (introAutoHidden) {
        introAutoHidden = false;
        aboutActive = true;
        var inlimboLblBack = document.getElementById('inlimbo-btn');
        if (inlimboLblBack) inlimboLblBack.classList.add('active');
      }
      if (aboutActive) { introBlock.style.opacity = '0'; introBlock.style.display = ''; }
    }
    updateIntroOffClass();

    // Apply grid change instantly
    grid.classList.toggle('grid-cols-5', idx === 1);
    grid.classList.toggle('grid-cols-7', idx === 2);
    renderScaleMatrix();
    if (scaleDown) scaleDown.disabled = idx === 0;
    if (scaleUp) scaleUp.disabled = idx === scaleSteps.length - 1;
    requestAnimationFrame(positionScaleCtrl);

    // FLIP — Last: read new positions (forces reflow so layout is committed)
    const lastRects = cards.map(c => c.getBoundingClientRect());

    // Fade intro in after positions are captured
    if (introBlock && idx === 0 && prev !== 0 && aboutActive) {
      requestAnimationFrame(function() { introBlock.style.opacity = '1'; });
    }

    // FLIP — Invert + Play via Web Animations API:
    // animate FROM the old position/size TO the new one (fill:none = no style pollution)
    cards.forEach(function(card) { card.style.willChange = 'transform'; });
    cards.forEach(function(card, i) {
      const f = firstRects[i], l = lastRects[i];
      if (!l.width) { card.style.willChange = ''; return; }
      const dx = f.left - l.left;
      const dy = f.top  - l.top;
      const sx = f.width  / l.width;
      const sy = f.height / l.height;
      const anim = card.animate(
        [
          { transformOrigin: '0 0', transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sx + ',' + sy + ')' },
          { transformOrigin: '0 0', transform: 'none' }
        ],
        { duration: 600, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'none' }
      );
      anim.finished.then(function() { card.style.willChange = ''; });
    });
  }

  if (scaleDown) scaleDown.addEventListener('click', () => applyScale(Math.max(0, scaleIndex - 1)));
  if (scaleUp) scaleUp.addEventListener('click', () => applyScale(Math.min(scaleSteps.length - 1, scaleIndex + 1)));

  // About panel (fixed overlay for compact grid modes)
  var aboutPanel = document.getElementById('about-panel');
  if (aboutPanel && introBlock) {
    var introClone = introBlock.cloneNode(true);
    introClone.removeAttribute('id');
    aboutPanel.appendChild(introClone);
  }

  function positionAboutPanel() {
    if (!aboutPanel) return;
    var gridEl = document.querySelector('.grid');
    if (!gridEl) return;
    var gridRect = gridEl.getBoundingClientRect();
    var colW = Math.round(gridRect.width / 3 - 14);
    aboutPanel.style.left  = Math.round(gridRect.left + window.scrollX) + 'px';
    aboutPanel.style.top   = Math.round(gridRect.top + window.scrollY) + 'px';
    aboutPanel.style.width = colW + 'px';
  }

  // Close cross on the floating panel acts as the [about] toggle
  var aboutClose = document.querySelector('.about-close');
  if (aboutClose) {
    aboutClose.addEventListener('click', function(e) {
      e.stopPropagation();
      var btn = document.getElementById('inlimbo-btn');
      if (btn && aboutActive) btn.click();
    });
  }

  // About toggle — the vertical "inlimbo.video" rail label opens/closes the
  // about section (floating panel in compact modes, in-grid intro in 3-col)
  var aboutBtn = document.getElementById('inlimbo-btn');
  if (aboutBtn) {
    aboutBtn.addEventListener('click', function() {
      aboutActive = !aboutActive;
      introAutoHidden = false; // explicit choice from here on
      updateIntroOffClass();

      aboutBtn.classList.toggle('active', aboutActive);
      if (scaleIndex > 0) {
        if (aboutActive) { positionAboutPanel(); aboutPanel.classList.add('active'); }
        else { aboutPanel.classList.remove('active'); }
      } else {
        if (aboutPanel) aboutPanel.classList.remove('active');
        if (introBlock) {
          if (aboutActive) {
            introBlock.style.opacity = '0';
            introBlock.style.display = '';
            requestAnimationFrame(function() {
              introBlock.style.opacity = '1';
              requestAnimationFrame(positionScaleCtrl);
            });
          } else {
            introBlock.style.display = 'none';
            requestAnimationFrame(positionScaleCtrl);
          }
        }
      }
    });
  }
  window.addEventListener('resize', positionAboutPanel);

  // Rail search: the circle expands into a black pill with a text input.
  var railSearch = document.getElementById('rail-search');
  var railSearchBtn = document.getElementById('rail-search-btn');
  var railSearchInput = document.getElementById('rail-search-input');
  function openRailSearch() {
    if (!railSearch) return;
    railSearch.classList.add('open');
    railSearchBtn.setAttribute('aria-expanded', 'true');
    if (railSearchInput) railSearchInput.focus();
  }
  function closeRailSearch() {
    if (!railSearch) return;
    railSearch.classList.remove('open');
    railSearchBtn.setAttribute('aria-expanded', 'false');
    if (railSearchInput) railSearchInput.value = '';
  }
  if (railSearchBtn) {
    railSearchBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (railSearch.classList.contains('open')) {
        var hadQuery = railSearchInput && railSearchInput.value.trim();
        closeRailSearch();
        if (hadQuery) applyFilter('all', 'tag');
      } else {
        openRailSearch();
      }
    });
  }
  if (railSearchInput) {
    railSearchInput.addEventListener('input', function() {
      runSearch(railSearchInput.value.toLowerCase().trim());
    });
    railSearchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { closeRailSearch(); applyFilter('all', 'tag'); }
    });
  }
  // Click outside the open pill collapses it (only when it holds no query)
  document.addEventListener('click', function(e) {
    if (!railSearch || !railSearch.classList.contains('open')) return;
    if (railSearch.contains(e.target)) return;
    if (!(railSearchInput && railSearchInput.value.trim())) closeRailSearch();
  });

  // On mobile: move intro block above the filter tags so reading order is
  // intro → tags → cards instead of tags → intro → cards
  if (window.innerWidth <= 768 && introBlock && filtersBar) {
    filtersBar.parentNode.insertBefore(introBlock, filtersBar);
  }

  // Prepend year to duration label (year column is hidden on the main view)
  (function() {
    function prependYear(dur) {
      const card = dur.closest('.card');
      const year = card && card.dataset.year;
      if (!year || !dur.textContent.trim() || dur.textContent.startsWith(year)) return;
      dur.textContent = year + ' · ' + dur.textContent;
    }
    document.querySelectorAll('.card-duration').forEach(dur => {
      prependYear(dur);
      new MutationObserver(() => prependYear(dur)).observe(dur, { childList: true, characterData: true, subtree: true });
    });
  })();

