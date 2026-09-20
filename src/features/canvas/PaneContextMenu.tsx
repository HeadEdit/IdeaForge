import { useEffect, useRef, useState } from 'react';

export interface PaneContextMenuState {
  clientX: number;
  clientY: number;
  flowX: number;
  flowY: number;
}

export interface PaneContextMenuProps {
  state: PaneContextMenuState | null;
  onClose: () => void;
  onAddAnnotation: (position: { x: number; y: number }) => void;
}

export function PaneContextMenu({ state, onClose, onAddAnnotation }: PaneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!state || !menuRef.current) return;
    const pad = 8;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setCoords({
      left: Math.max(pad, Math.min(state.clientX, window.innerWidth - width - pad)),
      top: Math.max(pad, Math.min(state.clientY, window.innerHeight - height - pad)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, state]);

  if (!state) return null;

  return (
    <div
      ref={menuRef}
      className="pane-context-menu"
      role="menu"
      aria-label="白板菜单"
      style={{ left: coords.left, top: coords.top }}
    >
      <button
        type="button"
        className="pane-context-menu__item"
        role="menuitem"
        onClick={() => {
          onAddAnnotation({ x: state.flowX + 4, y: state.flowY + 4 });
          onClose();
        }}
      >
        <span className="pane-context-menu__glyph" aria-hidden="true">✎</span>
        <span>注释</span>
      </button>
    </div>
  );
}
