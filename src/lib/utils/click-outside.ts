import type { Action } from 'svelte/action';

/**
 * Svelte action: invoke `callback` when a pointerdown happens outside `node`.
 * Listener is registered in capture phase so it runs even if inner handlers stop propagation.
 */
export const clickOutside: Action<HTMLElement, () => void> = (node, callback) => {
  let cb = callback;
  const handler = (e: PointerEvent) => {
    if (!node.contains(e.target as Node)) cb();
  };
  document.addEventListener('pointerdown', handler, true);
  return {
    update(newCallback: () => void) { cb = newCallback; },
    destroy() { document.removeEventListener('pointerdown', handler, true); },
  };
};
