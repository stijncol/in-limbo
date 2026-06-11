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

  // Hover handler for baked thumbnails: shows sharp + pixel-noise shimmer
  function setupBakedHover(thumb) {
    const sharp = thumb.querySelector('.baked-sharp');
    if (!sharp) return;
    let canvas = null, ctx = null, origData = null, shimmerRaf = null, shimmerActive = false;

    function initShimmer() {
      if (canvas || !sharp.naturalWidth) return false;
      canvas = document.createElement('canvas');
      canvas.width = sharp.naturalWidth;
      canvas.height = sharp.naturalHeight;
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;opacity:0;transition:opacity 0.55s ease-in-out;image-rendering:pixelated';
      thumb.appendChild(canvas);
      ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(sharp, 0, 0, canvas.width, canvas.height);
        origData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return true;
      } catch(e) { return false; }
    }

    function shimmerTick() {
      if (!shimmerActive || !origData) return;
      const id = new ImageData(new Uint8ClampedArray(origData.data), origData.width, origData.height);
      const d = id.data, n = origData.width * origData.height;
      const swaps = Math.floor(n * 0.015);
      for (let k = 0; k < swaps; k++) {
        const i = Math.floor(Math.random() * n) * 4;
        const j = Math.floor(Math.random() * n) * 4;
        const r = d[i], g = d[i+1], b = d[i+2];
        d[i] = d[j]; d[i+1] = d[j+1]; d[i+2] = d[j+2];
        d[j] = r; d[j+1] = g; d[j+2] = b;
      }
      ctx.putImageData(id, 0, 0);
      setTimeout(() => { if (shimmerActive) shimmerRaf = requestAnimationFrame(shimmerTick); }, 120);
    }

    thumb.addEventListener('mouseenter', () => {
      sharp.style.opacity = '1';
      if (!canvas) initShimmer();
      if (canvas && origData) {
        shimmerActive = true;
        canvas.style.display = 'block';
        shimmerTick();
        requestAnimationFrame(() => requestAnimationFrame(() => { canvas.style.opacity = '1'; }));
      }
    });
    thumb.addEventListener('mouseleave', () => {
      shimmerActive = false;
      if (shimmerRaf) cancelAnimationFrame(shimmerRaf);
      if (canvas) {
        canvas.style.opacity = '0';
        setTimeout(() => { if (!shimmerActive && canvas) canvas.style.display = 'none'; }, 550);
      }
      sharp.style.opacity = '0';
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
      document.body.style.overflow = 'hidden';
    }
  });

  lbReadMore.addEventListener('click', () => {
    const isOpen = lbDescWrap.classList.toggle('open');
    lbReadMore.textContent = isOpen ? 'close synopsis ↑' : 'read synopsis ↓';
  });

  function closeLightbox() {
    lightbox.classList.remove('open');
    lbIframe.src = '';
    lbDescWrap.classList.remove('open');
    document.body.style.overflow = '';
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
    // Use the "all" button as the baseline for line 1
    const allBtn = themeTags.querySelector('button[data-filter="all"]');
    const firstTop = allBtn ? allBtn.offsetTop : 0;
    // Move any tags that wrapped to filtersExtra
    let hasOverflow = false;
    Array.from(themeTags.querySelectorAll('button[data-filter]:not([data-filter="all"])')).forEach(btn => {
      if (btn.offsetTop > firstTop) { filtersExtra.appendChild(btn); hasOverflow = true; }
    });
    const hasMediumTags = !!document.querySelector('.medium-tags button[data-filter]');
    expandBtn.style.display = (!hasOverflow && !hasMediumTags) ? 'none' : '';
    // Keep pulling the last visible tag out until + fits on line 1
    let guard = 50;
    while (expandBtn.offsetTop > firstTop && guard-- > 0) {
      const visible = Array.from(themeTags.querySelectorAll('button[data-filter]:not([data-filter="all"])'));
      if (!visible.length) break;
      filtersExtra.insertBefore(visible[visible.length - 1], filtersExtra.firstChild);
    }
  }

  // Run after first paint, after fonts are ready, and on any container resize
  setTimeout(() => requestAnimationFrame(enforceFirstLine), 0);
  document.fonts.ready.then(() => requestAnimationFrame(enforceFirstLine));
  new ResizeObserver(() => { if (!filtersBar.classList.contains('show-all')) requestAnimationFrame(enforceFirstLine); }).observe(filtersRow);

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
  }

  function runSearch(q) {
    if (!q) { applyFilter('all', 'tag'); return; }
    activeFilter = 'search';
    activeType = 'search';
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => btn.classList.remove('active'));
    grid.classList.add('show-archive');
    const archiveToggleEl = document.getElementById('archive-toggle');
    if (archiveToggleEl) archiveToggleEl.style.display = 'none';
    updateArchiveCloseBtn();
    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const title = (card.dataset.title || '').toLowerCase();
      const authors = (card.dataset.authors || '').toLowerCase();
      const tags = (card.dataset.tags || '').toLowerCase();
      const match = title.includes(q) || authors.includes(q) || tags.includes(q);
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
        card.classList.toggle('hidden', isArchive && !userArchiveOpen && !archiveAutoOpened && !card.classList.contains('archive-preview'));
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
    if (e.target.tagName === 'BUTTON' && e.target.dataset.filter) applyFilter(e.target.dataset.filter, 'tag');
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
      card.classList.toggle('hidden', !card.classList.contains('archive-preview'));
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

  function positionScaleCtrl() {
    var ctrl = document.getElementById('scale-ctrl');
    var aboutBtn = document.getElementById('about-btn');
    var gridEl = document.querySelector('.grid');
    if (!gridEl || window.innerWidth <= 900) return;
    var gridRect = gridEl.getBoundingClientRect();
    // The control is position:fixed; use the grid's *document* offset so a
    // recalculation gives the same spot no matter the current scroll position
    // (gridRect.top alone is viewport-relative and made the control jump).
    var gridTop = Math.round(gridRect.top + window.scrollY + 10);
    // Tablet range: place controls horizontally above the grid (CSS removes the
    // vertical writing-mode in this range — see media query for 901-1180px).
    var isTablet = window.innerWidth <= 1180;
    // Never let the controls drift more than this far from the grid's edge.
    // Without a cap, large screens centre the button in the huge empty margin.
    var MAX_GAP = 80;

    if (ctrl) {
      var rightGap = window.innerWidth - gridRect.right;
      if (isTablet) {
        // Anchor at the page's top padding line, aligned to the grid's right edge.
        ctrl.style.right = Math.max(4, Math.round(rightGap)) + 'px';
        ctrl.style.top = '12px';
      } else {
        var ctrlCentered = (rightGap - ctrl.offsetWidth) / 2;
        var ctrlMin = Math.max(4, rightGap - ctrl.offsetWidth - MAX_GAP);
        ctrl.style.right = Math.round(Math.max(ctrlMin, ctrlCentered)) + 'px';
        ctrl.style.top = gridTop + 'px';
      }
    }
    if (aboutBtn) {
      var leftGap = gridRect.left;
      if (isTablet) {
        aboutBtn.style.left = Math.max(4, Math.round(leftGap)) + 'px';
        aboutBtn.style.top = (12 + window.scrollY) + 'px';
      } else {
        var aboutCentered = (leftGap - aboutBtn.offsetWidth) / 2;
        var aboutMin = Math.max(4, leftGap - aboutBtn.offsetWidth - MAX_GAP);
        aboutBtn.style.left = Math.round(Math.max(aboutMin, aboutCentered)) + 'px';
        aboutBtn.style.top = Math.round(gridRect.top + window.scrollY + 10) + 'px';
      }
    }
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
      var aboutBtn = document.getElementById('about-btn');
      if (aboutBtn) aboutBtn.classList.remove('active');
    }
    // Intro block coming back: put it in the DOM before recording lastRects
    // so cards land in their correct final positions with the block present.
    // Restore the intro unless the user deliberately closed it meanwhile.
    if (introBlock && idx === 0 && prev !== 0) {
      if (aboutPanel) aboutPanel.classList.remove('active');
      if (introAutoHidden) {
        introAutoHidden = false;
        aboutActive = true;
        var aboutBtnBack = document.getElementById('about-btn');
        if (aboutBtnBack) aboutBtnBack.classList.add('active');
      }
      if (aboutActive) { introBlock.style.opacity = '0'; introBlock.style.display = ''; }
    }

    // Apply grid change instantly
    grid.classList.toggle('grid-cols-5', idx === 1);
    grid.classList.toggle('grid-cols-7', idx === 2);
    document.querySelectorAll('.scale-grid-icon').forEach(function(btn, i) {
      btn.classList.toggle('active', i === idx);
    });
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
  document.querySelectorAll('.scale-grid-icon').forEach(function(btn) {
    btn.addEventListener('click', function() { applyScale(parseInt(btn.dataset.scale, 10)); });
  });

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
      var btn = document.getElementById('about-btn');
      if (btn && aboutActive) btn.click();
    });
  }

  // About toggle — floating panel in compact modes, in-grid block in 3-col
  var aboutBtn = document.getElementById('about-btn');
  if (aboutBtn) {
    aboutBtn.addEventListener('click', function() {
      aboutActive = !aboutActive;
      introAutoHidden = false; // explicit choice from here on

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

  // DVD screensaver logo
  (function() {
    var wrap = document.createElement('div');
    wrap.id = 'dvd-logo';
    document.body.appendChild(wrap);

    var logoBase = document.createElement('img');
    logoBase.src = '/public/inlimbo-logo2.png';
    logoBase.draggable = false;
    logoBase.style.opacity = '1';

    var logoSel = document.createElement('img');
    logoSel.src = '/public/inlimbo-logo2_selected.png';
    logoSel.draggable = false;
    logoSel.style.opacity = '0';
    logoSel.style.transition = 'opacity 0.5s';

    wrap.appendChild(logoBase);
    wrap.appendChild(logoSel);

    var closeBtn = document.createElement('div');
    closeBtn.id = 'dvd-logo-close';

    var iconPause = '<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="white" stroke="#000" stroke-width="0.5"/><rect x="5.5" y="5" width="2" height="6" rx="0.5" fill="#000"/><rect x="8.5" y="5" width="2" height="6" rx="0.5" fill="#000"/></svg>';
    var iconPlay  = '<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="white" stroke="#000" stroke-width="0.5"/><polygon points="6.5,5 12,8 6.5,11" fill="#000"/></svg>';

    closeBtn.innerHTML = iconPause;
    closeBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      paused = !paused;
      closeBtn.innerHTML = paused ? iconPlay : iconPause;
    });
    wrap.appendChild(closeBtn);

    var isSelected = false;

    function fadeTo(sel, duration) {
      logoSel.style.transition = 'opacity ' + (duration || 0.5) + 's';
      logoSel.style.opacity = sel ? '1' : '0';
      isSelected = sel;
      if (!dragging) wrap.style.cursor = sel ? 'pointer' : 'grab';
    }

    wrap.addEventListener('mousemove', function(e) {
      var rect = wrap.getBoundingClientRect();
      var dx = e.clientX - (rect.left + rect.width / 2);
      var dy = e.clientY - (rect.top  + rect.height / 2);
      var inCenter = Math.sqrt(dx*dx + dy*dy) < rect.width * 0.32;
      if (inCenter !== isSelected) fadeTo(inCenter, 0.5);
    });
    wrap.addEventListener('mouseleave', function() { fadeTo(false, 0.5); });
    // Click toggles the float; a drag (mouse moved since mousedown) does not count
    var downX = 0, downY = 0;
    wrap.addEventListener('click', function(e) {
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      paused = !paused;
      closeBtn.innerHTML = paused ? iconPlay : iconPause;
    });

    var introEl = document.getElementById('intro-block');
    var size = introEl ? Math.round(introEl.offsetWidth * 7 / 16) : 158;
    wrap.style.width  = size + 'px';
    wrap.style.height = size + 'px';

    var margin = 24;
    var startRect = introEl ? introEl.getBoundingClientRect() : { left: 40, top: 120 };
    var x = startRect.left + margin;
    var y = startRect.top  + margin;

    var speed = 0.78;
    var vx = speed;
    var vy = speed * 0.65;

    var hovering = false;
    var dragging = false;
    var paused = false;
    var dragOffX = 0, dragOffY = 0;

    document.addEventListener('mousemove', function(e) {
      if (wrap.style.display === 'none') return;
      if (dragging) {
        x = e.clientX - dragOffX;
        y = e.clientY - dragOffY;
        return;
      }
      var rect = wrap.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = e.clientX - cx;
      var dy = e.clientY - cy;
      hovering = (dx*dx + dy*dy) < Math.pow(rect.width / 2 + 40, 2);
    }, { passive: true });

    wrap.addEventListener('mousedown', function(e) {
      if (e.target === closeBtn || closeBtn.contains(e.target)) return;
      downX = e.clientX;
      downY = e.clientY;
      dragging = true;
      dragOffX = e.clientX - x;
      dragOffY = e.clientY - y;
      wrap.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mouseup', function(e) {
      if (!dragging) return;
      dragging = false;
      // Only a real drag parks the logo; a plain click is handled by the
      // click listener, which toggles the float instead
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) {
        paused = true;
        closeBtn.innerHTML = iconPlay;
      }
      wrap.style.cursor = isSelected ? 'pointer' : 'grab';
    });

    var lastTs = 0;
    function tick(ts) {
      var dt = lastTs ? Math.min(ts - lastTs, 50) : 16.667;
      lastTs = ts;
      var scale = dt / 16.667;
      var minX = 0;
      var maxX = Math.max(0, window.innerWidth - size);
      var minY = 0;
      var maxY = Math.max(0, window.innerHeight - size);
      if (!hovering && !dragging && !paused) {
        x += vx * scale;
        y += vy * scale;
        if (x <= minX) { x = minX; vx =  Math.abs(vx); }
        if (x >= maxX) { x = maxX; vx = -Math.abs(vx); }
        if (y <= minY) { y = minY; vy =  Math.abs(vy); }
        if (y >= maxY) { y = maxY; vy = -Math.abs(vy); }
      }
      x = Math.min(Math.max(x, minX), maxX);
      y = Math.min(Math.max(y, minY), maxY);
      wrap.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

  })();
