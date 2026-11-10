import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, PenLine } from 'lucide-react';

/**
 * A pad the agent signs on with a mouse, trackpad, pen or finger.
 *
 * Reports the drawing as a PNG data URL (transparent background), or '' once
 * cleared. Drawn at the screen's pixel density so the stroke stays crisp.
 */
export const SignaturePad: React.FC<{
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}> = ({ value, onChange, disabled, invalid }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(!!value);

  /** Size the bitmap to the element × devicePixelRatio. */
  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#0f172a';
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  // A cleared form (value reset to '') wipes the pad.
  useEffect(() => {
    if (value) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    setHasInk(false);
  }, [value]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) {
      // A tap still leaves a dot.
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
    }
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = e.currentTarget.getContext('2d');
    const p = point(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setHasInk(true);
    onChange(e.currentTarget.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    setHasInk(false);
    onChange('');
  };

  return (
    <div className="space-y-1.5">
      <div
        className={`relative rounded-[10px] border bg-white overflow-hidden ${
          invalid ? 'border-danger' : 'border-line'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <canvas
          ref={canvasRef}
          aria-label="Zone de signature"
          className="block w-full h-36 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        {/* Signature line */}
        <div className="pointer-events-none absolute left-6 right-6 bottom-7 border-b border-dashed border-slate-300" />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-[12px] text-slate-400">
            <PenLine className="w-3.5 h-3.5" />
            Signez ici
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Eraser className="w-3.5 h-3.5" />
          Effacer la signature
        </button>
      </div>
    </div>
  );
};
