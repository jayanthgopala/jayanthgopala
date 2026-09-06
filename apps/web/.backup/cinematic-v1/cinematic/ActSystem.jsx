import { useState } from 'react';
import { copy } from '../lib/api.js';
import { useEntered } from './lib/scene.js';

/**
 * ACT IV — SYSTEM.
 *
 * The toolkit as a matrix rather than a wall of logo chips.
 *
 * Two decisions carry this section. The meters draw on entry rather than
 * appearing filled — a bar that arrives at its value in front of you reads as a
 * measurement, one that is simply there reads as decoration. And pointing at
 * anything dims everything else, because with twenty-odd rows on screen the eye
 * has nowhere to rest, and the dim is what turns a list into something you can
 * read one line at a time.
 *
 * Grouping and order come from the database, so a new category in the admin
 * panel becomes a new column with no change here.
 */

function Column({ category, items, index, focus, setFocus }) {
  const [ref, entered] = useEntered({ threshold: 0.25 });

  return (
    <div
      className="cx-sys-col"
      ref={ref}
      data-in={entered || undefined}
      data-dim={focus && focus !== category ? '' : undefined}
      style={{ '--i': index }}
      onPointerEnter={() => setFocus(category)}
      onPointerLeave={() => setFocus('')}
    >
      <div className="cx-sys-head">
        <span className="cx-eyebrow">{category}</span>
        <span className="cx-sys-count" aria-hidden="true">
          {String(items.length).padStart(2, '0')}
        </span>
      </div>

      <ul className="cx-sys-list">
        {items.map((item, i) => {
          const level = Math.min(100, Math.max(0, Number(item.level) || 0));
          return (
            <li
              key={item.id ?? item.name}
              className="cx-sys-item"
              style={{ '--i': i, '--level': `${level}%` }}
              tabIndex={0}
              onFocus={() => setFocus(category)}
              onBlur={() => setFocus('')}
            >
              <span className="cx-sys-name">{item.name}</span>
              <span
                className="cx-sys-meter"
                role="meter"
                aria-valuenow={level}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${item.name} proficiency`}
              >
                <span className="cx-sys-fill" />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ActSystem({ stack = [], content = {}, id }) {
  const [focus, setFocus] = useState('');
  if (stack.length === 0) return null;

  // Grouped in insertion order so the admin's sort order survives: a plain
  // object preserves insertion order for non-numeric string keys, and these are
  // category names.
  const grouped = stack.reduce((acc, item) => {
    const key = item.category || copy(content, 'cine.sysOther', 'Other');
    (acc[key] ||= []).push(item);
    return acc;
  }, {});

  return (
    <section className="cx-act cx-system" id={id} data-tone="paper">
      <div className="cx-system-inner">
        <header className="cx-act-head">
          <span className="cx-eyebrow">{copy(content, 'stack.eyebrow', 'Toolkit')}</span>
          <h2 className="cx-act-title">
            {copy(content, 'stack.title', 'Technologies I work with')}
          </h2>
        </header>

        <div className="cx-sys-grid" onPointerLeave={() => setFocus('')}>
          {Object.entries(grouped).map(([category, items], index) => (
            <Column
              key={category}
              category={category}
              items={items}
              index={index}
              focus={focus}
              setFocus={setFocus}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
