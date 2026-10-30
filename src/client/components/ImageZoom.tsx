import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

interface Props {
  src: string;
  alt: string;
  thumbnails?: { src: string; label?: string }[];
}

export function ImageZoom({ src, alt, thumbnails }: Props) {
  const { t } = useI18n();
  const [active, setActive] = useState(src);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActive(src);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  function onWheel(event: React.WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.25 : -0.25;
    setZoom((z) => Math.min(4, Math.max(1, z + delta)));
  }

  function onPointerDown(event: React.PointerEvent) {
    if (zoom <= 1) return;
    setDragging(true);
    start.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!dragging) return;
    setOffset({ x: start.current.ox + (event.clientX - start.current.x), y: start.current.oy + (event.clientY - start.current.y) });
  }

  function onPointerUp() {
    setDragging(false);
  }

  function onDoubleClick() {
    setZoom((z) => (z > 1 ? 1 : 2));
    setOffset({ x: 0, y: 0 });
  }

  return (
    <div className="image-zoom">
      <div
        ref={container}
        className="image-zoom-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img
          src={active}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
        />
      </div>
      <div className="image-zoom-controls">
        <button type="button" className="btn small" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>{t('zoom.in')}</button>
        <button type="button" className="btn small" onClick={() => setZoom((z) => Math.max(1, z - 0.25))}>{t('zoom.out')}</button>
        <button type="button" className="btn small" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>{t('zoom.reset')}</button>
      </div>
      <p className="muted small">{t('zoom.hint')}</p>
      {thumbnails && thumbnails.length > 1 && (
        <div className="image-zoom-thumbs">
          {thumbnails.map((thumb, index) => (
            <button
              key={index}
              type="button"
              className={`image-zoom-thumb ${active === thumb.src ? 'active' : ''}`}
              onClick={() => { setActive(thumb.src); setZoom(1); setOffset({ x: 0, y: 0 }); }}
            >
              <img src={thumb.src} alt={thumb.label ?? alt} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
