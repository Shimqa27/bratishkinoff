/* ============================================================
   SHARED TICKER — one rAF loop, reference counted
   ============================================================ */
const subscribers = new Set();
let rafId = null;

function loop(time){
  for(const sub of [...subscribers]){
    const interval = sub.getFramerate ? sub.getFramerate() : 0;
    if(time - sub.last > interval){
      sub.last = time;
      sub.callback(time);
    }
  }
  rafId = requestAnimationFrame(loop);
}

export function subscribe(callback, getFramerate){
  const sub = { callback, getFramerate: getFramerate || (() => 0), last: 0 };
  subscribers.add(sub);
  if(rafId === null) rafId = requestAnimationFrame(loop);
  return () => {
    subscribers.delete(sub);
    if(subscribers.size === 0 && rafId !== null){
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

/* ============================================================
   SPRING SOLVER — react-spring style damped spring
   ============================================================ */
export class Spring{
  constructor(config){
    this.tension = config.tension ?? 170;
    this.friction = config.friction ?? 26;
    this.mass = 1;
    this.value = config.from ?? 0;
    this.velocity = 0;
    this.target = config.to ?? this.value;
    this.precision = config.precision ?? 0.01;
    this.onChange = config.onChange || null;
    this.onRest = config.onRest || null;
    this.delay = config.delayIn || 0;
    this._delayElapsed = 0;
    this._started = this.delay <= 0;
    this._resting = false;
    this._unsub = null;
  }

  set(target){
    this.target = target;
    this._resting = false;
    if(!this._unsub){
      this._unsub = subscribe((t) => this._tick(t));
      this._last = performance.now();
    }
  }

  _tick(now){
    if(this._last === undefined) this._last = now;
    let dt = Math.min(64, now - this._last);
    this._last = now;

    if(!this._started){
      this._delayElapsed += dt;
      if(this._delayElapsed < this.delay) return;
      dt = this._delayElapsed - this.delay;
      this._started = true;
    }

    if(this._resting) return;

    let remaining = dt;
    while(remaining > 0){
      const step = Math.min(1, remaining);
      remaining -= step;
      const dtS = step / 1000;
      const springForce = -this.tension * (this.value - this.target);
      const dampingForce = -this.friction * this.velocity;
      const acceleration = (springForce + dampingForce) / this.mass;
      this.velocity += acceleration * dtS;
      this.value += this.velocity * dtS;
    }

    if(this.onChange) this.onChange(this.value);

    if(Math.abs(this.velocity) < this.precision && Math.abs(this.target - this.value) < this.precision){
      this.value = this.target;
      this._resting = true;
      if(this.onChange) this.onChange(this.value);
      if(this.onRest) this.onRest();
      if(this._unsub){ this._unsub(); this._unsub = null; }
    }
  }

  dispose(){
    if(this._unsub){ this._unsub(); this._unsub = null; }
  }
}

export const CONFIGS = {
  REVEAL:{ tension:90, friction:26 },
  ROW:{ tension:170, friction:24 },
  SHEET:{ tension:190, friction:26 },
  TYPE:{ tension:210, friction:24 },
  VEIL:{ tension:70, friction:24 },
  CLEAR:{ tension:140, friction:26 },
  LABEL:{ tension:110, friction:26 },
  PROGRESS_WAIT:{ tension:10, friction:30 },
  PROGRESS_READY:{ tension:170, friction:26 },
  COPY:{ tension:110, friction:26 },
  NAME:{ tension:190, friction:24 },
};

/* ============================================================
   TEXT REVEAL — split into words / letters, spring each unit
   ============================================================ */
export function splitReveal(el){
  const mode = el.dataset.revealMode || 'word';
  const stagger = Number(el.dataset.stagger || (mode === 'word' ? 110 : 26));
  const text = el.textContent;

  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = text;

  const wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.display = 'inherit';
  wrap.style.flexWrap = 'inherit';
  wrap.style.columnGap = 'inherit';

  const units = [];
  if(mode === 'word'){
    text.split(' ').forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'reveal-word';
      span.textContent = word;
      wrap.appendChild(span);
      units.push(span);
    });
  } else {
    [...text].forEach((ch) => {
      const span = document.createElement('span');
      span.className = 'reveal-letter';
      span.textContent = ch;
      wrap.appendChild(span);
      units.push(span);
    });
  }

  el.textContent = '';
  el.appendChild(hidden);
  el.appendChild(wrap);

  return { units, stagger };
}

export function playReveal(units, stagger, config, baseDelay = 0){
  units.forEach((unit, i) => {
    const spring = new Spring({
      ...config,
      from:0, to:0,
      delayIn: baseDelay + i * stagger,
      onChange:(v) => {
        unit.style.opacity = v;
        unit.style.transform = `translateY(${(1 - v) * (unit.classList.contains('reveal-letter') ? 0.3 : 0.35)}em)`;
      },
    });
    spring.set(1);
  });
}

export function riseIn(el, config, delay = 0){
  const spring = new Spring({
    ...config, from:0, to:0, delayIn:delay,
    onChange:(v) => {
      el.style.opacity = v;
      el.style.transform = `translateY(${(1 - v) * 1.25}rem)`;
    },
  });
  spring.set(1);
  return spring;
}

export function fadeIn(el, config, delay = 0){
  const spring = new Spring({
    ...config, from:0, to:0, delayIn:delay,
    onChange:(v) => { el.style.opacity = v; },
  });
  spring.set(1);
  return spring;
}
