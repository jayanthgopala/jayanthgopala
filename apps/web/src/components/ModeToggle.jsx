import { copy } from '../lib/api.js';

/**
 * Switches between the minimal and cinematic presentations.
 *
 * Rendered as two pressable options rather than a single switch: with a lone
 * toggle you can never tell whether the label names the current state or the
 * one you'd get by clicking it.
 */
export default function ModeToggle({ mode, onChoose, content = {} }) {
  const options = [
    { id: 'minimal', label: copy(content, 'theme.minimalLabel', 'Minimal') },
    { id: 'cinematic', label: copy(content, 'theme.cinematicLabel', 'Cinematic') },
  ];

  return (
    <div className="mode-toggle" role="group" aria-label="Presentation mode">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="mode-option"
          aria-pressed={mode === option.id}
          onClick={() => onChoose(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
