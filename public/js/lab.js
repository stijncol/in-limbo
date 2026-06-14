// Dither pipeline (color utils, palette, preprocess, dither algorithms,
// sampleCard) lives in dither.js, loaded before this file. This file holds
// the lab-specific UI: per-card rendering, hover shimmer, controls, baking.

function renderCard(card,cfg,forcePal){
  var img=card.querySelector('img');
  if(!img||!img.complete||!img.naturalWidth)return;
  var w=cfg.dither.width,h=Math.round(w*9/16);
  var lt=card.querySelector('.lt');
  var canvas=card.querySelector('canvas');
  if(!canvas){canvas=document.createElement('canvas');canvas.style.imageRendering='pixelated';lt.appendChild(canvas)}
  canvas.width=w;canvas.height=h;
  var ctx=canvas.getContext('2d');
  var sd=sampleCard(card,img,w,h);
  var pal=forcePal||buildPalette(cfg,sd.samples);
  var plab=pal.map(function(c){return rgbToLab(c[0],c[1],c[2])});
  var px=preprocess(sd.raw,cfg);
  var out=runDither(px,w,h,pal,plab,cfg.dither.technique);
  ctx.putImageData(new ImageData(out,w,h),0,0);
  card._px=px;card._pal=pal;card._plab=plab;card._cfg=cfg;card._w=w;card._h=h;
  var sw=card.querySelector('.lsw');
  if(sw)sw.innerHTML=pal.map(function(c){return'<span class="sw" style="background:rgb('+c[0]+','+c[1]+','+c[2]+')"></span>'}).join('');
}

// ── hover / shimmer ───────────────────────────────────────
function accPalette(card,cfg){
  var m=cfg.hover.accentMode;
  if(m==='extract')return card._pal;
  var base=(card._pal||[]).slice();
  var a1=hexToRgb(cfg.hover.acc1);
  if(m==='dual'){var a2=hexToRgb(cfg.hover.acc2);return base.concat([a1,a2])}
  return base.concat([a1]);
}

function shimmerFrame(card,blend){
  if(!card._px||!card._cfg)return;
  var cfg=card._cfg,w=card._w,h=card._h,inten=cfg.hover.intensity;
  var canvas=card.querySelector('canvas');if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var noisy=new Float32Array(card._px);
  for(var i=0;i<noisy.length;i++)noisy[i]+=(Math.random()-.5)*inten*2;
  var base=runDither(noisy,w,h,card._pal,card._plab,cfg.dither.technique);
  if(blend>0&&cfg.hover.reveal){
    var ap=accPalette(card,cfg);
    var al=ap.map(function(c){return rgbToLab(c[0],c[1],c[2])});
    var acc=runDither(noisy,w,h,ap,al,cfg.dither.technique);
    var t=blend*cfg.hover.revealPct/100,blended=new Uint8ClampedArray(w*h*4);
    for(var i=0;i<w*h*4;i+=4){
      blended[i]=Math.round(base[i]*(1-t)+acc[i]*t);
      blended[i+1]=Math.round(base[i+1]*(1-t)+acc[i+1]*t);
      blended[i+2]=Math.round(base[i+2]*(1-t)+acc[i+2]*t);
      blended[i+3]=255;
    }
    ctx.putImageData(new ImageData(blended,w,h),0,0);
  }else{ctx.putImageData(new ImageData(base,w,h),0,0)}
}

function attachHover(card){
  var active=false,blend=0,raf=null,to=null;
  var lt=card.querySelector('.lt');
  function fps(){return card._cfg?card._cfg.hover.fps:8}
  function tick(){
    shimmerFrame(card,blend);
    to=setTimeout(function(){raf=requestAnimationFrame(tick)},1000/fps());
  }
  lt.addEventListener('mouseenter',function(){
    if(!card._cfg||!card._cfg.hover.shimmer)return;
    active=true;clearTimeout(to);if(raf)cancelAnimationFrame(raf);
    function fi(){blend=Math.min(1,blend+0.1);shimmerFrame(card,blend);
      if(blend<1&&active)to=setTimeout(function(){raf=requestAnimationFrame(fi)},1000/fps());
      else if(active)to=setTimeout(function(){raf=requestAnimationFrame(tick)},1000/fps());
    }raf=requestAnimationFrame(fi);
  });
  lt.addEventListener('mouseleave',function(){
    active=false;clearTimeout(to);if(raf)cancelAnimationFrame(raf);
    function fo(){blend=Math.max(0,blend-0.15);shimmerFrame(card,blend);
      if(blend>0)to=setTimeout(function(){raf=requestAnimationFrame(fo)},1000/fps());
    }raf=requestAnimationFrame(fo);
  });
}

// ── re-render all ─────────────────────────────────────────
var renderTimer=null;
function readCfg(){
  function v(id){return document.getElementById(id)}
  return{
    image:{brightness:+v('i-bright').value,shadows:+v('i-shadows').value,gamma:+v('i-gamma').value/100,contrast:+v('i-contrast').value/100,blur:v('i-blur')?+v('i-blur').value:1},
    dither:{technique:v('i-tech').value,width:+v('i-width').value},
    palette:{mode:v('i-pmode').value,colors:+v('i-pcolors').value,pastel:+v('i-pastel').value,lightness:+v('i-light').value,
      monoHue:v('i-monohue').value,tintHue:v('i-tinthue').value,fixedExtras:v('i-fixedx').value,
      duo1:v('i-duo1').value,duo2:v('i-duo2').value,cus1:v('i-cus1').value,cus2:v('i-cus2').value,cus3:v('i-cus3').value},
    baseTones:{enabled:v('i-basetones').checked,cream:v('i-cream').value,charcoal:v('i-charcoal').value},
    sharedPalette:{enabled:v('i-shared').checked,pool:+v('i-pool').value},
    hover:{shimmer:v('i-shimmer').checked,fps:+v('i-fps').value,intensity:+v('i-inten').value,reveal:v('i-reveal').checked,
      accentMode:v('i-amode').value,acc1:v('i-acc1').value,acc2:v('i-acc2').value,revealPct:+v('i-revpct').value}
  };
}

function rerenderAll(){
  var cfg=readCfg();
  var cards=[...document.querySelectorAll('.lc')];
  var sharedPal=null;
  if(cfg.sharedPalette.enabled){
    var allSamples=[];
    cards.forEach(function(card){
      var img=card.querySelector('img');
      if(!img||!img.complete||!img.naturalWidth)return;
      var sd=sampleCard(card,img,cfg.dither.width,Math.round(cfg.dither.width*9/16));
      allSamples=allSamples.concat(sd.samples);
    });
    if(allSamples.length)sharedPal=buildPalette(cfg,allSamples);
  }
  cards.forEach(function(card){
    var img=card.querySelector('img');
    if(!img||!img.complete||!img.naturalWidth)return;
    renderCard(card,cfg,sharedPal);
  });
}

function scheduleRerender(){clearTimeout(renderTimer);renderTimer=setTimeout(rerenderAll,180)}

// ── thumbnail loading ─────────────────────────────────────
document.querySelectorAll('.lc').forEach(function(card){
  attachHover(card);
  var vid=card.dataset.vid,vtype=card.dataset.vtype;
  var img=document.createElement('img');
  img.crossOrigin='anonymous';
  card.querySelector('.lt').appendChild(img);
  img.addEventListener('load',function(){
    var cfg=readCfg();
    var sd=sampleCard(card,img,cfg.dither.width,Math.round(cfg.dither.width*9/16));
    var pal=buildPalette(cfg,sd.samples);
    renderCard(card,cfg,pal);
  });
  if(vtype==='youtube'){
    img.src='https://img.youtube.com/vi/'+vid+'/hqdefault.jpg';
  }else{
    fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+vid)
      .then(function(r){return r.json()})
      .then(function(data){
        var u=data.thumbnail_url||'';
        img.src=u.replace(/_[0-9]+x[0-9]+/,'_640')||(('https://vumbnail.com/'+vid+'.jpg'));
      })
      .catch(function(){img.src='https://vumbnail.com/'+vid+'.jpg'});
  }
});

// ── UI wiring ─────────────────────────────────────────────
// duo presets
var dp=document.getElementById('i-duopreset');
DUO.forEach(function(p,i){var o=document.createElement('option');o.value=i;o.textContent=p.name;dp.appendChild(o)});
dp.addEventListener('change',function(){var p=DUO[+dp.value];document.getElementById('i-duo1').value=p.c1;document.getElementById('i-duo2').value=p.c2});

// panel toggle
document.getElementById('panel-bar').addEventListener('click',function(){
  var pb=document.getElementById('panel-body'),icon=document.getElementById('ptoggle'),panel=document.getElementById('panel');
  pb.classList.toggle('open');icon.textContent=pb.classList.contains('open')?'▾':'▸';
  requestAnimationFrame(function(){document.getElementById('grid-wrap').style.paddingTop=(panel.offsetHeight+16)+'px'});
});

// palette mode visibility
function updPMode(){
  var m=document.getElementById('i-pmode').value;
  ['mono','tint','fixed','duo','custom'].forEach(function(n){
    var el=document.getElementById('pc-'+n);if(el)el.classList.toggle('vis',n===m);
  });
}
document.getElementById('i-pmode').addEventListener('change',updPMode);
updPMode();

// toggles
document.getElementById('i-basetones').addEventListener('change',function(){
  document.getElementById('pc-basetones').classList.toggle('vis',this.checked)});
document.getElementById('i-shared').addEventListener('change',function(){
  document.getElementById('pc-shared').classList.toggle('vis',this.checked)});
function updAMode(){document.getElementById('pc-acc2').classList.toggle('vis',document.getElementById('i-amode').value==='dual')}
document.getElementById('i-amode').addEventListener('change',updAMode);updAMode();

// slider labels
[['i-bright','v-bright',1,''],['i-shadows','v-shadows',1,''],['i-gamma','v-gamma',100,''],['i-contrast','v-contrast',100,''],['i-blur','v-blur',1,''],
 ['i-width','v-width',1,'px'],['i-pcolors','v-pcolors',1,''],['i-pastel','v-pastel',1,'%'],['i-light','v-light',1,'%'],
 ['i-pool','v-pool',1,''],['i-fps','v-fps',1,''],['i-inten','v-inten',1,''],['i-revpct','v-revpct',1,'%']
].forEach(function(row){
  var inp=document.getElementById(row[0]),sp=document.getElementById(row[1]);
  if(!inp||!sp)return;
  function upd(){sp.textContent=(row[2]>1?(parseFloat(inp.value)/row[2]).toFixed(2):inp.value)+row[3]}
  inp.addEventListener('input',upd);upd();
});

// wire all controls
document.querySelectorAll('#panel-body input,#panel-body select').forEach(function(el){
  el.addEventListener('input',scheduleRerender);el.addEventListener('change',scheduleRerender);
});

// render button (immediate, bypasses debounce)
var renderBtn=document.getElementById('render-btn');if(renderBtn)renderBtn.addEventListener('click',rerenderAll);

// ── bake ─────────────────────────────────────────────────
function getAuthHeader(){
  var u=prompt('Admin username (or cancel to abort):');if(!u)return null;
  var p=prompt('Admin password:');if(p===null)return null;
  return 'Basic '+btoa(u+':'+p);
}
var _authHeader=null;
function ensureAuth(){
  if(_authHeader)return _authHeader;
  _authHeader=getAuthHeader();
  return _authHeader;
}

function bakeCard(card,auth){
  return new Promise(function(resolve){
    var canvas=card.querySelector('canvas');
    if(!canvas){resolve({ok:false,reason:'no canvas'});return}
    var id=card.dataset.id;
    if(!id){resolve({ok:false,reason:'no id'});return}
    var img=card.querySelector('img');
    if(!img||!img.complete||!img.naturalWidth){resolve({ok:false,reason:'no image'});return}

    // Capture blur version (current render)
    var blurData=canvas.toDataURL('image/png');

    // Render sharp version (blur=0, same everything else)
    var cfg=readCfg();
    var sharpCfg=JSON.parse(JSON.stringify(cfg));
    sharpCfg.image.blur=0;
    var w=sharpCfg.dither.width,h=Math.round(w*9/16);
    var sd=sampleCard(card,img,w,h);
    var pal=buildPalette(sharpCfg,sd.samples);
    renderCard(card,sharpCfg,pal);
    var sharpData=canvas.toDataURL('image/png');

    // Restore blur render
    var origSd=sampleCard(card,img,cfg.dither.width,Math.round(cfg.dither.width*9/16));
    var origPal=buildPalette(cfg,origSd.samples);
    renderCard(card,cfg,origPal);

    fetch('/thumb/'+id,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':auth},
      body:JSON.stringify({blurData:blurData,sharpData:sharpData,settings:cfg})
    }).then(function(r){return r.json()}).then(function(data){
      if(data.ok){
        var dot=card.querySelector('.ldot');
        if(dot){dot.classList.add('baked');dot.title='baked'}
        card.dataset.hasThumb='1';
        var btn=card.querySelector('.lbake-btn');
        if(btn){btn.textContent='✓';btn.classList.add('saved');setTimeout(function(){btn.textContent='bake';btn.classList.remove('saved')},2000)}
      }
      resolve(data);
    }).catch(function(e){resolve({ok:false,reason:e.message})});
  });
}

var bakeAllBtn=document.getElementById('bake-all-btn');
if(bakeAllBtn){
  bakeAllBtn.addEventListener('click',function(){
    var auth=ensureAuth();if(!auth)return;
    var cards=[...document.querySelectorAll('.lc')].filter(function(c){return c.querySelector('canvas')});
    var total=cards.length,done=0;
    bakeAllBtn.disabled=true;
    bakeAllBtn.textContent='baking 0/'+total+'...';
    (function next(){
      if(done>=total){bakeAllBtn.textContent='✓ all baked ('+total+')';bakeAllBtn.disabled=false;return}
      var card=cards[done];
      bakeAllBtn.textContent='baking '+(done+1)+'/'+total+'...';
      bakeCard(card,auth).then(function(){done++;next()});
    })();
  });
}

document.querySelectorAll('.lbake-btn').forEach(function(btn){
  btn.addEventListener('click',function(){
    var auth=ensureAuth();if(!auth)return;
    var card=btn.closest('.lc');
    btn.textContent='...';btn.disabled=true;
    bakeCard(card,auth).then(function(){btn.disabled=false});
  });
});

// copy settings
document.getElementById('copy-btn').addEventListener('click',function(){
  var c=readCfg();
  var obj={
    image:{brightness:c.image.brightness,shadows:c.image.shadows,gamma:c.image.gamma,contrast:c.image.contrast,blur:c.image.blur},
    dither:{technique:c.dither.technique,width:c.dither.width},
    palette:Object.assign({mode:c.palette.mode,colors:c.palette.colors,pastel:c.palette.pastel,lightness:c.palette.lightness},
      c.palette.mode==='mono'?{hue:c.palette.monoHue}:{},
      c.palette.mode==='tint'?{hue:c.palette.tintHue}:{},
      c.palette.mode==='fixed'?{extras:c.palette.fixedExtras}:{},
      c.palette.mode==='duo'?{color1:c.palette.duo1,color2:c.palette.duo2}:{},
      c.palette.mode==='custom'?{color1:c.palette.cus1,color2:c.palette.cus2,color3:c.palette.cus3}:{}),
    baseTones:{enabled:c.baseTones.enabled,cream:hexToRgb(c.baseTones.cream),charcoal:hexToRgb(c.baseTones.charcoal)},
    hover:Object.assign({shimmer:c.hover.shimmer,fps:c.hover.fps,intensity:c.hover.intensity,hiddenColor:c.hover.reveal,
      accentMode:c.hover.accentMode,accent1:c.hover.acc1,revealPct:c.hover.revealPct},
      c.hover.accentMode==='dual'?{accent2:c.hover.acc2}:{})
  };
  document.getElementById('mjson').value=JSON.stringify(obj,null,2);
  document.getElementById('modal').classList.add('open');
  setTimeout(function(){document.getElementById('mjson').select()},50);
});
function rgbArrToHex(v){if(!Array.isArray(v))return v;return'#'+v.map(function(n){return Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0')}).join('')}
function setVal(id,v){var el=document.getElementById(id);if(el)el.value=v}
function setChk(id,v){var el=document.getElementById(id);if(el)el.checked=!!v}

function applySettings(json){
  var c;
  try{c=JSON.parse(json)}catch(ex){document.getElementById('merr').textContent='invalid JSON';return}
  document.getElementById('merr').textContent='';
  if(c.image){
    if(c.image.brightness!==undefined)setVal('i-bright',c.image.brightness);
    if(c.image.shadows!==undefined)setVal('i-shadows',c.image.shadows);
    if(c.image.gamma!==undefined)setVal('i-gamma',Math.round(c.image.gamma*100));
    if(c.image.contrast!==undefined)setVal('i-contrast',Math.round(c.image.contrast*100));
    if(c.image.blur!==undefined)setVal('i-blur',c.image.blur);
  }
  if(c.dither){
    if(c.dither.technique)setVal('i-tech',c.dither.technique);
    if(c.dither.width)setVal('i-width',c.dither.width);
  }
  if(c.palette){
    if(c.palette.mode)setVal('i-pmode',c.palette.mode);
    if(c.palette.colors)setVal('i-pcolors',c.palette.colors);
    if(c.palette.pastel!==undefined)setVal('i-pastel',c.palette.pastel);
    if(c.palette.lightness!==undefined)setVal('i-light',c.palette.lightness);
    if(c.palette.hue){setVal('i-monohue',c.palette.hue);setVal('i-tinthue',c.palette.hue)}
    if(c.palette.extras)setVal('i-fixedx',c.palette.extras);
    if(c.palette.color1){setVal('i-duo1',c.palette.color1);setVal('i-cus1',c.palette.color1)}
    if(c.palette.color2){setVal('i-duo2',c.palette.color2);setVal('i-cus2',c.palette.color2)}
    if(c.palette.color3)setVal('i-cus3',c.palette.color3);
  }
  if(c.baseTones){
    setChk('i-basetones',c.baseTones.enabled);
    document.getElementById('pc-basetones').classList.toggle('vis',!!c.baseTones.enabled);
    if(c.baseTones.cream)setVal('i-cream',rgbArrToHex(c.baseTones.cream));
    if(c.baseTones.charcoal)setVal('i-charcoal',rgbArrToHex(c.baseTones.charcoal));
  }
  if(c.hover){
    setChk('i-shimmer',c.hover.shimmer);
    if(c.hover.fps)setVal('i-fps',c.hover.fps);
    if(c.hover.intensity)setVal('i-inten',c.hover.intensity);
    setChk('i-reveal',c.hover.hiddenColor);
    if(c.hover.accentMode)setVal('i-amode',c.hover.accentMode);
    if(c.hover.accent1)setVal('i-acc1',c.hover.accent1);
    if(c.hover.accent2)setVal('i-acc2',c.hover.accent2);
    if(c.hover.revealPct)setVal('i-revpct',c.hover.revealPct);
  }
  // refresh all labels and conditional visibility
  document.querySelectorAll('#panel-body input[type=range]').forEach(function(el){el.dispatchEvent(new Event('input'))});
  updPMode();updAMode();
  document.getElementById('modal').classList.remove('open');
  rerenderAll();
}

document.getElementById('mapply').addEventListener('click',function(){applySettings(document.getElementById('mjson').value)});
document.getElementById('mclose').addEventListener('click',function(){document.getElementById('modal').classList.remove('open')});
document.getElementById('modal').addEventListener('click',function(e){if(e.target===this)this.classList.remove('open')});
