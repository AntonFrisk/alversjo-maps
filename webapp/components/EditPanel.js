'use client';
import { deriveFromNum, SOUND_CLASS_COLORS } from '@/lib/sound-class';

export default function EditPanel({ feature, onUpdate, onClose }) {
  if (!feature) return null;

  const props = feature.properties || {};

  function set(key, value) {
    const updated = { ...props, [key]: value };
    if (key === 'sound-class-num') {
      const n = Number(value);
      if (!isNaN(n)) {
        const { soundClass, featureColor } = deriveFromNum(n);
        updated['sound-class'] = soundClass;
        updated['marker-color'] = featureColor;
        updated['fill'] = featureColor;
      }
    }
    onUpdate(feature.id, updated);
  }

  const soundClassNum = props['sound-class-num'] ?? '';
  const soundClass = props['sound-class'] || '';
  const letterColor = SOUND_CLASS_COLORS[soundClass] || '#888';

  return (
    <div className="edit-panel">
      <div className="edit-panel-header">
        <span className="edit-panel-title">Edit Feature</span>
        <button className="edit-panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="edit-panel-body">
        <div className="edit-field">
          <label className="edit-label">Title</label>
          <input
            type="text"
            value={props.title || ''}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Description</label>
          <textarea
            rows={3}
            value={props.description || ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">
            Sound class number (0–10)
            {soundClass && (
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

        <div className="edit-field">
          <label className="edit-label">Azimuth (0–359°)</label>
          <input
            type="number"
            min={0}
            max={359}
            value={props['sound-direction-azimuth'] ?? ''}
            onChange={(e) => set('sound-direction-azimuth', Number(e.target.value))}
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Direction comment</label>
          <input
            type="text"
            value={props['sound-direction-comment'] || ''}
            onChange={(e) => set('sound-direction-comment', e.target.value)}
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Camp 2025</label>
          <input
            type="text"
            value={props['camp-in-2025'] || ''}
            onChange={(e) => set('camp-in-2025', e.target.value)}
          />
        </div>

        <div className="edit-field">
          <label className="edit-label">Upgrade actions</label>
          <textarea
            rows={2}
            value={props['upgrade-actions'] || ''}
            onChange={(e) => set('upgrade-actions', e.target.value)}
          />
        </div>

        <div className="edit-meta">
          <span>ID: {String(feature.id).slice(0, 18)}…</span>
          <span>{feature.geometry?.type}</span>
        </div>
      </div>
    </div>
  );
}
