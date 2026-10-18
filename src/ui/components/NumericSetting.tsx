import { useEffect, useState } from 'react';
import { decimalPlaces, validNumeric } from '../../settings/numeric';

/** One validated value shared by a range and a keyboard-friendly precise input. */
export function NumericSetting({
  id,
  label,
  value,
  min,
  max,
  step,
  unit = '',
  disabled = false,
  description,
  sliderMax,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  description?: string;
  sliderMax?: number;
  onChange: (value: number) => void;
}) {
  const format = (n: number) => n.toFixed(decimalPlaces(step));
  const [draft, setDraft] = useState(() => format(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft((previous) =>
      previous.trim() !== '' && Number(previous) === value ? previous : format(value),
    );
  }, [value, step]);
  const accept = (text: string) => {
    setDraft(text);
    const next = text.trim() === '' ? NaN : Number(text);
    const valid = validNumeric(next, min, max, step);
    setInvalid(!valid);
    if (valid) onChange(next);
  };
  const restore = () => {
    setDraft(format(value));
    setInvalid(false);
  };
  return (
    <div className="range-field">
      <label htmlFor={id}>{label}</label>
      <div className="numeric-controls">
        <input
          id={id}
          type="range"
          min={min}
          max={sliderMax ?? max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft(format(next));
            setInvalid(false);
            onChange(next);
          }}
        />
        <div className="numeric-value">
          <input
            type="number"
            aria-label={`${label} 数值`}
            min={min}
            max={max}
            step={step}
            value={draft}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : `${id}-help`}
            onChange={(event) => accept(event.target.value)}
            onBlur={restore}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                restore();
              }
            }}
          />
          {unit && <span className="numeric-unit">{unit.trim()}</span>}
        </div>
      </div>
      {invalid && (
        <small role="alert" id={`${id}-error`}>
          请输入 {min}–{max}，步长 {step}；无效值不会应用，离开后恢复。
        </small>
      )}
      {description && <small id={`${id}-help`}>{description}</small>}
    </div>
  );
}
