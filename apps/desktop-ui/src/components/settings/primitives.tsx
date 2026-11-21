import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { WiggleSettings, WiggleStore } from '../../store/useWiggleStore';

/** Patches may also carry the write-only credential fields the API accepts. */
export type SettingsPatch = Partial<WiggleSettings> & { apiKey?: string; clearApiKey?: boolean };

export type SaveSettings = (patch: SettingsPatch) => Promise<unknown>;

export interface SectionProps {
  store: WiggleStore;
  notify: (text: string, ok?: boolean) => void;
}

/** Rows load their values from the persisted settings object. */
export const useSave = (store: WiggleStore, notify: SectionProps['notify']): SaveSettings => {
  return async (patch) => {
    try {
      return await store.saveSettings(patch);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save that setting.', false);
      throw error;
    }
  };
};

export const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <>
    <div className="wg-set-group">{title}</div>
    {children}
  </>
);

export const Intro: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="wg-set-section-intro">{children}</p>
);

export const Row: React.FC<{
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
}> = ({ title, description, children, htmlFor }) => (
  <div className="wg-row">
    <div className="wg-row-copy">
      <h4>
        {htmlFor ? (
          <label htmlFor={htmlFor}>{title}</label>
        ) : (
          title
        )}
      </h4>
      {description && <p>{description}</p>}
    </div>
    <div className="wg-row-control">{children}</div>
  </div>
);

export const Toggle: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={`toggle ${checked ? 'on' : ''}`}
    onClick={() => onChange(!checked)}
  >
    <span className="toggle-knob" />
  </button>
);

export const SelectField: React.FC<{
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
}> = ({ value, onChange, options, label }) => (
  <select className="select-flat" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

export const Segmented: React.FC<{
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
}> = ({ value, onChange, options, label }) => (
  <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        className={`segmented-btn ${value === option.value ? 'active' : ''}`}
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/**
 * A text input that stages keystrokes locally and commits on blur or Enter, so
 * typing does not write settings.json on every character.
 */
export const TextField: React.FC<{
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  label: string;
  mono?: boolean;
  maxLength?: number;
  type?: 'text' | 'password';
}> = ({ value, onCommit, placeholder, label, mono = false, maxLength, type = 'text' }) => {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    focused.current = false;
    if (draft !== value) onCommit(draft.trim());
  };

  return (
    <input
      type={type}
      className={`input-flat ${mono ? 'mono' : ''}`}
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

export const NumberField: React.FC<{
  value: number;
  onCommit: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
}> = ({ value, onCommit, min, max, step = 1, label, suffix }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <input
      type="number"
      className="input-flat"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onCommit(Math.min(max, Math.max(min, next)));
      }}
    />
    {suffix && <span style={{ fontSize: 10.5, color: 'var(--wg-text-3)' }}>{suffix}</span>}
  </div>
);

/** Editable list of plain strings, used for allowed hosts and the shell allowlist. */
export const ChipList: React.FC<{
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  label: string;
}> = ({ values, onChange, placeholder, label }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  };
  return (
    <div className="wg-chip-input">
      {values.map((value) => (
        <span className="wg-chip-tag" key={value}>
          <span className="mono">{value}</span>
          <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((entry) => entry !== value))}>
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        className="input-flat mono"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
};

export const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="wg-setting-note">{children}</p>;

export const Callout: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="wg-callout">{children}</div>;

export const Stats: React.FC<{ items: Array<{ label: string; value: React.ReactNode }> }> = ({ items }) => (
  <div className="wg-stat-grid">
    {items.map((item) => (
      <div className="wg-stat" key={item.label}>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
      </div>
    ))}
  </div>
);
