import { Reveal } from '../lib/motion.jsx';
import { copy } from '../lib/api.js';
import '../styles/sections.css';

export default function Stack({ stack = [], content = {} }) {
  if (stack.length === 0) return null;

  // Group by category, preserving the admin-defined sort order within each.
  const grouped = stack.reduce((acc, item) => {
    const key = item.category || 'Other';
    (acc[key] ||= []).push(item);
    return acc;
  }, {});

  return (
    <section className="section" id="stack">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">{copy(content, 'stack.eyebrow', 'Toolkit')}</span>
          </Reveal>
          <Reveal delay={70}>
            <h2 className="h2">{copy(content, 'stack.title', 'Technologies I work with')}</h2>
          </Reveal>
        </div>

        <div className="stack-grid">
          {Object.entries(grouped).map(([category, items], index) => (
            <Reveal key={category} delay={Math.min(index, 4) * 70}>
              <div className="stack-group card">
                <span className="eyebrow">{category}</span>
                <ul className="stack-list">
                  {items.map((item) => (
                    <li key={item.id ?? item.name} className="stack-item">
                      <span className="stack-name">{item.name}</span>
                      <span
                        className="stack-meter"
                        role="meter"
                        aria-valuenow={item.level}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${item.name} proficiency`}
                      >
                        <span
                          className="stack-meter-fill"
                          style={{ '--level': `${Math.min(100, item.level || 0)}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
