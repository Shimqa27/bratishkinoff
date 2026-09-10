/* ============================================================
   HERO SCENE — two-photo cursor reveal (Canvas2D)

   bratishkin1.png sits as the base portrait, always visible.
   bratishkin2.png is layered exactly over it and is only ever
   shown through a soft "liquid" mask painted along the pointer's
   recent path — the mask fades a little every frame, so the
   second photo only shows where the cursor has *just* been.
   Both PNGs already ship with a real alpha channel (transparent
   background), so they composite directly with no colour-keying.
   ============================================================ */

function getSceneTier(){
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const width = window.innerWidth;
  const name = (width < 768 || (coarse && width < 1024)) ? 'mobile' : (coarse || width < 1280) ? 'tablet' : 'desktop';
  const mobile = name === 'mobile';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    name, mobile, coarsePointer: coarse, reducedMotion,
    maxDpr: mobile ? 1.5 : (name === 'tablet' ? 1.75 : 2),
    frameInterval: name === 'desktop' ? 0 : (1000 / 60 - 2),
    pointerEnabled: !coarse && !reducedMotion,
    // No mouse to trail on a touch device — a slow idle sweep stands in for
    // it, so the effect still shows itself. Off entirely under reduced motion.
    autoSweep: coarse && !reducedMotion,
    freeze: reducedMotion,
  };
}

function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

/* A wandering path for the idle sweep — three lazy loops so it reads as a
   hand dragging the reveal across the face rather than a mechanical orbit. */
function sweepPoint(cycle){
  const a = cycle * Math.PI * 2;
  const x = 0.60 + Math.sin(a) * 0.24;
  const y = 0.46 + Math.sin(a * 1.7 + 1.3) * 0.20;
  return { x, y };
}

export class HeroScene{
  constructor(canvas, opts = {}){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._tier = getSceneTier();

    this.baseSrc = opts.baseSrc || './img/bratishkin1.png';
    this.revealSrc = opts.revealSrc || './img/bratishkin2.png';

    this.ready = false;
    this.onReady = null;
    this.disposed = false;
    this._frozen = false;

    this.width = 0; this.height = 0; this.dpr = 1;

    this.pointer = { x: 0, y: 0 };
    this.smoothed = { x: 0, y: 0 };
    this.lastSmoothed = { x: 0, y: 0 };
    this.pointerSeen = false;
    this.pace = 0;

    this.intro = 0;
    this.startTime = null;
    this.riseStarted = false;
    this.riseAt = null;
    this._lastT = 0;
    this._sweepClock = 0;

    this._maskCanvas = document.createElement('canvas');
    this._maskCtx = this._maskCanvas.getContext('2d');
    this._compositeCanvas = document.createElement('canvas');
    this._compositeCtx = this._compositeCanvas.getContext('2d');

    if(!this._tier.pointerEnabled) this._parkPointer();

    Promise.all([loadImage(this.baseSrc), loadImage(this.revealSrc)])
      .then(([base, reveal]) => {
        if(this.disposed) return;
        this.baseImg = base;
        this.revealImg = reveal;
        this.ready = true;
        this.onReady && this.onReady();
      })
      .catch((err) => {
        console.error('HeroScene:', err.message);
        // Fail open — the veil must not hang forever on a bad asset path.
        this.ready = true;
        this.onReady && this.onReady();
      });
  }

  get tier(){ return this._tier; }

  retune(){
    this._tier = getSceneTier();
    if(!this._tier.pointerEnabled) this._parkPointer();
    return this._tier;
  }

  _parkPointer(){
    this.pointerSeen = false;
  }

  setPointer(xCss, yCss){
    this.pointer.x = xCss;
    this.pointer.y = yCss;
    if(!this.pointerSeen){
      this.pointerSeen = true;
      this.smoothed.x = xCss; this.smoothed.y = yCss;
      this.lastSmoothed.x = xCss; this.lastSmoothed.y = yCss;
    }
  }

  beginRise(){ this.riseStarted = true; }

  resize(width, height){
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this._tier.maxDpr);

    const bw = Math.round(this.width * this.dpr);
    const bh = Math.round(this.height * this.dpr);
    this.canvas.width = bw;
    this.canvas.height = bh;
    this._maskCanvas.width = bw;
    this._maskCanvas.height = bh;
    this._compositeCanvas.width = bw;
    this._compositeCanvas.height = bh;

    // A stretched leftover trail reads as a smear after a resize — clear it.
    this._maskCtx.clearRect(0, 0, bw, bh);

    if(this.ready) this._draw();
  }

  /* "Cover" the canvas with the image, biased toward keeping the head in
     frame (crop mostly comes off the shoulders, not the crown) and toward
     the right half of the canvas (the left rail is where the copy lives). */
  _fitRect(img){
    const cw = this.canvas.width, ch = this.canvas.height;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const marginX = (dw - cw) / 2;
    const marginY = (dh - ch) / 2;
    const shiftX = Math.min(marginX, cw * 0.16);
    const shiftY = Math.min(marginY, marginY * 0.82);
    const dx = (cw - dw) / 2 + shiftX;
    const dy = (ch - dh) / 2 + shiftY;
    return { dx, dy, dw, dh };
  }

  update(time){
    if(this.disposed || !this.ready) return;

    if(this._tier.freeze){
      if(this._frozen) return;
      this._frozen = true;
      this.intro = 1;
      this._draw();
      return;
    }

    if(this.startTime === null) this.startTime = time;
    const t = (time - this.startTime) / 1000;
    const dt = this._lastT ? Math.max(0, t - this._lastT) : 0;
    this._lastT = t;

    if(this.riseStarted){
      if(this.riseAt === null) this.riseAt = t;
      const u = Math.min(1, (t - this.riseAt) / 1.1);
      this.intro = 1 - (1 - u) * (1 - u);
    }

    if(this._tier.autoSweep){
      this._sweepClock += dt;
      const period = 6.5;
      const cycle = (this._sweepClock % period) / period;
      const pt = sweepPoint(cycle);
      this.pointer.x = pt.x * this.width;
      this.pointer.y = pt.y * this.height;
      this.pointerSeen = true;
    }

    this.smoothed.x += (this.pointer.x - this.smoothed.x) * 0.16;
    this.smoothed.y += (this.pointer.y - this.smoothed.y) * 0.16;

    const step = Math.hypot(this.smoothed.x - this.lastSmoothed.x, this.smoothed.y - this.lastSmoothed.y);
    const target = Math.min(1, step / 14);
    this.pace += (target - this.pace) * (target > this.pace ? 0.16 : 0.05);
    this.lastSmoothed.x = this.smoothed.x;
    this.lastSmoothed.y = this.smoothed.y;

    this._draw();
  }

  _draw(){
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    if(!cw || !ch || !this.baseImg) return;

    // 1. The trail mask fades a little every frame...
    const mctx = this._maskCtx;
    mctx.globalCompositeOperation = 'destination-out';
    mctx.fillStyle = 'rgba(0,0,0,0.05)';
    mctx.fillRect(0, 0, cw, ch);

    // 2. ...and gets a fresh soft brush stamped at the (smoothed) pointer,
    // sized a little larger while the pointer is moving fast.
    if(this.pointerSeen){
      mctx.globalCompositeOperation = 'source-over';
      const px = this.smoothed.x * this.dpr;
      const py = this.smoothed.y * this.dpr;
      const base = Math.min(cw, ch) * 0.15;
      const radius = base * (0.62 + this.pace * 0.85);
      const grad = mctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, 'rgba(255,255,255,0.6)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.28)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      mctx.fillStyle = grad;
      mctx.beginPath();
      mctx.arc(px, py, radius, 0, Math.PI * 2);
      mctx.fill();
    }

    // 3. Cut the second photo to that mask, off-screen...
    const cctx = this._compositeCtx;
    cctx.clearRect(0, 0, cw, ch);
    if(this.revealImg){
      const r = this._fitRect(this.revealImg);
      cctx.globalCompositeOperation = 'source-over';
      cctx.drawImage(this.revealImg, r.dx, r.dy, r.dw, r.dh);
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(this._maskCanvas, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
    }

    // 4. ...then lay the base photo down, and the masked second photo over it.
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalAlpha = this.intro;
    const rb = this._fitRect(this.baseImg);
    ctx.drawImage(this.baseImg, rb.dx, rb.dy, rb.dw, rb.dh);
    ctx.globalAlpha = 1;
    ctx.drawImage(this._compositeCanvas, 0, 0);
  }

  dispose(){
    this.disposed = true;
  }
}
