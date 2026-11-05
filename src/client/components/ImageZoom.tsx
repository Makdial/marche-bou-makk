import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export interface ZoomPhoto {
  src: string;
  label: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface View {
  zoom: number;
  x: number;
  y: number;
}

interface Spot {
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'pinch'; distance: number; zoom: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function gap(a: Spot, b: Spot) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ZoomPanel({ src, alt, extra }: { src: string; alt: string; extra?: ReactNode }) {
  const { t } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [view, setViewState] = useState<View>({ zoom: MIN_ZOOM, x: 0, y: 0 });
  const latest = useRef<View>(view);
  const pointers = useRef(new Map<number, Spot>());
  const gesture = useRef<Gesture | null>(null);

  const setView = useCallback((next: View) => {
    latest.current = next;
    setViewState(next);
  }, []);

  // Keeps the zoomed picture covering the frame, so it can't be dragged out of sight.
  const keepInView = useCallback((spot: Spot, zoom: number): Spot => {
    const box = frame.current;
    const img = picture.current;
    if (!box || !img) return spot;
    const maxX = Math.max(0, (img.offsetWidth * zoom - box.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * zoom - box.clientHeight) / 2);
    return { x: clamp(spot.x, -maxX, maxX), y: clamp(spot.y, -maxY, maxY) };
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
      const spot = zoom <= MIN_ZOOM ? { x: 0, y: 0 } : keepInView(latest.current, zoom);
      setView({ zoom, ...spot });
    },
    [keepInView, setView],
  );

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyZoom(latest.current.zoom + (event.deltaY < 0 ? 0.25 : -0.25));
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      gesture.current = { kind: 'pinch', distance: gap(points[0], points[1]), zoom: latest.current.zoom };
    } else if (points.length === 1 && latest.current.zoom > MIN_ZOOM) {
      gesture.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: latest.current.x,
        originY: latest.current.y,
      };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = gesture.current;
    if (!active) return;
    if (active.kind === 'pinch') {
      const points = [...pointers.current.values()];
      if (points.length === 2 && active.distance > 0) {
        applyZoom(active.zoom * (gap(points[0], points[1]) / active.distance));
      }
      return;
    }
    if (pointers.current.size === 1) {
      const spot = keepInView(
        { x: active.originX + event.clientX - active.startX, y: active.originY + event.clientY - active.startY },
        latest.current.zoom,
      );
      setView({ ...latest.current, ...spot });
    }
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    const [left] = [...pointers.current.values()];
    gesture.current =
      pointers.current.size === 1 && left && latest.current.zoom > MIN_ZOOM
        ? { kind: 'pan', startX: left.x, startY: left.y, originX: latest.current.x, originY: latest.current.y }
        : null;
  }

  const { zoom, x, y } = view;

  return (
    <div className="zoom-panel">
      <div
        ref={frame}
        className="image-zoom-viewport"
        style={{ cursor: zoom > MIN_ZOOM ? 'grab' : 'zoom-in' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={() => applyZoom(latest.current.zoom > MIN_ZOOM ? MIN_ZOOM : 2)}
      >
        <img ref={picture} src={src} alt={alt} draggable={false} style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }} />
      </div>
      <div className="image-zoom-controls">
        <button type="button" className="btn small" onClick={() => applyZoom(latest.current.zoom + 0.5)} disabled={zoom >= MAX_ZOOM}>
          {t('zoom.in')}
        </button>
        <button type="button" className="btn small" onClick={() => applyZoom(latest.current.zoom - 0.5)} disabled={zoom <= MIN_ZOOM}>
          {t('zoom.out')}
        </button>
        <button type="button" className="btn small" onClick={() => applyZoom(MIN_ZOOM)} disabled={zoom <= MIN_ZOOM}>
          {t('zoom.reset')}
        </button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        {extra}
      </div>
      <p className="muted small">{t('zoom.hint')}</p>
    </div>
  );
}

export function ImageZoom({ photos }: { photos: ZoomPhoto[] }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const current = photos[index] ?? photos[0];

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [fullscreen]);

  return (
    <div className="image-zoom">
      <ZoomPanel
        key={current.src}
        src={current.src}
        alt={current.label}
        extra={
          <button type="button" className="btn small" onClick={() => setFullscreen(true)}>
            {t('zoom.fullscreen')}
          </button>
        }
      />
      {photos.length > 1 && (
        <>
          <p className="muted small">{t('zoom.photos')}</p>
          <div className="image-zoom-thumbs">
            {photos.map((photo, position) => (
              <button
                key={photo.src}
                type="button"
                className={`image-zoom-thumb ${position === index ? 'active' : ''}`}
                aria-label={photo.label}
                title={photo.label}
                onClick={() => setIndex(position)}
              >
                <img src={photo.src} alt="" />
              </button>
            ))}
          </div>
        </>
      )}
      {fullscreen && (
        <div
          className="zoom-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={current.label}
          onClick={(event) => {
            if (event.target === event.currentTarget) setFullscreen(false);
          }}
        >
          <ZoomPanel
            key={`full-${current.src}`}
            src={current.src}
            alt={current.label}
            extra={
              <button type="button" className="btn small" autoFocus onClick={() => setFullscreen(false)}>
                {t('zoom.close')}
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}
