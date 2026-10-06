const SLUGS = ['europe', 'usa', 'caribbean', 'mexico', 'asia-pacific', 'south-america', 'central-america', 'africa-middle-east'];
const DURATION_MS = 700;
const COUNT = 36;

export interface Particle { vx: number; vy: number; size: number; color: number; spin: number }

/** Particles flying out of the origin, biased upward. `rand` is injectable for tests. */
export function makeParticles(n: number, rand: () => number = Math.random): Particle[] {
  return Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.1;
    const v = 220 + rand() * 260;
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 4 + rand() * 4, color: Math.floor(rand() * SLUGS.length), spin: rand() * 6 };
  });
}

/** Offset of a particle `t` seconds in (gravity pulls down). */
export function particleAt(p: Particle, t: number): { x: number; y: number } {
  return { x: p.vx * t, y: p.vy * t + 520 * t * t };
}

/**
 * A ~700 ms confetti burst from `from`, in the region colours. Draws on a
 * temporary fixed canvas and removes it afterwards. Does nothing under
 * prefers-reduced-motion or without a canvas.
 */
export function celebrate(from: Element | null | undefined): void {
  if (typeof document === 'undefined' || !from) return;
  if (typeof globalThis.matchMedia !== 'function' || globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from.getBoundingClientRect();
  const ox = r.left + r.width / 2;
  const oy = r.top + r.height / 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = innerWidth;
  const h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:fixed;inset:0;width:${w}px;height:${h}px;pointer-events:none;z-index:1000`;
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);
  const style = getComputedStyle(document.documentElement);
  const fallback = style.getPropertyValue('--region-other').trim() || '#8A8F99';
  const colors = SLUGS.map(s => style.getPropertyValue(`--region-${s}`).trim() || fallback);
  const parts = makeParticles(COUNT);
  const t0 = performance.now();
  const frame = (now: number): void => {
    const t = (now - t0) / DURATION_MS;
    ctx.clearRect(0, 0, w, h);
    if (t >= 1) { canvas.remove(); return; }
    ctx.globalAlpha = 1 - t * t;
    for (const p of parts) {
      const pos = particleAt(p, t * (DURATION_MS / 1000));
      ctx.save();
      ctx.translate(ox + pos.x, oy + pos.y);
      ctx.rotate(p.spin * t * 4);
      ctx.fillStyle = colors[p.color];
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
