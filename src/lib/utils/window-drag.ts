export async function startWindowDrag(event: MouseEvent): Promise<void> {
  if (event.button !== 0) return;

  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('button, input, textarea, select, a, [role="button"], [data-no-drag]')
  ) {
    return;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch {
    // Ignore in web preview or when the Tauri runtime is unavailable.
  }
}

export function draggableRegion(node: HTMLElement): { destroy: () => void } {
  const onMouseDown = (event: MouseEvent): void => {
    void startWindowDrag(event);
  };

  node.addEventListener('mousedown', onMouseDown);

  return {
    destroy: () => {
      node.removeEventListener('mousedown', onMouseDown);
    },
  };
}