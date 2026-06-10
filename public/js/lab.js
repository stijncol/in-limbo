// ── color utils ──────────────────────────────────────────
function hexToRgb(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function hslToRgb(h,s,l){
  var c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2,r,g,b;
  if(h<60){r=c;g=x;b=0}else if(h<120){r=x;g=c;b=0}else if(h<180){r=0;g=c;b=x}
  else if(h<240){r=0;g=x;b=c}else if(h<300){r=x;g=0;b=c}else{r=c;g=0;b=x}
  return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  var mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,h=0,s=0,l=(mx+mn)/2;
  if(d>0){s=d/(1-Math.abs(2*l-1));
    if(mx===r)h=((g-b)/d+6)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}
  return[h,s,l];
}
function rgbToLab(r,g,b){
  function lin(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
  var lr=lin(r),lg=lin(g),lb=lin(b);
  var x=lr*0.4124564+lg*0.3575761+lb*0.1804375,y=lr*0.2126729+lg*0.7151522+lb*0.0721750,z=lr*0.0193339+lg*0.1191920+lb*0.9503041;
  function f(t){return t>0.008856?Math.cbrt(t):7.787*t+16/116}
  var fx=f(x/0.95047),fy=f(y),fz=f(z/1.08883);
  return[116*fy-16,500*(fx-fy),200*(fy-fz)];
}
function labToRgb(L,a,b){
  var fy=(L+16)/116,fx=a/500+fy,fz=fy-b/200;
  function inv(t){return t>0.206897?t*t*t:(t-16/116)/7.787}
  var x=inv(fx)*0.95047,y=inv(fy),z=inv(fz)*1.08883;
  function sg(v){return v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055}
  return[Math.max(0,Math.min(255,Math.round(sg(x*3.2404542-y*1.5371385-z*0.4985314)*255))),
         Math.max(0,Math.min(255,Math.round(sg(-x*0.9692660+y*1.8760108+z*0.0415560)*255))),
         Math.max(0,Math.min(255,Math.round(sg(x*0.0556434-y*0.2040259+z*1.0572252)*255)))];
}
function labDist(a,b){var d0=a[0]-b[0],d1=a[1]-b[1],d2=a[2]-b[2];return Math.sqrt(d0*d0+d1*d1+d2*d2)}

// ── palette ──────────────────────────────────────────────
function kMeans(pixels,k){
  var labs=pixels.map(function(p){return rgbToLab(p[0],p[1],p[2])});
  var n=labs.length;
  if(!n)return Array.from({length:k},function(){return[128,128,128]});
  var cens=[labs[Math.floor(Math.random()*n)]];
  while(cens.length<k){
    var ds=labs.map(function(p){return Math.min.apply(null,cens.map(function(c){return labDist(p,c)}))});
    var s=ds.reduce(function(a,b){return a+b},0),rv=Math.random()*s,ch=labs[n-1];
    for(var i=0;i<n;i++){rv-=ds[i];if(rv<=0){ch=labs[i];break}}
    cens.push(ch);
  }
  for(var iter=0;iter<20;iter++){
    var sums=Array.from({length:k},function(){return[0,0,0]}),cnts=new Array(k).fill(0);
    for(var pi=0;pi<n;pi++){
      var bd=Infinity,bi=0;
      for(var ci=0;ci<k;ci++){var d=labDist(labs[pi],cens[ci]);if(d<bd){bd=d;bi=ci}}
      sums[bi][0]+=labs[pi][0];sums[bi][1]+=labs[pi][1];sums[bi][2]+=labs[pi][2];cnts[bi]++;
    }
    var moved=false;
    for(var ci=0;ci<k;ci++){
      if(cnts[ci]>0){var nc=[sums[ci][0]/cnts[ci],sums[ci][1]/cnts[ci],sums[ci][2]/cnts[ci]];if(labDist(nc,cens[ci])>0.5)moved=true;cens[ci]=nc;}
    }
    if(!moved)break;
  }
  return cens.map(function(c){return labToRgb(c[0],c[1],c[2])});
}

function toPastel(rgb,str){
  var hsl=rgbToHsl(rgb[0],rgb[1],rgb[2]);
  var s=hsl[1]*(1-str*0.7),l=Math.min(0.95,hsl[2]+(0.85-hsl[2])*str*0.6);
  return hslToRgb(hsl[0],s,l);
}
function adjustL(rgb,tgt){
  var hsl=rgbToHsl(rgb[0],rgb[1],rgb[2]);
  var l=Math.max(0.04,Math.min(0.97,hsl[2]+(tgt/100-0.5)*0.6));
  return hslToRgb(hsl[0],hsl[1],l);
}
function genShades(base,n,pastel,light){
  var hsl=rgbToHsl(base[0],base[1],base[2]),shades=[];
  for(var i=0;i<n;i++){
    var t=n===1?0.5:i/(n-1),l=0.85-t*0.65;
    var rgb=hslToRgb(hsl[0],hsl[1],l);
    rgb=toPastel(rgb,pastel/100);rgb=adjustL(rgb,light);
    shades.push(rgb);
  }
  return shades;
}

var DUO=[
  {name:'navy + clay',c1:'#3C3C78',c2:'#82412D'},{name:'indigo + sand',c1:'#2B3A67',c2:'#C4956A'},
  {name:'forest + dusty rose',c1:'#2D5A46',c2:'#A0707A'},{name:'slate + terracotta',c1:'#4A6670',c2:'#B0704A'},
  {name:'teal + warm stone',c1:'#2A6B6B',c2:'#8A8070'},{name:'prussian + gold',c1:'#1E3A5F',c2:'#C9A84C'},
  {name:'olive + mauve',c1:'#5C6B3C',c2:'#8B6B8A'},{name:'charcoal + sage',c1:'#3C4040',c2:'#7A9A7A'},
  {name:'burgundy + linen',c1:'#6B2D3E',c2:'#B8A898'},{name:'ocean + coral',c1:'#2E5C6E',c2:'#C07860'},
  {name:'plum + honey',c1:'#5A4A78',c2:'#B89A60'},{name:'ink + amber',c1:'#3A3A3A',c2:'#C4A070'}
];

function buildPalette(cfg,samples){
  var m=cfg.palette.mode,n=cfg.palette.colors,p=cfg.palette.pastel,l=cfg.palette.lightness,cols=[];
  if(m==='kmeans'){cols=kMeans(samples.length?samples:[[128,128,128]],n);}
  else if(m==='fixed'){
    var bases={warm:[[60,60,120],[40,90,70],[130,65,45],[200,160,100],[248,245,238]],
               cool:[[40,70,120],[60,120,140],[80,80,100],[140,160,180],[240,244,248]],
               neutral:[[80,80,80],[120,100,80],[160,140,120],[200,190,178],[244,240,234]]};
    cols=(bases[cfg.palette.fixedExtras]||bases.warm).slice(0,n).map(function(c){return adjustL(toPastel(c,p/100),l)});
  }
  else if(m==='mono'){cols=genShades(hexToRgb(cfg.palette.monoHue),n,p,l);}
  else if(m==='tint'){cols=genShades(hexToRgb(cfg.palette.tintHue),Math.max(1,n-1),p,l);cols.push([255,255,255]);}
  else if(m==='duo'){
    var h1=Math.ceil(n/2),h2=Math.floor(n/2);
    cols=genShades(hexToRgb(cfg.palette.duo1),h1,p,l).concat(genShades(hexToRgb(cfg.palette.duo2),h2,p,l));
  }
  else if(m==='custom'){
    var cs=[hexToRgb(cfg.palette.cus1),hexToRgb(cfg.palette.cus2),hexToRgb(cfg.palette.cus3)];
    var each=Math.ceil(n/3);
    cols=cs[0].length?genShades(cs[0],each,p,l).concat(genShades(cs[1],each,p,l)).concat(genShades(cs[2],Math.max(0,n-each*2),p,l)).slice(0,n):[];
  }
  if(cfg.baseTones.enabled){cols=[hexToRgb(cfg.baseTones.cream)].concat(cols).concat([hexToRgb(cfg.baseTones.charcoal)]);}
  cols.sort(function(a,b){return(b[0]*.299+b[1]*.587+b[2]*.114)-(a[0]*.299+a[1]*.587+a[2]*.114)});
  return cols;
}

// ── preprocess ───────────────────────────────────────────
function preprocess(imageData,cfg){
  var d=imageData.data,w=imageData.width,h=imageData.height;
  var br=cfg.image.brightness,sh=cfg.image.shadows,ga=cfg.image.gamma,co=cfg.image.contrast,bl=cfg.image.blur||0;
  var res=new Float32Array(w*h*3);
  for(var i=0;i<d.length;i+=4){
    var r=d[i],g=d[i+1],b=d[i+2];
    if(sh>0){r=sh+r*(255-sh)/255;g=sh+g*(255-sh)/255;b=sh+b*(255-sh)/255}
    r=Math.max(0,Math.min(255,r+br));g=Math.max(0,Math.min(255,g+br));b=Math.max(0,Math.min(255,b+br));
    if(ga!==1){r=255*Math.pow(r/255,1/ga);g=255*Math.pow(g/255,1/ga);b=255*Math.pow(b/255,1/ga)}
    if(co!==1){r=((r/255-.5)*co+.5)*255;g=((g/255-.5)*co+.5)*255;b=((b/255-.5)*co+.5)*255}
    var j=i/4*3;res[j]=Math.max(0,Math.min(255,r));res[j+1]=Math.max(0,Math.min(255,g));res[j+2]=Math.max(0,Math.min(255,b));
  }
  if(bl>0){
    var tmp=new Float32Array(w*h*3);
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var sr=0,sg=0,sb=0,cnt=0;
      for(var dx=-bl;dx<=bl;dx++){var nx=x+dx<0?0:x+dx>=w?w-1:x+dx,j=(y*w+nx)*3;sr+=res[j];sg+=res[j+1];sb+=res[j+2];cnt++}
      var k=(y*w+x)*3;tmp[k]=sr/cnt;tmp[k+1]=sg/cnt;tmp[k+2]=sb/cnt;
    }
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var sr=0,sg=0,sb=0,cnt=0;
      for(var dy=-bl;dy<=bl;dy++){var ny=y+dy<0?0:y+dy>=h?h-1:y+dy,j=(ny*w+x)*3;sr+=tmp[j];sg+=tmp[j+1];sb+=tmp[j+2];cnt++}
      var k=(y*w+x)*3;res[k]=sr/cnt;res[k+1]=sg/cnt;res[k+2]=sb/cnt;
    }
  }
  return res;
}

// ── nearest color ─────────────────────────────────────────
function nearest(r,g,b,pal,plab){
  var px=rgbToLab(r,g,b),bd=Infinity,bi=0;
  for(var i=0;i<plab.length;i++){var d=labDist(px,plab[i]);if(d<bd){bd=d;bi=i}}
  return bi;
}

// ── dither algorithms ─────────────────────────────────────
var BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

function applyFS(px,w,h,pal,plab){
  var buf=new Float32Array(px),out=new Uint8ClampedArray(w*h*4);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var idx=y*w+x,i3=idx*3;
    var r=Math.max(0,Math.min(255,buf[i3])),g=Math.max(0,Math.min(255,buf[i3+1])),b=Math.max(0,Math.min(255,buf[i3+2]));
    var ci=nearest(r,g,b,pal,plab),nr=pal[ci][0],ng=pal[ci][1],nb=pal[ci][2];
    var er=r-nr,eg=g-ng,eb=b-nb;
    function add(ii,f){if(ii>=0&&ii<w*h){buf[ii*3]+=er*f;buf[ii*3+1]+=eg*f;buf[ii*3+2]+=eb*f}}
    if(x+1<w)add(idx+1,7/16);if(y+1<h&&x>0)add(idx+w-1,3/16);if(y+1<h)add(idx+w,5/16);if(y+1<h&&x+1<w)add(idx+w+1,1/16);
    out[idx*4]=nr;out[idx*4+1]=ng;out[idx*4+2]=nb;out[idx*4+3]=255;
  }
  return out;
}

function applyAtkinson(px,w,h,pal,plab){
  var buf=new Float32Array(px),out=new Uint8ClampedArray(w*h*4);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var idx=y*w+x,i3=idx*3;
    var r=Math.max(0,Math.min(255,buf[i3])),g=Math.max(0,Math.min(255,buf[i3+1])),b=Math.max(0,Math.min(255,buf[i3+2]));
    var ci=nearest(r,g,b,pal,plab),nr=pal[ci][0],ng=pal[ci][1],nb=pal[ci][2];
    var er=r-nr,eg=g-ng,eb=b-nb;
    function add2(ii,f){if(ii>=0&&ii<w*h){buf[ii*3]+=er*f;buf[ii*3+1]+=eg*f;buf[ii*3+2]+=eb*f}}
    if(x+1<w)add2(idx+1,1/8);if(x+2<w)add2(idx+2,1/8);if(y+1<h&&x>0)add2(idx+w-1,1/8);
    if(y+1<h)add2(idx+w,1/8);if(y+1<h&&x+1<w)add2(idx+w+1,1/8);if(y+2<h)add2(idx+2*w,1/8);
    out[idx*4]=nr;out[idx*4+1]=ng;out[idx*4+2]=nb;out[idx*4+3]=255;
  }
  return out;
}

function applyOrdered(px,w,h,pal,plab){
  var out=new Uint8ClampedArray(w*h*4);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var idx=y*w+x,bv=(BAYER[(y%4)*4+(x%4)]/16-.5)*60;
    var r=Math.max(0,Math.min(255,px[idx*3]+bv)),g=Math.max(0,Math.min(255,px[idx*3+1]+bv)),b=Math.max(0,Math.min(255,px[idx*3+2]+bv));
    var ci=nearest(r,g,b,pal,plab);
    out[idx*4]=pal[ci][0];out[idx*4+1]=pal[ci][1];out[idx*4+2]=pal[ci][2];out[idx*4+3]=255;
  }
  return out;
}

function applyChSep(px,w,h,pal,plab){
  var n=pal.length,k=w*h,dens=[];
  for(var c=0;c<n;c++)dens.push(new Float32Array(k));
  for(var i=0;i<k;i++){
    var r=px[i*3],g=px[i*3+1],b=px[i*3+2],pl=rgbToLab(r,g,b);
    var ds=plab.map(function(c){return labDist(pl,c)});
    var mxD=Math.max.apply(null,ds),mnD=Math.min.apply(null,ds),rng=mxD-mnD||1;
    var ws=ds.map(function(d){var w=1-(d-mnD)/rng;return w*w}),sm=ws.reduce(function(a,b){return a+b},0)||1;
    for(var c=0;c<n;c++)dens[c][i]=ws[c]/sm;
  }
  var plates=[];
  for(var c=0;c<n;c++){
    var d=new Float32Array(dens[c]),pl=new Uint8Array(k);
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var ii=y*w+x,old=d[ii],nw=old>0.5?1:0;pl[ii]=nw;var err=old-nw;
      if(x+1<w)d[ii+1]+=err*7/16;if(y+1<h&&x>0)d[ii+w-1]+=err*3/16;if(y+1<h)d[ii+w]+=err*5/16;if(y+1<h&&x+1<w)d[ii+w+1]+=err*1/16;
    }
    plates.push(pl);
  }
  var out=new Uint8ClampedArray(k*4);
  for(var i=0;i<k;i++){
    var r=255,g=255,b=255;
    for(var c=0;c<n;c++){if(plates[c][i]){r=Math.round(r*pal[c][0]/255);g=Math.round(g*pal[c][1]/255);b=Math.round(b*pal[c][2]/255)}}
    out[i*4]=r;out[i*4+1]=g;out[i*4+2]=b;out[i*4+3]=255;
  }
  return out;
}

function runDither(px,w,h,pal,plab,tech){
  var pl=plab||pal.map(function(c){return rgbToLab(c[0],c[1],c[2])});
  if(tech==='atkinson')return applyAtkinson(px,w,h,pal,pl);
  if(tech==='ordered')return applyOrdered(px,w,h,pal,pl);
  if(tech==='chsep')return applyChSep(px,w,h,pal,pl);
  return applyFS(px,w,h,pal,pl);
}

// ── card rendering ────────────────────────────────────────
function sampleCard(card,img,w,h){
  var tc=document.createElement('canvas');tc.width=w;tc.height=h;
  var tx=tc.getContext('2d');
  var ir=img.naturalWidth/img.naturalHeight,cr=w/h;
  var sx=0,sy=0,sw=img.naturalWidth,sh=img.naturalHeight;
  if(ir>cr){sw=img.naturalHeight*cr;sx=(img.naturalWidth-sw)/2}else{sh=img.naturalWidth/cr;sy=(img.naturalHeight-sh)/2}
  tx.drawImage(img,sx,sy,sw,sh,0,0,w,h);
  var d=tx.getImageData(0,0,w,h).data,samples=[];
  for(var i=0;i<d.length;i+=4*10)samples.push([d[i],d[i+1],d[i+2]]);
  return{raw:tx.getImageData(0,0,w,h),samples:samples};
}

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
