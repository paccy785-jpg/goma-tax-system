import React, { useState, useEffect } from 'react';

/**
 * Live 3D time & date display, in the middle of the app header (in the row's
 * flow, so nothing beside it can run underneath it).
 * The extruded look comes from stacked text-shadows plus a slight
 * perspective tilt (see .clock3d-* rules in index.css).
 */
export const DateTime3DClock: React.FC = () => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = String(now.getHours() % 12 || 12).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="hidden md:flex shrink-0 flex-col items-center leading-none select-none pointer-events-none px-2"
      role="timer"
      aria-label={`Current time ${hours}:${minutes} ${ampm}, ${dateLabel}`}
    >
      <div className="clock3d-time font-display text-[27px] font-black tabular-nums tracking-wide">
        {hours}:{minutes}
        <span className="text-[17px]">:{seconds}</span>
        <span className="text-[12px] font-bold ml-1 align-top">{ampm}</span>
      </div>
      <div className="clock3d-date text-[11px] font-bold uppercase tracking-[0.18em] mt-2">
        {dateLabel}
      </div>
    </div>
  );
};
