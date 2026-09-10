import { subscribe, Spring, CONFIGS, splitReveal, playReveal, riseIn, fadeIn } from './engine.js';
import { HeroScene } from './scene.js';

/* ---------------------------------------------------------
   Inject hero.css (kept as a separate authored file, loaded
   here so the whole page still ships as index.html + two
   small companion files rather than one unreadable blob).
   --------------------------------------------------------- */
async function loadStylesheet(url) {
  const res = await fetch(url);
  const css = await res.text();
  document.getElementById('hero-styles').textContent = css;
}

/* ---------------------------------------------------------
   Root font-size — above 1920, scale linearly with width.
   --------------------------------------------------------- */
function applyRootScale() {
  const w = window.innerWidth;
  if (w > 1920) {
    document.documentElement.style.fontSize = `${(16 * w) / 1920}px`;
  } else {
    document.documentElement.style.fontSize = '';
  }
}
window.addEventListener('resize', applyRootScale);
applyRootScale();

/* ---------------------------------------------------------
   Helmet silhouette mask for the loading veil — a simple
   stylised visor shape, generated once as a data URI.
   --------------------------------------------------------- */
const HELMET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 434 512">
  <path d="M217 18C300 18 372 78 388 168C398 168 406 178 406 198L406 250C406 268 398 280 386 282
    C378 360 320 420 244 452L244 470C244 490 226 494 210 494L172 494C154 494 140 484 140 466
    L140 448C82 420 48 366 42 288C28 284 22 270 22 250L22 198C22 176 32 166 44 166
    C62 78 134 18 217 18Z"/>
</svg>`;
document.documentElement.style.setProperty(
  '--helmet-mask',
  `url("data:image/svg+xml,${encodeURIComponent(HELMET_SVG)}")`
);

/* ---------------------------------------------------------
   Loading veil controller
   --------------------------------------------------------- */
const veilEl = document.querySelector('[data-veil]');
const veilFillEl = document.querySelector('[data-veil-fill]');
const veilMeterEl = document.querySelector('[data-veil-meter-fill]');
const veilNameEl = document.querySelector('[data-veil-name]');

const progressSpring = new Spring({
  ...CONFIGS.PROGRESS_WAIT, from: 0, to: 0,
  onChange: (v) => {
    veilFillEl.style.transform = `scaleY(${v})`;
    veilMeterEl.style.transform = `scaleX(${v})`;
  },
});
progressSpring.set(0.7);

new Spring({
  ...CONFIGS.COPY, from: 0, to: 0, delayIn: 260,
  onChange: (v) => {
    veilNameEl.style.opacity = v;
    veilNameEl.style.transform = `translateY(${(1 - v) * 0.6}rem)`;
  },
}).set(1);

/* ---------------------------------------------------------
   Entrance timeline — everything below is measured from the
   veil's handover (the moment it starts to lift).
   --------------------------------------------------------- */
function runEntrance() {
  const masthead = document.querySelector('.hero-masthead');
  const id = document.querySelector('[data-reveal-fade]');
  const name = document.querySelector('[data-text-reveal]');
  const metaRows = [...document.querySelectorAll('.hero-meta-row')];
  const panels = document.querySelector('[data-hero-panels]');
  const actions = document.querySelector('.hero-actions');
  const statFigures = [...document.querySelectorAll('[data-letter-reveal]')];

  fadeIn(masthead, CONFIGS.REVEAL, 0);
  fadeIn(id, CONFIGS.REVEAL, 180);

  const { units, stagger } = splitReveal(name);
  playReveal(units, stagger, CONFIGS.REVEAL, 180);

  metaRows.forEach((row, i) => {
    new Spring({
      ...CONFIGS.REVEAL, from: 0, to: 0, delayIn: 180 + 260 + i * 130,
      onChange: (v) => {
        row.style.opacity = v;
        row.style.transform = `translateY(${(1 - v) * 0.75}rem)`;
      },
    }).set(1);
  });

  riseIn(panels, CONFIGS.REVEAL, 900);
  statFigures.forEach((figure) => {
    const { units: u, stagger: s } = splitReveal(figure);
    // letter-figure reveal shares the panel's own arrival moment
    playReveal(u, s, CONFIGS.TYPE, 900 + 200);
  });

  riseIn(actions, CONFIGS.REVEAL, 1500);
}

/* ---------------------------------------------------------
   Veil exit — three beats: content clears, a pause, then the
   veil itself lifts while the scene's rise begins on the
   same tick.
   --------------------------------------------------------- */
function exitVeil(scene) {
  const content = [veilFillEl.parentElement, veilNameEl, veilMeterEl.parentElement];
  new Spring({
    ...CONFIGS.CLEAR, from: 1, to: 1,
    onChange: (v) => {
      content.forEach((el) => {
        el.style.opacity = v;
        el.style.transform = `translateY(${(1 - v) * -0.75}rem)`;
      });
    },
  }).set(0);

  setTimeout(() => {
    scene.beginRise();
    runEntrance();
    veilEl.classList.add('is-ready');
    const lift = new Spring({
      ...CONFIGS.VEIL, from: 1, to: 1,
      onChange: (v) => { veilEl.style.opacity = v; },
    });
    lift.set(0);

    const start = performance.now();
    const poll = () => {
      const opacity = Number(getComputedStyle(veilEl).opacity || 1);
      if (opacity <= 0.004 || performance.now() - start > 3000) {
        veilEl.remove();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }, 430 + 240);
}

/* ---------------------------------------------------------
   Scene lifecycle — construct, wire pointer + resize, drive
   the loader's progress from `ready`.
   --------------------------------------------------------- */
function initScene() {
  const canvas = document.querySelector('[data-hero-canvas]');
  const scene = new HeroScene(canvas, {
    baseSrc: './img/bratishkin1.png',
    revealSrc: './img/bratishkin2.png',
  });

  const resize = () => {
    const rect = canvas.parentElement.getBoundingClientRect();
    scene.resize(rect.width, rect.height);
  };
  resize();
  window.addEventListener('resize', resize);

  let bound = false;
  const bindPointer = () => {
    if (bound || !scene.tier.pointerEnabled) return;
    bound = true;
    window.addEventListener('pointermove', onPointerMove);
  };
  const unbindPointer = () => {
    if (!bound) return;
    bound = false;
    window.removeEventListener('pointermove', onPointerMove);
  };
  function onPointerMove(e) {
    // Coordinates relative to the canvas itself (CSS px) — the scene draws
    // the reveal in its own box, not the whole viewport.
    const rect = canvas.getBoundingClientRect();
    scene.setPointer(e.clientX - rect.left, e.clientY - rect.top);
  }
  bindPointer();

  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    const tier = scene.retune();
    if (tier.pointerEnabled) bindPointer(); else unbindPointer();
  });

  const scrollGate = () => window.scrollY <= window.innerHeight * 1.15;
  subscribe((time) => {
    if (!document.hidden && scrollGate()) scene.update(time);
  }, () => scene.tier.frameInterval);

  scene.onReady = () => {
    progressSpring.dispose();
    const ready = new Spring({
      ...CONFIGS.PROGRESS_READY, from: progressSpring.value, to: progressSpring.value,
      onChange: (v) => {
        veilFillEl.style.transform = `scaleY(${v})`;
        veilMeterEl.style.transform = `scaleX(${v})`;
      },
    });
    ready.set(1);
    exitVeil(scene);
  };

  return scene;
}

/* ---------------------------------------------------------
   Mobile nav sheet
   --------------------------------------------------------- */
function initNavSheet() {
  const openBtn = document.querySelector('[data-burger-open]');
  const links = [
    ['TWITCH', 'https://www.twitch.tv/bratishkinoff'],
    ['YEBOT', 'https://ue.bot/'],
    ['INSTAGRAM', 'https://www.instagram.com/br4tishkin/?utm_source=ig_web_button_share_sheet'],
    ['TELEGRAM', 'https://t.me/nebudetafk'],
  ];
  let sheet = null;

  function close() {
    if (!sheet) return;
    const s = sheet; sheet = null;
    new Spring({
      ...CONFIGS.SHEET, from: 1, to: 1,
      onChange: (v) => { s.style.opacity = v; },
      onRest: () => s.remove(),
    }).set(0);
    document.documentElement.style.overflow = '';
    document.documentElement.style.height = '';
    openBtn.focus();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  openBtn.addEventListener('click', () => {
    sheet = document.createElement('div');
    sheet.className = 'nav-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = `
      <div class="nav-sheet-top">
        <a href="" class="hero-logo" aria-label="Grid01 Racing Systems" data-sheet-logo>
          <svg viewBox="0 0 210 42" width="120" height="24" fill="none"><text x="0" y="30" font-family="Oswald, sans-serif" font-weight="700" font-size="30" fill="currentColor">BRFF</text></svg>
        </a>
        <button class="nav-sheet-close" aria-label="Close menu" data-sheet-close><span></span><span></span></button>
      </div>
      <nav class="nav-sheet-nav" aria-label="Primary">
        ${links.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}
      </nav>
    `;
    document.body.appendChild(sheet);
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100%';

    new Spring({ ...CONFIGS.SHEET, from: 0, to: 0, onChange: (v) => { sheet.style.opacity = v; } }).set(1);
    sheet.querySelectorAll('.nav-sheet-nav a').forEach((a, i) => {
      new Spring({
        ...CONFIGS.ROW, from: 0, to: 0, delayIn: 120 + i * 55,
        onChange: (v) => { a.style.opacity = v; a.style.transform = `translateY(${(1 - v) * 0.75}rem)`; },
      }).set(1);
    });

    sheet.querySelector('[data-sheet-close]').addEventListener('click', close);
    sheet.querySelector('[data-sheet-logo]').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    sheet.querySelector('[data-sheet-close]').focus();
  });

  window.addEventListener('resize', () => { if (window.innerWidth >= 1280) close(); });
}

/* ---------------------------------------------------------
   Boot
   --------------------------------------------------------- */
(async function boot() {
  await loadStylesheet('./hero.css');
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  initNavSheet();
  initScene();
})();
/* =========================================================
   GLOBAL MOUSE PARALLAX
   ========================================================= */

function initMouseParallax() {
  // На телефонах эффект не нужен
  if (window.matchMedia('(hover: none)').matches) return;

  const layers = [
    {
      selector: '.hero-scene',
      strength: 18
    },
    {
      selector: '.hero-middle',
      strength: 7
    },
    {
      selector: '.hero-actions',
      strength: 4
    }
  ];

  const elements = layers
    .map(layer => ({
      el: document.querySelector(layer.selector),
      strength: layer.strength
    }))
    .filter(item => item.el);

  if (!elements.length) return;

  let mouseX = 0;
  let mouseY = 0;

  let currentX = 0;
  let currentY = 0;

  let targetX = 0;
  let targetY = 0;

  window.addEventListener('pointermove', (e) => {
    targetX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function animate() {
    currentX += (targetX - currentX) * 0.06;
    currentY += (targetY - currentY) * 0.06;

    elements.forEach(({ el, strength }) => {
      const x = currentX * strength;
      const y = currentY * strength;

      const rotate = currentX * strength * 0.08;

      el.style.transform = `
  translate3d(${x}px, ${y}px, 0)
  rotateY(${rotate}deg)
`;
    });

    requestAnimationFrame(animate);
  }

  animate();
}

initMouseParallax();
