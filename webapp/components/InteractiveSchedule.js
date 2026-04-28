'use client';

import { useEffect, useState } from 'react';
import { ZONES, TIERS, getScheduleRow, SOUND_LEVEL_REF } from '@/lib/schedule-data';

const ZONE_RGB = {
  quiet: '56,189,248',
  chill: '74,222,128',
  mellow: '250,204,21',
  dayFestive: '244,114,182',
  eveningParty: '251,146,60',
  wild: '239,68,68',
};

// dB 50 → alpha 0.10 (lightest), dB 116 → alpha 0.58 (darkest but still readable)
function dbToAlpha(dB) {
  if (typeof dB !== 'number') return 0.12;
  return Math.min(0.58, 0.10 + Math.max(0, (dB - 50) / 66) * 0.48);
}

const TICKS = [
  { label: '09:00', pct: 0 },
  { label: '12:00', pct: 12.5 },
  { label: '15:00', pct: 25 },
  { label: '18:00', pct: 37.5 },
  { label: '21:00', pct: 50 },
  { label: '00:00', pct: 62.5 },
  { label: '03:00', pct: 75 },
  { label: '06:00', pct: 87.5 },
  { label: '09:00', pct: 100 },
];

export default function InteractiveSchedule({ open, onClose }) {
  const [dayMode, setDayMode] = useState('weekday');
  const [tier, setTier] = useState(0);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;

  const tierInfo = TIERS.find((t) => t.id === tier);

  return (
    <div className="interactive-schedule-overlay" role="dialog" aria-modal="true" aria-label="Interactive sound schedule">
      <div className="interactive-schedule-backdrop" onClick={onClose} />
      <div className="interactive-schedule-scroll">
        <div className="interactive-schedule-card">
          <div className="interactive-schedule-header">
            <div className="interactive-schedule-title-block">
              <div className="interactive-schedule-kicker">Borderland &apos;26</div>
              <h1 className="interactive-schedule-title">Sound Schedule</h1>
              <p className="interactive-schedule-desc">
                Decibel limits based on your camp&apos;s sound zone. Toggle to see weekend extensions.
                Select a tier to see upgrade rewards (generic table — some locations may differ).
              </p>
            </div>
            <button type="button" className="interactive-schedule-close" onClick={onClose} aria-label="Close">✕</button>
          </div>

          <div className="schedule-tier-bar">
            <div className="schedule-tier-controls">
              <div className="schedule-tier-selector" role="group" aria-label="Tier">
                {TIERS.map((t) => (
                  <button key={t.id} type="button" className={tier === t.id ? 'is-active' : ''} onClick={() => setTier(t.id)}>{t.label}</button>
                ))}
              </div>
              <div className="schedule-daymode-toggle" role="group" aria-label="Day type">
                <button type="button" className={dayMode === 'weekday' ? 'is-active' : ''} onClick={() => setDayMode('weekday')}>Sun – Thu</button>
                <button type="button" className={dayMode === 'weekend' ? 'is-active' : ''} onClick={() => setDayMode('weekend')}>Fri &amp; Sat</button>
              </div>
            </div>
            <p className="schedule-tier-summary">{tierInfo?.summary}</p>
          </div>

          <div className="schedule-table">
            {/* Time axis */}
            <div className="schedule-timebar">
              <div className="schedule-timebar-spacer" />
              <div className="schedule-timebar-ticks">
                {TICKS.map(({ label, pct }, i) => (
                  <span
                    key={i}
                    className="schedule-timebar-tick"
                    style={{
                      left: `${pct}%`,
                      transform: i === 0 ? 'none' : i === TICKS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {ZONES.map((z) => {
              const cells = getScheduleRow(z.id, dayMode, tier);
              const rgb = ZONE_RGB[z.color];
              return (
                <div key={z.id} className={`schedule-row schedule-row--${z.color}`}>
                  <div className="schedule-row-label">
                    <span className="schedule-zone-dot" />
                    <div>
                      <div className="schedule-zone-name">{z.label}</div>
                      <div className="schedule-zone-desc">{z.description}</div>
                    </div>
                  </div>
                  <div className="schedule-row-cells">
                    {cells.map((c, i) => (
                      <div
                        key={i}
                        className={`schedule-cell${c.hours <= 1.5 ? ' schedule-cell--compact' : ''}`}
                        style={{
                          flex: c.hours,
                          background: `rgba(${rgb},${dbToAlpha(c.dB)})`,
                          borderRight: i < cells.length - 1 ? '2px solid rgba(255,255,255,0.6)' : 'none',
                          borderRadius: cells.length === 1 ? '8px' : i === 0 ? '8px 0 0 8px' : i === cells.length - 1 ? '0 8px 8px 0' : '0',
                        }}
                      >
                        <div className="schedule-cell-db">{typeof c.dB === 'number' ? `\u003c${c.dB} dB` : c.dB}</div>
                        <div className="schedule-cell-time">{c.timeLabel}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="schedule-footer-grid">
            <div>
              <h2 className="schedule-footer-title">Sound level reference</h2>
              <div className="schedule-level-cards">
                {SOUND_LEVEL_REF.map((r) => (
                  <div key={r.dB} className="schedule-level-card">
                    <div className="schedule-level-db">&lt;{r.dB} dB</div>
                    <div className="schedule-level-text">{r.text}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="schedule-notes">
              <p><strong>Measurement</strong> — Decibel values are measured as C-weighting (dB-C) at 6 m in front of your speakers.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
