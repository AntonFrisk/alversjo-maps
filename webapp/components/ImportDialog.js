'use client';
import { useState } from 'react';

const MODES = [
  {
    id: 'smart',
    label: 'Smart import',
    desc: 'Match polygons by shape, copy selected fields',
  },
  {
    id: 'replace-polygons',
    label: 'Replace all polygons',
    desc: 'Remove current polygons and copy all polygons from source',
    warn: true,
  },
  {
    id: 'replace-points',
    label: 'Replace all points',
    desc: 'Remove current points and copy all points from source',
    warn: true,
  },
];

const FIELD_GROUPS = [
  { id: 'names',      label: 'Names',        desc: 'title, point number' },
  { id: 'soundClass', label: 'Sound class',  desc: 'class letter and number' },
  { id: 'otherFields',label: 'Other details',desc: 'description, azimuth, camp info, upgrade actions' },
];

export default function ImportDialog({ layers, mapsConfig, activeLayer, onConfirm, onClose }) {
  const otherLayers = layers.filter((n) => n !== activeLayer);
  const [sourceMap, setSourceMap] = useState(otherLayers[0] || '');
  const [mode, setMode] = useState('smart');
  const [smartFields, setSmartFields] = useState(new Set(['names', 'soundClass', 'otherFields']));

  function toggleField(id) {
    setSmartFields((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const canConfirm = sourceMap && (mode !== 'smart' || smartFields.size > 0);

  return (
    <div className="import-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="import-dialog-card">
        <button className="import-dialog-close" onClick={onClose}>×</button>
        <h3 className="import-dialog-title">Import from map</h3>

        <div className="import-dialog-section">
          <label className="import-dialog-label">Source map</label>
          <select className="import-dialog-select" value={sourceMap} onChange={(e) => setSourceMap(e.target.value)}>
            {otherLayers.map((name) => (
              <option key={name} value={name}>
                {mapsConfig?.[name]?.shortName || name.replace('map', 'Map ')}
              </option>
            ))}
          </select>
        </div>

        <div className="import-dialog-section">
          <label className="import-dialog-label">Import mode</label>
          <div className="import-mode-list">
            {MODES.map((opt) => (
              <button
                key={opt.id}
                className={`import-mode-btn ${mode === opt.id ? 'is-selected' : ''} ${opt.warn ? 'is-warn' : ''}`}
                onClick={() => setMode(opt.id)}
              >
                <span className="import-mode-name">{opt.label}</span>
                <span className="import-mode-desc">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {mode === 'smart' && (
          <div className="import-dialog-section">
            <label className="import-dialog-label">Fields to copy</label>
            <div className="import-field-list">
              {FIELD_GROUPS.map((g) => (
                <label key={g.id} className={`import-field-item ${smartFields.has(g.id) ? 'is-checked' : ''}`}>
                  <input type="checkbox" checked={smartFields.has(g.id)} onChange={() => toggleField(g.id)} />
                  <span className="import-field-name">{g.label}</span>
                  <span className="import-field-desc">{g.desc}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="import-dialog-actions">
          <button className="import-dialog-cancel" onClick={onClose}>Cancel</button>
          <button
            className="import-dialog-confirm"
            onClick={() => onConfirm(sourceMap, mode, smartFields)}
            disabled={!canConfirm}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
