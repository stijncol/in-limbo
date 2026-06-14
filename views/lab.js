function renderLab(rows) {
  const allVideos = rows.filter(v => v.status === 'approved' || !v.status);
  function e(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  const cards = allVideos.map(v => {
    const vid = v.video_id || v.vimeo_id;
    const vtype = v.video_type || 'vimeo';
    const hasThumb = v.has_thumb ? '1' : '0';
    return '<div class="lc" data-vid="' + e(vid) + '" data-vtype="' + e(vtype) + '" data-id="' + v.id + '" data-has-thumb="' + hasThumb + '">' +
      '<div class="lt"></div>' +
      '<div class="lm">' +
        '<div class="lmr">' +
          '<div class="ln">' + e(v.title) + '</div>' +
          '<div class="ls">' + e(v.students) + '</div>' +
          '<div class="lsw"></div>' +
        '</div>' +
        '<div class="lact">' +
          '<span class="ldot' + (v.has_thumb ? ' baked' : '') + '" title="' + (v.has_thumb ? 'baked' : 'not baked') + '"></span>' +
          '<button class="lbake-btn" data-id="' + v.id + '">bake</button>' +
        '</div>' +
      '</div>' +
      '</div>';
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>dither lab</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/public/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/css/lab.css">
</head>
<body>
<div id="panel">
  <div id="panel-bar"><span id="ptoggle">▸</span><span id="ptitle">dither lab</span></div>
  <div id="panel-body">
    <div class="pg">
      <div class="pgl">image</div>
      <label>brightness <input type="range" id="i-bright" min="-80" max="80" value="7"><span class="val" id="v-bright">7</span></label>
      <label>shadows <input type="range" id="i-shadows" min="0" max="120" value="67"><span class="val" id="v-shadows">67</span></label>
      <label>gamma <input type="range" id="i-gamma" min="50" max="300" value="135"><span class="val" id="v-gamma">1.35</span></label>
      <label>contrast <input type="range" id="i-contrast" min="50" max="200" value="127"><span class="val" id="v-contrast">1.27</span></label>
      <label>blur <input type="range" id="i-blur" min="0" max="3" step="1" value="2"><span class="val" id="v-blur">2</span></label>
    </div>
    <div class="pg">
      <div class="pgl">dither</div>
      <label>technique <select id="i-tech"><option value="fs">floyd-steinberg</option><option value="atkinson">atkinson</option><option value="ordered">ordered (bayer)</option><option value="chsep">channel sep</option></select></label>
      <label>width <input type="range" id="i-width" min="200" max="800" value="500"><span class="val" id="v-width">500</span></label>
    </div>
    <div class="pg">
      <div class="pgl">palette</div>
      <label>mode <select id="i-pmode"><option value="kmeans">kmeans (image)</option><option value="fixed">fixed (site)</option><option value="mono">mono</option><option value="duo" selected>duo</option><option value="tint">tint</option><option value="custom">custom</option></select></label>
      <label>colors <input type="range" id="i-pcolors" min="2" max="8" value="4"><span class="val" id="v-pcolors">4</span></label>
      <label>pastel <input type="range" id="i-pastel" min="0" max="100" value="60"><span class="val" id="v-pastel">60%</span></label>
      <label>lightness <input type="range" id="i-light" min="0" max="100" value="50"><span class="val" id="v-light">50%</span></label>
      <div id="pc-mono" class="pc"><label>hue <input type="color" id="i-monohue" value="#3C5A78"></label></div>
      <div id="pc-tint" class="pc"><label>hue <input type="color" id="i-tinthue" value="#3C5A78"></label></div>
      <div id="pc-fixed" class="pc"><label>extras <select id="i-fixedx"><option value="warm">warm</option><option value="cool">cool</option><option value="neutral">neutral</option></select></label></div>
      <div id="pc-duo" class="pc">
        <label>preset <select id="i-duopreset" style="max-width:148px"></select></label>
        <label>col 1 <input type="color" id="i-duo1" value="#5991a6"></label>
        <label>col 2 <input type="color" id="i-duo2" value="#bab4b0"></label>
      </div>
      <div id="pc-custom" class="pc">
        <label>col 1 <input type="color" id="i-cus1" value="#3C3C78"></label>
        <label>col 2 <input type="color" id="i-cus2" value="#82412D"></label>
        <label>col 3 <input type="color" id="i-cus3" value="#F8F5EE"></label>
      </div>
    </div>
    <div class="pg">
      <div class="pgl">options</div>
      <label><input type="checkbox" id="i-basetones" checked> + cream &amp; charcoal</label>
      <div id="pc-basetones" class="pc vis">
        <label>cream <input type="color" id="i-cream" value="#ffffff"></label>
        <label>grey <input type="color" id="i-charcoal" value="#787878"></label>
      </div>
      <label><input type="checkbox" id="i-shared"> shared palette</label>
      <div id="pc-shared" class="pc">
        <label>pool <input type="range" id="i-pool" min="3" max="12" value="6"><span class="val" id="v-pool">6</span></label>
      </div>
    </div>
    <div class="pg">
      <div class="pgl">hover</div>
      <label><input type="checkbox" id="i-shimmer" checked> shimmer</label>
      <label>fps <input type="range" id="i-fps" min="4" max="20" value="8"><span class="val" id="v-fps">8</span></label>
      <label>intensity <input type="range" id="i-inten" min="5" max="60" value="20"><span class="val" id="v-inten">20</span></label>
      <label><input type="checkbox" id="i-reveal" checked> reveal color</label>
      <label>accent <select id="i-amode"><option value="single">single</option><option value="dual">dual</option><option value="extract">extract</option></select></label>
      <label>acc 1 <input type="color" id="i-acc1" value="#825A38"></label>
      <div id="pc-acc2" class="pc"><label>acc 2 <input type="color" id="i-acc2" value="#285A46"></label></div>
      <label>reveal% <input type="range" id="i-revpct" min="5" max="50" value="15"><span class="val" id="v-revpct">15</span></label>
    </div>
    <div class="pg" style="justify-content:flex-end;gap:6px"><button id="render-btn">▶ render</button><button id="bake-all-btn">bake all</button><button id="copy-btn">copy settings ↗</button></div>
  </div>
</div>

<div id="grid-wrap"><div class="grid" id="lab-grid">${cards}</div></div>

<div id="modal"><div id="mbox">
  <div style="font-size:10px;color:#aaa;margin-bottom:8px;letter-spacing:.06em">SETTINGS — select all &amp; copy</div>
  <textarea id="mjson"></textarea>
  <div style="display:flex;gap:8px;margin-top:10px">
    <button id="mapply">apply</button>
    <button id="mclose">close</button>
    <span id="merr" style="font-size:10px;color:#c00;align-self:center"></span>
  </div>
</div></div>

<script src="/public/js/dither.js"></script>
<script src="/public/js/lab.js"></script>
</body>
</html>`;
}

module.exports = { renderLab };
