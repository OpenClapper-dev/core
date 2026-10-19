/**
 * `wm-gesture` on <body> while a window drag, resize or split drag runs: it turns pointer events
 * off inside window content (maps and canvases must not see the drag) and every window transition
 * off (motion.css), since the gesture writes geometry per frame.
 */
let gen = 0;

export function startGesture(): void {
  gen++;
  document.body.classList.add("wm-gesture");
}

/**
 * Ends it two frames later: the committed geometry must be painted first, or the windows would
 * transition from where they were before the gesture. A gesture started meanwhile keeps the class.
 */
export function endGesture(): void {
  const mine = gen;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (gen === mine) document.body.classList.remove("wm-gesture"); }));
}
