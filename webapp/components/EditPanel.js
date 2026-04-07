'use client';
import { deriveFromNum, SOUND_CLASS_COLORS, SOUND_LETTER_COLORS } from '@/lib/sound-class';

const LETTER_OPTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function EditPanel({ feature, onUpdate, onClose, onDelete, soundMode }) {
  if (!feature) return null;

  const props = feature.properties || {};

  function set(key, value) {
    const updated = { ...props };
    if (value === undefined || value === '') {
      delete updated[key];
    } else {
      updated[key] = value;
    }
    if (key === 'sound-class-num' && value !== undefined && value !== '') {
      const { soundClass, featureColor } = deriveFromNum(Number(value));
      updated['sound-class'] = soundClass;
      updated['marker-color'] = featureColor;
      updated['fill'] = featureColor;
    }
    if (key === 'sound-class' && soundMode === 'letter') {
      const color = SOUND_LETTER_COLORS[value] || '#888';
      updated['marker-color'] = color;
      updated['fill'] = color;
    }
    onUpdate(feature.id, updated);
  }

  const soundClassNum = props['sound-class-num'] ?? '';
  const soundClass = props['sound-class'] || '';
  const letterColor = (soundMode === 'letter' ? SOUND_LETTER_COLORS : SOUND_CLASS_COLORS)[soundClass] || '#888';

  return (
    <div className="edit-panel">
      <div className="edit-panel-header">
        <span className="edit-panel-title">Edit Feature</span>
        <button className="edit-panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="edit-panel-body">
        <div className="edit-field">
          <label className="edit-label">Point number</label>
          <input
            type="number"
            min={0}
            value={props['point-num'] ?? ''}
            onChange={(e) => set('point-num', e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder="e.g. 11"
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Title</label>
          <input
            type="text"
            value={props.title || ''}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Power slope"
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Description</label>
          <textarea
            rows={3}
            value={props.description || ''}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Describe the location or zone…"
          />
        </div>

        {soundMode === 'letter' ? (
          <div className="edit-field">
            <label className="edit-label">
              Sound class
              {soundClass && (
                <span className="edit-class-badge" style={{ background: letterColor }}>
                  {soundClass}
                </span>
              )}
            </label>
            <select
              value={soundClass}
              onChange={(e) => set('sound-class', e.target.value || undefined)}
            >
              <option value="">— none —</option>
              {LETTER_OPTIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="edit-field">
            <label className="edit-label">
              Sound class number (0–10)
              {soundMode !== 'num' && soundClass && (
                <span className="edit-class-badge" style={{ background: letterColor }}>
                  {soundClass}
                </span>
              )}
            </label>
            <div className="edit-sound-row">
              <input
                type="number"
                min={0}
                max={10}
                value={soundClassNum}
                onChange={(e) => set('sound-class-num', Number(e.target.value))}
                className="edit-num-input"
                placeholder="0–10"
              />
              <input
                type="range"
                min={0}
                max={10}
                value={soundClassNum === '' ? 0 : soundClassNum}
                onChange={(e) => set('sound-class-num', Number(e.target.value))}
                className="edit-slider"
              />
            </div>
          </div>
        )}

        <div className="edit-field">
          <label className="edit-label">Azimuth (0–359°)</label>
          <input
            type="number"
            min={0}
            max={359}
            value={props['sound-direction-azimuth'] ?? ''}
            onChange={(e) => set('sound-direction-azimuth', e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder="e.g. 180"
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Direction comment</label>
          <input
            type="text"
            value={props['sound-direction-comment'] || ''}
            onChange={(e) => set('sound-direction-comment', e.target.value)}
            placeholder="e.g. S/SW/W. Not N."
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Camp 2025</label>
          <input
            type="text"
            value={props['camp-in-2025'] || ''}
            onChange={(e) => set('camp-in-2025', e.target.value)}
            placeholder="Camp or act name"
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Upgrade actions</label>
          <textarea
            rows={2}
            value={props['upgrade-actions'] || ''}
            onChange={(e) => set('upgrade-actions', e.target.value)}
            placeholder="Sound proofing, directional arrays, etc."
          />
        </div>

        <div className="edit-meta">
          <span>ID: {String(feature.id).slice(0, 18)}…</span>
          <span>{feature.geometry?.type}</span>
        </div>

        {onDelete && (
          <button className="edit-delete-btn" onClick={() => onDelete(feature.id)}>
            Delete feature
          </button>
        )}
      </div>
    </div>
  );
}
