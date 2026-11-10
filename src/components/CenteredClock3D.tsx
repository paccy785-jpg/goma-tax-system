import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

const TIME_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lubumbashi';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const pad2 = (value: number) => String(value).padStart(2, '0');

interface TimeTileProps {
  value: string;
  emphasis?: boolean;
}

/**
 * A single extruded digit plate. Remounting on `value` change restarts the
 * flip animation, so each digit turns over on its own rather than the whole
 * clock re-rendering as one block.
 */
const TimeTile: React.FC<TimeTileProps> = ({ value, emphasis = false }) => (
  <span
    className={[
      'clock3d-tile',
      emphasis ? 'clock3d-tile--seconds' : '',
      'w-8 h-12 text-lg sm:w-12 sm:h-16 sm:text-3xl md:w-14 md:h-20 md:text-4xl',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <span className="clock3d-digit" key={value}>
      {value}
    </span>
  </span>
);

const Colon: React.FC = () => (
  <span
    className="clock3d-colon w-3 sm:w-4 md:w-5 text-lg sm:text-3xl md:text-4xl"
    aria-hidden="true"
  >
    :
  </span>
);

/**
 * Centered 3D time-and-date header shown at the top of the portal.
 *
 * Depth comes from real CSS 3D transforms (a rear slab in the parent's
 * preserve-3d space, extruded digit plates, and a pointer-driven tilt), so it
 * stays sharp at every zoom level. The pointer tilt writes CSS custom
 * properties directly to avoid re-rendering the clock on every mouse move.
 */
export const CenteredClock3D: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  const cardRef = useRef<HTMLDivElement>(null);

  // Tick on the second boundary: a fixed 1000ms interval drifts a few ms per
  // tick and makes the seconds visibly stutter.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    card.style.setProperty('--ry', `${((x - 0.5) * 9).toFixed(2)}deg`);
    card.style.setProperty('--rx', `${(4 + (0.5 - y) * 7).toFixed(2)}deg`);
  };

  const handlePointerLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--rx', '4deg');
  };

  const hours = pad2(now.getHours());
  const minutes = pad2(now.getMinutes());
  const seconds = pad2(now.getSeconds());
  const isoDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  return (
    <section
      aria-label={`Current date and time in ${TIME_ZONE}`}
      className="clock3d print-hidden mb-6 sm:mb-8"
    >
      <div
        className="clock3d-stage mx-auto w-full max-w-[720px]"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <div className="clock3d-card" ref={cardRef}>
          <div className="clock3d-back" aria-hidden="true" />

          <div className="clock3d-face px-3 py-5 sm:px-6 sm:py-6">
            {/* Label rail */}
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <span className="clock3d-rule w-5 sm:w-12" aria-hidden="true" />
              <Clock className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden="true" />
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-white/65 whitespace-nowrap">
                DPRNK Official Time
              </span>
              <span className="clock3d-live-dot" aria-hidden="true" />
              <span className="clock3d-rule w-5 sm:w-12" aria-hidden="true" />
            </div>

            {/* Time */}
            <div
              className="mt-4 flex items-center justify-center gap-1 sm:gap-1.5 md:gap-2"
              role="timer"
              aria-live="off"
            >
              <TimeTile value={hours} />
              <Colon />
              <TimeTile value={minutes} />
              <Colon />
              <TimeTile value={seconds} emphasis />
            </div>

            {/* Date plate */}
            <time
              className="clock3d-date-plate mx-auto mt-5 flex max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-2"
              dateTime={isoDate}
            >
              <span className="font-display text-xs sm:text-sm font-semibold text-white/90">
                {DATE_FORMAT.format(now)}
              </span>
              <span
                className="h-1 w-1 rounded-full bg-accent shrink-0"
                aria-hidden="true"
              />
              <span className="font-mono text-[11px] sm:text-[12px] text-white/55 truncate">
                {TIME_ZONE}
              </span>
            </time>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CenteredClock3D;
