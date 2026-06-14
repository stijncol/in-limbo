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

// ── canonical baking settings ─────────────────────────────
// These mirror the default control values in the dither lab; they are the
// settings used to bake the production thumbnails. Change here = change the
// look of newly baked thumbnails everywhere (lab + admin auto-bake).
var DEFAULT_DITHER_CFG={
  image:{brightness:7,shadows:67,gamma:1.35,contrast:1.27,blur:2},
  dither:{technique:'fs',width:500},
  palette:{mode:'duo',colors:4,pastel:60,lightness:50,
    monoHue:'#3C5A78',tintHue:'#3C5A78',fixedExtras:'warm',
    duo1:'#5991a6',duo2:'#bab4b0',cus1:'#3C3C78',cus2:'#82412D',cus3:'#F8F5EE'},
  baseTones:{enabled:true,cream:'#ffffff',charcoal:'#787878'},
  sharedPalette:{enabled:false,pool:6},
  hover:{shimmer:true,fps:8,intensity:20,reveal:true,
    accentMode:'single',acc1:'#825A38',acc2:'#285A46',revealPct:15}
};

// Bake one source image into the blur + sharp PNG dataURLs the site serves.
// Same pipeline the lab uses: sample → palette → preprocess → dither.
function bakeImage(img,cfg){
  cfg=cfg||DEFAULT_DITHER_CFG;
  var w=cfg.dither.width,h=Math.round(w*9/16);
  var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  var ctx=canvas.getContext('2d');
  var sd=sampleCard(null,img,w,h);
  var pal=buildPalette(cfg,sd.samples);
  var plab=pal.map(function(c){return rgbToLab(c[0],c[1],c[2])});
  // blur version (the default render)
  var px=preprocess(sd.raw,cfg);
  var out=runDither(px,w,h,pal,plab,cfg.dither.technique);
  ctx.putImageData(new ImageData(out,w,h),0,0);
  var blurData=canvas.toDataURL('image/png');
  // sharp version: identical settings with blur disabled
  var sharpCfg=JSON.parse(JSON.stringify(cfg));sharpCfg.image.blur=0;
  var spx=preprocess(sd.raw,sharpCfg);
  var sout=runDither(spx,w,h,pal,plab,sharpCfg.dither.technique);
  ctx.putImageData(new ImageData(sout,w,h),0,0);
  var sharpData=canvas.toDataURL('image/png');
  return{blurData:blurData,sharpData:sharpData};
}

// Resolve the original colour thumbnail for a video and load it CORS-enabled
// so its pixels can be read into a canvas. Returns a Promise<HTMLImageElement>.
function loadSourceThumb(vid,vtype){
  return new Promise(function(resolve,reject){
    var img=new Image();
    img.crossOrigin='anonymous';
    img.onload=function(){resolve(img)};
    img.onerror=function(){reject(new Error('thumbnail load failed for '+vtype+'/'+vid))};
    if(vtype==='youtube'){
      img.src='https://img.youtube.com/vi/'+vid+'/hqdefault.jpg';
    }else{
      fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+vid)
        .then(function(r){return r.json()})
        .then(function(data){
          var u=data.thumbnail_url||'';
          img.src=u.replace(/_[0-9]+x[0-9]+/,'_640')||('https://vumbnail.com/'+vid+'.jpg');
        })
        .catch(function(){img.src='https://vumbnail.com/'+vid+'.jpg'});
    }
  });
}
