/**
 * One shared animation loop for live clock faces. Each face registers an
 * update function; the loop runs only while some face is on screen and the
 * page is visible, and forgets faces once they leave the page.
 */

type Update = (now: Date) => void;
const faces = new Set<{ el: Element; update: Update }>();
let raf = 0;

function frame() {
  raf = 0;
  const now = new Date();
  for (const f of faces) {
    if (!f.el.isConnected) {
      // Not attached yet (just created) or gone for good: drop it once it's
      // been away for a while.
      const age = (f as { since?: number }).since ?? ((f as { since?: number }).since = performance.now());
      if (performance.now() - age > 2000) faces.delete(f);
      continue;
    }
    delete (f as { since?: number }).since;
    f.update(now);
  }
  if (faces.size && document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && faces.size && !raf) raf = requestAnimationFrame(frame);
});

export function liveFace(el: Element, update: Update): void {
  faces.add({ el, update });
  update(new Date());
  if (!raf && document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
}

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
