import type React from 'react';

// Keyboard shortcut definitions.
//
// A shortcut is stored as a normalised string such as "Ctrl+Shift+K". The app
// matches real key events against the user's override first and the default
// second, so Settings → Shortcuts changes behaviour immediately.

export interface ShortcutDefinition {
  id: string;
  label: string;
  description: string;
  defaultKey: string;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { id: 'palette', label: 'Search files and commands', description: 'Open the command palette.', defaultKey: 'Ctrl+K' },
  { id: 'settings', label: 'Open settings', description: 'Open this settings dialog.', defaultKey: 'Ctrl+,' },
  { id: 'sidebar', label: 'Toggle sidebar', description: 'Show or hide the session and file sidebar.', defaultKey: 'Ctrl+B' },
  { id: 'aux', label: 'Toggle context pane', description: 'Show or hide preview, terminal and context.', defaultKey: 'Ctrl+J' },
  { id: 'newSession', label: 'New session', description: 'Start a fresh conversation.', defaultKey: 'Ctrl+N' },
  { id: 'stopTurn', label: 'Stop the running turn', description: 'Cancel the in-flight model request.', defaultKey: 'Escape' },
];

export const shortcutFor = (id: string, overrides: Record<string, string> = {}) => {
  const custom = overrides[id];
  if (custom && custom.trim()) return custom.trim();
  return SHORTCUTS.find((entry) => entry.id === id)?.defaultKey ?? '';
};

const normaliseKey = (key: string) => {
  if (key === ',') return ',';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
};

/** Serialise a keydown event for display and storage. */
export function shortcutFromEvent(event: KeyboardEvent | React.KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(normaliseKey(event.key));
  return parts.join('+');
}

/** True when this event is the shortcut described by `spec`. */
export function matchesShortcut(event: KeyboardEvent, spec: string): boolean {
  if (!spec) return false;
  const parts = spec.split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.pop() ?? '';
  const wantCtrl = parts.some((part) => /^ctrl$/i.test(part) || /^cmd$/i.test(part));
  const wantAlt = parts.some((part) => /^alt$/i.test(part) || /^option$/i.test(part));
  const wantShift = parts.some((part) => /^shift$/i.test(part));
  const hasCtrl = event.ctrlKey || event.metaKey;
  if (wantCtrl !== hasCtrl) return false;
  if (wantAlt !== event.altKey) return false;
  if (wantShift !== event.shiftKey) return false;
  return normaliseKey(event.key).toLowerCase() === key.toLowerCase();
}

/** Display an override map as human labels for the status bar and palette. */
export function shortcutLabel(id: string, overrides: Record<string, string> = {}) {
  return shortcutFor(id, overrides).replace(/Ctrl/g, 'Ctrl');
}
