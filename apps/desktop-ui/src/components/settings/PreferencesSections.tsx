import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { BrowserCookie, BrowserProfile, WiggleSettings } from '../../store/useWiggleStore';
import { playAttentionSound } from '../../lib/notify';
import { SHORTCUTS, shortcutFor, shortcutFromEvent } from '../../lib/shortcuts';
import {
  Callout,
  ChipList,
  Group,
  Intro,
  Note,
  NumberField,
  Row,
  Segmented,
  SelectField,
  Stats,
  TextField,
  Toggle,
  useSave,
  type SectionProps,
} from './primitives';

const FALLBACK: WiggleSettings = {} as WiggleSettings;

type Settings = WiggleSettings;

const useSettings = (store: SectionProps['store']): Settings => store.settings ?? FALLBACK;

/* -------------------------------------------------------------------------- */
/* General                                                                     */
/* -------------------------------------------------------------------------- */

export const GeneralSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);

  return (
    <>
      <Intro>
        Workspace behaviour for this machine. Changes apply immediately; project instructions still override agent
        behaviour per repository.
      </Intro>

      <Group title="Workspace">
        <Row
          title="Interface layout"
          description="Software engineering shows the agent swarm and code tools. Knowledge work keeps the same chat without the engineering rail items."
        >
          <Segmented
            label="Interface layout"
            value={settings.interfaceLayout ?? 'software'}
            onChange={(next) => void save({ interfaceLayout: next as WiggleSettings['interfaceLayout'] })}
            options={[
              { value: 'software', label: 'Software engineering' },
              { value: 'knowledge', label: 'Knowledge work' },
            ]}
          />
        </Row>
        <Row title="Start view" description="Which view opens when the app starts.">
          <SelectField
            label="Start view"
            value={settings.startupView ?? 'chat'}
            onChange={(next) => void save({ startupView: next as WiggleSettings['startupView'] })}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'agents', label: 'Agent swarm' },
            ]}
          />
        </Row>
        <Row
          title="Auto-accept permissions"
          description="Let the agent read, write and run without asking. Destructive shell patterns stay blocked."
        >
          <Toggle
            label="Auto-accept permissions"
            checked={settings.approvalMode === 'full_auto'}
            onChange={(next) =>
              void save({ approvalMode: next ? 'full_auto' : 'suggest' }).then(() =>
                notify(next ? 'Permissions are auto-accepted.' : 'Permissions ask again.', true),
              )
            }
          />
        </Row>
      </Group>

      <Group title="Conversation">
        <Row title="Transcript width" description="Narrower lines are easier to scan; wider lines show more at once.">
          <Segmented
            label="Transcript width"
            value={settings.transcriptWidth ?? 'comfortable'}
            onChange={(next) => void save({ transcriptWidth: next as WiggleSettings['transcriptWidth'] })}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'comfortable', label: 'Default' },
              { value: 'wide', label: 'Wide' },
            ]}
          />
        </Row>
        <Row title="Default transcript view" description="How much tool detail is expanded when a turn streams in.">
          <SelectField
            label="Default transcript view"
            value={settings.defaultTranscriptView ?? 'normal'}
            onChange={(next) => void save({ defaultTranscriptView: next as WiggleSettings['defaultTranscriptView'] })}
            options={[
              { value: 'normal', label: 'Normal — tool cards collapsed' },
              { value: 'thinking', label: 'Thinking — show notices' },
              { value: 'verbose', label: 'Verbose — tool cards expanded' },
            ]}
          />
        </Row>
        <Row title="Output style" description="How replies are written. It is compiled into the system prompt on every turn.">
          <SelectField
            label="Output style"
            value={settings.outputStyle ?? 'default'}
            onChange={(next) => void save({ outputStyle: next as WiggleSettings['outputStyle'] })}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'concise', label: 'Concise — outcome first' },
              { value: 'explanatory', label: 'Explanatory — why each change' },
              { value: 'learning', label: 'Learning — teach as it works' },
            ]}
          />
        </Row>
        <Row title="Changed files" description="List the files each turn touched when it finishes.">
          <Toggle
            label="Changed files"
            checked={settings.showChangedFiles !== false}
            onChange={(next) => void save({ showChangedFiles: next })}
          />
        </Row>
        <Row title="Dynamic workflows" description="Allow the swarm planner to run several specialised roles for one task.">
          <Toggle
            label="Dynamic workflows"
            checked={settings.dynamicWorkflows !== false}
            onChange={(next) => void save({ dynamicWorkflows: next })}
          />
        </Row>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Appearance                                                                  */
/* -------------------------------------------------------------------------- */

export const AppearanceSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);

  return (
    <>
      <Intro>
        Flat surfaces, hairline dividers and one accent-free palette. Themes only change colour tokens; layout and
        contrast rules stay the same.
      </Intro>

      <Group title="Interface">
        <Row
          title="UI theme"
          description="Classic keeps the graphite workspace. Modern switches the entire app — shell, sidebar, chat, browser, settings and composer — to the Freebuff Desktop interface."
        >
          <Segmented
            label="UI theme"
            value={settings.uiTheme ?? 'classic'}
            onChange={(next) => void save({ uiTheme: next as WiggleSettings['uiTheme'] })}
            options={[
              { value: 'classic', label: 'Classic' },
              { value: 'modern', label: 'Modern' },
            ]}
          />
        </Row>
        {(settings.uiTheme ?? 'classic') === 'modern' && (
          <Row
            title="Premium theme"
            description="Palettes that ship with the Modern interface. Freebuff is the stock look; the rest retune every surface, line and accent."
          >
            <SelectField
              label="Premium theme"
              value={settings.uiPalette ?? 'freebuff'}
              onChange={(next) => void save({ uiPalette: next })}
              options={[
                { value: 'freebuff', label: 'Freebuff (default)' },
                { value: 'nord', label: 'Nord' },
                { value: 'dracula', label: 'Dracula' },
                { value: 'tokyo-night', label: 'Tokyo Night' },
                { value: 'gruvbox', label: 'Gruvbox' },
                { value: 'one-dark', label: 'One Dark' },
                { value: 'catppuccin', label: 'Catppuccin' },
                { value: 'catppuccin-latte', label: 'Catppuccin Latte' },
                { value: 'rose-pine', label: 'Rosé Pine' },
                { value: 'solarized-light', label: 'Solarized Light' },
                { value: 'cyberpunk', label: 'Cyberpunk' },
                { value: 'matrix', label: 'Matrix' },
                { value: 'amber-crt', label: 'Amber CRT' },
                { value: 'vaporwave', label: 'Vaporwave' },
                { value: 'midnight-blue', label: 'Midnight Blue' },
                { value: 'high-contrast', label: 'High Contrast' },
              ]}
            />
          </Row>
        )}
      </Group>

      <Group title="Theme">
        <Row title="Colour scheme" description="Follow the system, or pin one of the built-in monochrome themes.">
          <SelectField
            label="Colour scheme"
            value={settings.theme ?? 'dark'}
            onChange={(next) => void save({ theme: next })}
            options={[
              { value: 'system', label: 'Follow system' },
              { value: 'graphite', label: 'Graphite (warm dark)' },
              { value: 'light', label: 'Cream (warm light)' },
              { value: 'dark', label: 'Carbon' },
              { value: 'obsidian', label: 'Obsidian' },
              { value: 'midnight', label: 'Midnight' },
              { value: 'porcelain', label: 'Porcelain' },
            ]}
          />
        </Row>
        <Row title="Contrast" description="Stronger text and divider steps for bright rooms or low-quality panels.">
          <Segmented
            label="Contrast"
            value={settings.contrast ?? 'default'}
            onChange={(next) => void save({ contrast: next as WiggleSettings['contrast'] })}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'strong', label: 'Strong' },
            ]}
          />
        </Row>
        <Row title="Density" description="Compact removes vertical padding in lists and rows.">
          <Segmented
            label="Density"
            value={settings.density ?? 'comfortable'}
            onChange={(next) => void save({ density: next as WiggleSettings['density'] })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Type">
        <Row title="Interface font" description="Used for menus, panels and the transcript.">
          <SelectField
            label="Interface font"
            value={settings.uiFont ?? 'inter'}
            onChange={(next) => void save({ uiFont: next })}
            options={[
              { value: 'inter', label: 'Inter' },
              { value: 'segoe', label: 'Segoe UI' },
              { value: 'cascadia', label: 'Cascadia' },
              { value: 'mono', label: 'JetBrains Mono' },
            ]}
          />
        </Row>
        <Row title="Code font" description="Used for open files, diffs, code blocks, the terminal and paths.">
          <TextField
            label="Code font"
            value={settings.codeFont ?? ''}
            placeholder="JetBrains Mono"
            onCommit={(next) => void save({ codeFont: next })}
          />
        </Row>
        <Row title="Code font size" description="Applies to the editor, diffs, command output and code blocks.">
          <NumberField
            label="Code font size"
            value={settings.codeFontSize ?? 13}
            min={10}
            max={24}
            suffix="px"
            onCommit={(next) => void save({ codeFontSize: next })}
          />
        </Row>
      </Group>

      <Group title="Motion">
        <Row title="Reduce motion" description="Remove transitions and looping animations across the app.">
          <Toggle
            label="Reduce motion"
            checked={Boolean(settings.reduceMotion)}
            onChange={(next) => void save({ reduceMotion: next })}
          />
        </Row>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export const NotificationsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);
  const [permission, setPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') {
      notify('This window does not support system notifications.', false);
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    notify(result === 'granted' ? 'Notifications enabled.' : 'Notifications were not granted.', result === 'granted');
  };

  return (
    <>
      <Intro>Choose when the app asks for your attention outside the window. Sounds are generated locally.</Intro>

      {permission !== 'granted' && permission !== 'unsupported' && (
        <Callout>
          System notifications are not allowed yet.{' '}
          <button className="btn-flat btn-compact" style={{ marginLeft: 8 }} onClick={() => void requestPermission()}>
            Enable notifications
          </button>
        </Callout>
      )}

      <Group title="Desktop notifications">
        <Row title="Agent finished" description="Notify when a turn completes or the agent needs attention.">
          <Toggle
            label="Agent finished notifications"
            checked={settings.notifyAgent !== false}
            onChange={(next) => void save({ notifyAgent: next })}
          />
        </Row>
        <Row title="Permission required" description="Notify when a tool call is waiting for approval.">
          <Toggle
            label="Permission notifications"
            checked={settings.notifyPermissions !== false}
            onChange={(next) => void save({ notifyPermissions: next })}
          />
        </Row>
        <Row title="Errors" description="Notify when a turn fails.">
          <Toggle
            label="Error notifications"
            checked={settings.notifyErrors !== false}
            onChange={(next) => void save({ notifyErrors: next })}
          />
        </Row>
        <Row title="Flash the window title" description="Pulse the title when the window is not focused.">
          <Toggle
            label="Flash window title"
            checked={settings.flashTaskbar !== false}
            onChange={(next) => void save({ flashTaskbar: next })}
          />
        </Row>
      </Group>

      <Group title="Sound">
        <Row title="Sound effects" description="Play a short tone when a turn finishes or an approval arrives.">
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-flat btn-compact" onClick={() => playAttentionSound()}>
              Play test
            </button>
            <Toggle
              label="Sound effects"
              checked={settings.notifySound !== false}
              onChange={(next) => void save({ notifySound: next })}
            />
          </div>
        </Row>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */

export const EditorSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);

  return (
    <>
      <Intro>The workspace editor is a plain monospace surface with inline diffs. These preferences apply to every tab.</Intro>

      <Group title="Code">
        <Row title="Tab size" description="Spaces inserted when you press Tab in a file.">
          <NumberField
            label="Tab size"
            value={settings.editorTabSize ?? 2}
            min={1}
            max={8}
            onCommit={(next) => void save({ editorTabSize: next })}
          />
        </Row>
        <Row title="Word wrap" description="Wrap long lines instead of scrolling horizontally.">
          <Toggle
            label="Word wrap"
            checked={settings.editorWrap !== false}
            onChange={(next) => void save({ editorWrap: next })}
          />
        </Row>
        <Row title="Line numbers" description="Show the line gutter beside the editor.">
          <Toggle
            label="Line numbers"
            checked={settings.editorLineNumbers !== false}
            onChange={(next) => void save({ editorLineNumbers: next })}
          />
        </Row>
      </Group>

      <Group title="Files">
        <Row title="Auto-save" description="Write the file two seconds after you stop typing. Every save is snapshotted.">
          <Toggle
            label="Auto-save"
            checked={Boolean(settings.editorAutoSave)}
            onChange={(next) => void save({ editorAutoSave: next })}
          />
        </Row>
        <Row title="Spellcheck" description="Underline misspelled words in the composer and the editor.">
          <Toggle
            label="Spellcheck"
            checked={settings.spellcheck !== false}
            onChange={(next) => void save({ spellcheck: next })}
          />
        </Row>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Terminal                                                                    */
/* -------------------------------------------------------------------------- */

export const TerminalSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);

  return (
    <>
      <Intro>The terminal runs inside the workspace under the permission screen. Destructive commands are refused.</Intro>

      <Group title="Shell">
        <Row
          title="Terminal shell"
          description="Shell used by the terminal pane. Auto follows the platform default. Agent commands still use the system shell."
        >
          <SelectField
            label="Terminal shell"
            value={settings.terminalShell ?? 'auto'}
            onChange={(next) => void save({ terminalShell: next as WiggleSettings['terminalShell'] })}
            options={[
              { value: 'auto', label: 'Auto (platform default)' },
              { value: 'powershell', label: 'PowerShell' },
              { value: 'cmd', label: 'Command Prompt' },
              { value: 'bash', label: 'Bash' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Display">
        <Row title="Terminal font size" description="Applies to terminal output and the command line.">
          <NumberField
            label="Terminal font size"
            value={settings.terminalFontSize ?? 13}
            min={10}
            max={24}
            suffix="px"
            onCommit={(next) => void save({ terminalFontSize: next })}
          />
        </Row>
        <Row title="Scrollback" description="Characters kept in the session log. Older output is dropped first.">
          <NumberField
            label="Terminal scrollback"
            value={settings.terminalScrollback ?? 4000}
            min={500}
            max={20000}
            step={500}
            suffix="chars"
            onCommit={(next) => void save({ terminalScrollback: next })}
          />
        </Row>
        <Row title="Clear the terminal log" description="Removes the current session output. Files are untouched.">
          <button className="btn-flat btn-compact" onClick={() => store.setTerminalLog('')}>
            <Trash2 size={11} /> Clear log
          </button>
        </Row>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Browser                                                                     */
/* -------------------------------------------------------------------------- */

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const BrowserSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);
  const profiles: BrowserProfile[] = settings.browserProfiles ?? [];
  const active = profiles.find((profile) => profile.id === settings.activeBrowserProfile) ?? profiles[0] ?? null;
  const [newProfile, setNewProfile] = useState('');
  const [cookie, setCookie] = useState({ domain: '', name: '', value: '', path: '/' });

  const persistProfiles = (list: BrowserProfile[], activeId?: string) =>
    save({ browserProfiles: list, ...(activeId ? { activeBrowserProfile: activeId } : {}) });

  const updateActive = (patch: Partial<BrowserProfile>) => {
    if (!active) return Promise.resolve(null);
    return persistProfiles(profiles.map((profile) => (profile.id === active.id ? { ...profile, ...patch } : profile)));
  };

  const addCookie = () => {
    if (!active || !cookie.domain.trim() || !cookie.name.trim()) {
      notify('A cookie needs a domain and a name.', false);
      return;
    }
    const next: BrowserCookie = { id: newId(), ...cookie, domain: cookie.domain.trim().replace(/^\./, '') };
    void persistProfiles(
      profiles.map((profile) => (profile.id === active.id ? { ...profile, cookies: [...profile.cookies, next] } : profile)),
    ).then(() => {
      setCookie({ domain: cookie.domain, name: '', value: '', path: '/' });
      notify('Cookie stored for this profile.', true);
    });
  };

  return (
    <>
      <Intro>
        The preview pane renders localhost apps in an embedded frame and falls back to readable-text extraction for
        sites that refuse framing. Extraction is also the tool the agent reads pages with — every request uses the active
        profile's user agent, cookies and host list.
      </Intro>

      <Group title="Profiles">
        {profiles.length === 0 && (
          <Note>No profile yet. The first profile you create becomes active and is used by browser inspect.</Note>
        )}
        {profiles.length > 0 && (
          <Row title="Active profile" description="Cookies, user agent and host limits come from this profile.">
            <select
              className="select-flat"
              aria-label="Active browser profile"
              value={active?.id ?? ''}
              onChange={(event) => void save({ activeBrowserProfile: event.target.value })}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {active && (
          <>
            <Row title="Name" description="Shown in the profile picker and in inspect replies.">
              <TextField label="Profile name" value={active.name} placeholder="Work" onCommit={(next) => updateActive({ name: next || active.name })} />
            </Row>
            <Row title="User agent" description="Leave empty for the default Tervixa Wiggle agent.">
              <TextField
                label="Profile user agent"
                mono
                value={active.userAgent}
                placeholder="Mozilla/5.0 …"
                onCommit={(next) => updateActive({ userAgent: next })}
              />
            </Row>
            <Row title="Allowed hosts" description="Restrict browser inspect to these hosts for this profile. Empty allows the global list.">
              <ChipList
                label="Profile allowed hosts"
                values={active.allowedHosts}
                placeholder="docs.example.com"
                onChange={(next) => updateActive({ allowedHosts: next })}
              />
            </Row>
            <div className="detail-actions">
              <button
                className="btn-flat btn-compact"
                onClick={() => {
                  if (!window.confirm(`Delete the “${active.name}” profile and its ${active.cookies.length} cookies?`)) return;
                  const rest = profiles.filter((profile) => profile.id !== active.id);
                  void persistProfiles(rest, rest[0]?.id ?? '').then(() => notify('Profile deleted.', true));
                }}
              >
                <Trash2 size={11} /> Delete profile
              </button>
            </div>
          </>
        )}
        <div className="inline-row" style={{ paddingTop: 8 }}>
          <input
            className="input-flat"
            aria-label="New profile name"
            placeholder="New profile name"
            value={newProfile}
            onChange={(event) => setNewProfile(event.target.value)}
          />
          <button
            className="btn-primary"
            disabled={!newProfile.trim()}
            onClick={() => {
              const profile: BrowserProfile = {
                id: newId(),
                name: newProfile.trim(),
                userAgent: '',
                allowedHosts: [],
                cookies: [],
              };
              void persistProfiles([...profiles, profile], profile.id).then(() => {
                setNewProfile('');
                notify(`Profile “${profile.name}” created.`, true);
              });
            }}
          >
            <Plus size={12} /> Add profile
          </button>
        </div>
      </Group>

      <Group title={active ? `Cookies — ${active.name}` : 'Cookies'}>
        {active?.cookies.map((entry) => (
          <div className="list-row" key={entry.id}>
            <div className="list-row-main">
              <strong className="mono" style={{ fontSize: 11 }}>
                {entry.name}
                <span className="list-row-sub"> · {entry.domain}{entry.path && entry.path !== '/' ? entry.path : ''}</span>
              </strong>
              <span className="list-row-sub mono">{entry.value === '[stored]' ? (entry.hasValue ? 'value stored' : 'empty') : entry.value}</span>
            </div>
            <div className="list-row-actions">
              <button
                className="icon-btn"
                title="Delete cookie"
                onClick={() =>
                  void persistProfiles(
                    profiles.map((profile) =>
                      profile.id === active.id
                        ? { ...profile, cookies: profile.cookies.filter((candidate) => candidate.id !== entry.id) }
                        : profile,
                    ),
                  )
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {active && active.cookies.length === 0 && <div className="catalog-empty">No cookies stored for this profile.</div>}
        <Row title="Add a cookie" description="Sent only to the domain you name. Values are stored on this machine and never returned to the interface.">
          <div className="cookie-form">
            <input
              className="input-flat mono"
              aria-label="Cookie domain"
              placeholder="example.com"
              value={cookie.domain}
              onChange={(event) => setCookie({ ...cookie, domain: event.target.value })}
            />
            <input
              className="input-flat mono"
              aria-label="Cookie name"
              placeholder="session"
              value={cookie.name}
              onChange={(event) => setCookie({ ...cookie, name: event.target.value })}
            />
            <input
              className="input-flat mono"
              aria-label="Cookie value"
              type="password"
              placeholder="value"
              value={cookie.value}
              onChange={(event) => setCookie({ ...cookie, value: event.target.value })}
            />
            <button className="btn-flat btn-compact" disabled={!active} onClick={addCookie}>
              <Plus size={11} /> Add
            </button>
          </div>
        </Row>
        {active && active.cookies.length > 0 && (
          <div className="detail-actions">
            <button
              className="btn-flat btn-compact"
              onClick={() => void updateActive({ cookies: [] }).then(() => notify('Profile cookies cleared.', true))}
            >
              <Trash2 size={11} /> Clear all cookies
            </button>
          </div>
        )}
      </Group>

      <Group title="Browser tools">
        <Row title="Send cookies with inspect" description="Attach this profile's cookies to the pages the agent reads.">
          <Toggle
            label="Send cookies"
            checked={settings.browserSendCookies !== false}
            onChange={(next) => void save({ browserSendCookies: next })}
          />
        </Row>
        <Row title="Allow browser access" description="The agent may fetch and read pages with the browser inspect tool.">
          <Toggle
            label="Browser tools"
            checked={settings.browserTools !== false}
            onChange={(next) => void save({ browserTools: next })}
          />
        </Row>
        <Row title="Home URL" description="Opened when the preview pane starts.">
          <TextField
            label="Browser home"
            mono
            value={settings.browserHome ?? ''}
            placeholder="http://localhost:5173"
            onCommit={(next) => void save({ browserHome: next })}
          />
        </Row>
        <Row
          title="Allowed sites"
          description="When this list is not empty, extraction is restricted to these hosts. Leave it empty to allow any http(s) host."
        >
          <ChipList
            label="Allowed sites"
            values={settings.browserAllowedHosts ?? []}
            placeholder="example.com"
            onChange={(next) => void save({ browserAllowedHosts: next })}
          />
        </Row>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Shortcuts                                                                   */
/* -------------------------------------------------------------------------- */

const KeyCapture: React.FC<{
  value: string;
  onChange: (next: string) => void;
  onReset: () => void;
}> = ({ value, onChange, onReset }) => {
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        ref={ref}
        className={`wg-keybtn ${capturing ? 'is-capturing' : ''}`}
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        onKeyDown={(event) => {
          if (!capturing) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') {
            setCapturing(false);
            return;
          }
          if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
          onChange(shortcutFromEvent(event));
          setCapturing(false);
        }}
        aria-label="Record shortcut"
      >
        {capturing ? 'Press keys…' : value || 'Unassigned'}
      </button>
      <button className="btn-flat btn-compact" onClick={onReset} title="Reset to default">
        Reset
      </button>
    </div>
  );
};

export const ShortcutsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);
  const overrides = settings.shortcutOverrides ?? {};

  return (
    <>
      <Intro>
        Shortcuts are global to the window. Click a key to record a new combination, then press it. Escape cancels.
      </Intro>
      <Group title="Application">
        {SHORTCUTS.map((shortcut) => (
          <Row key={shortcut.id} title={shortcut.label} description={shortcut.description}>
            <KeyCapture
              value={shortcutFor(shortcut.id, overrides)}
              onChange={(next) => {
                void save({ shortcutOverrides: { ...overrides, [shortcut.id]: next } });
                notify(`${shortcut.label}: ${next}`, true);
              }}
              onReset={() => {
                const next = { ...overrides };
                delete next[shortcut.id];
                void save({ shortcutOverrides: next });
              }}
            />
          </Row>
        ))}
      </Group>
      <Note>Recording is limited to combinations the window can receive; reserved OS shortcuts are ignored by Windows first.</Note>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Usage / privacy / import                                                    */
/* -------------------------------------------------------------------------- */

export const UsageSection: React.FC<SectionProps> = ({ store, notify }) => {
  const sessions = store.sessions;
  const messages = sessions.reduce((total, session) => total + session.messages.length, 0);
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const usage = store.usage;

  useEffect(() => {
    void store.loadUsage(days).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const peak = Math.max(1, ...(usage?.buckets ?? []).map((bucket) => bucket.input + bucket.output));
  const label = (day: string) => day.slice(5).replace('-', '/');

  return (
    <>
      <Intro>Every chat turn that reports token usage is recorded on this machine. The provider's own dashboard stays authoritative.</Intro>
      <div className="inline-row" style={{ marginBottom: 10 }}>
        <div className="segmented">
          {[7, 14, 30].map((value) => (
            <button key={value} className={`segmented-btn ${days === value ? 'active' : ''}`} onClick={() => setDays(value)}>
              {value} days
            </button>
          ))}
        </div>
        <button
          className="btn-flat btn-compact"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void store.loadUsage(days).finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Refresh
        </button>
        <button
          className="btn-flat btn-compact"
          onClick={() =>
            void store.clearUsage().then(() => notify('Usage history cleared.', true))
          }
        >
          <Trash2 size={11} /> Clear history
        </button>
      </div>

      <Stats
        items={[
          { label: `Input tokens (${days}d)`, value: (usage?.totals.input ?? 0).toLocaleString() },
          { label: `Output tokens (${days}d)`, value: (usage?.totals.output ?? 0).toLocaleString() },
          { label: 'Recorded turns', value: usage?.totals.turns ?? 0 },
          { label: 'This window (estimate)', value: `~${store.tokenEstimate.toLocaleString()}` },
        ]}
      />

      <Group title="Daily tokens">
        <div className="usage-chart" role="img" aria-label={`Daily token usage for the last ${days} days`}>
          {(usage?.buckets ?? []).map((bucket) => {
            const total = bucket.input + bucket.output;
            return (
              <div className="usage-col" key={bucket.day} title={`${bucket.day}: ${bucket.input.toLocaleString()} input, ${bucket.output.toLocaleString()} output, ${bucket.turns} turns`}>
                <div className="usage-bar" style={{ height: `${Math.max(2, (total / peak) * 100)}%` }}>
                  <div className="usage-in" style={{ flexGrow: bucket.input || 0.0001 }} />
                  <div className="usage-out" style={{ flexGrow: bucket.output || 0.0001 }} />
                </div>
                <span className="usage-day">{label(bucket.day)}</span>
              </div>
            );
          })}
          {!usage && <div className="catalog-empty">No usage recorded yet.</div>}
        </div>
        <div className="inline-row" style={{ gap: 14, paddingTop: 6 }}>
          <span className="field-hint">
            <span className="usage-swatch usage-swatch-in" /> input
          </span>
          <span className="field-hint">
            <span className="usage-swatch usage-swatch-out" /> output
          </span>
          <span className="field-hint">{usage?.recorded ?? 0} turns stored on this machine</span>
        </div>
      </Group>

      <Group title="By model">
        <div className="kv-table">
          <div className="kv-row" style={{ fontWeight: 530 }}>
            <span>Model</span>
            <strong>input · output · turns</strong>
          </div>
          {(usage?.models ?? []).map((model) => (
            <div className="kv-row" key={model.model}>
              <span className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>
                {model.model}
              </span>
              <strong className="mono" style={{ fontSize: 10.5 }}>
                {model.input.toLocaleString()} · {model.output.toLocaleString()} · {model.turns}
              </strong>
            </div>
          ))}
        </div>
        {(usage?.models.length ?? 0) === 0 && <div className="catalog-empty">No model usage in this window.</div>}
      </Group>

      <Group title="This window">
      <Stats
        items={[
          { label: 'Sessions', value: sessions.length },
          { label: 'Messages', value: messages },
          { label: 'Undo snapshots', value: store.status?.undoCount ?? 0 },
        ]}
      />
      </Group>
      <Group title="Binding">
        <Row title="Active provider" description="Configured in Settings → Models.">
          <span className="mono" style={{ fontSize: 11 }}>
            {store.status?.configured ? `${store.status.provider} · ${store.status.model}` : 'No provider configured'}
          </span>
        </Row>
        <Row title="Ready state" description="A provider is ready when its route and key resolve.">
          <span className="mono" style={{ fontSize: 11 }}>
            {store.status?.ready ? 'ready' : store.status?.configured ? 'key missing' : 'unconfigured'}
          </span>
        </Row>
      </Group>
      <Note>Cost estimates are intentionally not shown: rates change per provider and model.</Note>
    </>
  );
};

export const PrivacySection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const save = useSave(store, notify);
  return (
    <>
      <Intro>
        The gateway binds to loopback only. Prompts go directly to the provider you configure; Tervixa receives nothing.
      </Intro>
      <Callout>
        Stored on this machine: settings, API keys (owner-only permissions), memories, snapshots and installed plugins.
        Nothing is uploaded.
      </Callout>
      <Group title="Memory">
        <Row title="Learn durable facts" description="Let the agent propose facts after a turn. They are injected only when relevant.">
          <Toggle
            label="Memory extraction"
            checked={settings.memoryAutoExtract !== false}
            onChange={(next) => void save({ memoryAutoExtract: next })}
          />
        </Row>
      </Group>
      <Group title="Local data">
        <Row title="Clear this window's sessions" description="Removes the conversations stored in this window. Memory and files are untouched.">
          <button
            className="btn-flat btn-compact"
            onClick={() => {
              store.clearSessions();
              notify('Sessions cleared for this window.', true);
            }}
          >
            <Trash2 size={11} /> Clear sessions
          </button>
        </Row>
      </Group>
    </>
  );
};

const download = (name: string, body: string) => {
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const ImportExportSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = useSettings(store);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportSettings = () => {
    const safe = JSON.parse(JSON.stringify(settings)) as Record<string, any>;
    delete safe.keyStatus;
    for (const server of Object.values(safe.mcpServers ?? {})) {
      if (server && typeof server === 'object') (server as Record<string, unknown>).token = '';
    }
    safe.exportedAt = new Date().toISOString();
    download('tervixa-wiggle-settings.json', JSON.stringify(safe, null, 2));
    notify('Settings exported without keys or tokens.', true);
  };

  const exportSessions = () => {
    download(
      'tervixa-wiggle-sessions.json',
      JSON.stringify(
        store.sessions.map((session) => ({
          name: session.name,
          messages: session.messages.map((message) => ({ role: message.role, text: message.text })),
        })),
        null,
        2,
      ),
    );
    notify('Sessions exported.', true);
  };

  return (
    <>
      <Intro>Move preferences between machines. Keys and connector tokens are never included in an export.</Intro>
      <Group title="Export">
        <Row title="Settings" description="A JSON file with your preferences, minus credentials.">
          <button className="btn-flat btn-compact" onClick={exportSettings}>
            <Download size={11} /> Export settings
          </button>
        </Row>
        <Row title="Sessions" description="Plain text transcripts of every session in this window.">
          <button className="btn-flat btn-compact" onClick={exportSessions}>
            <Download size={11} /> Export sessions
          </button>
        </Row>
      </Group>
      <Group title="Import">
        <Row title="Settings" description="Load a previously exported settings file. Credentials are not restored.">
          <button className="btn-flat btn-compact" onClick={() => fileRef.current?.click()}>
            <Upload size={11} /> Import settings
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
                if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a settings export.');
                delete parsed.keyStatus;
                delete parsed.exportedAt;
                delete parsed.apiKeys;
                await store.saveSettings(parsed as Partial<WiggleSettings>);
                notify('Settings imported.', true);
              } catch (error) {
                notify(error instanceof Error ? error.message : 'Could not read that file.', false);
              }
            }}
          />
        </Row>
      </Group>
    </>
  );
};

export const SystemSection: React.FC<SectionProps> = ({ store, notify }) => {
  const status = store.status;
  return (
    <>
      <Intro>Runtime facts for this installation. The workbench and the gateway ship together in the installer.</Intro>
      <Stats
        items={[
          { label: 'Version', value: status?.version ?? '1.0.0' },
          { label: 'Platform', value: status?.platform ?? '—' },
          { label: 'Undo / redo', value: `${status?.undoCount ?? 0} / ${status?.redoCount ?? 0}` },
          { label: 'Workspace files', value: store.tree.length },
        ]}
      />
      <Group title="Paths">
        <Row title="Workspace" description="Tools are confined to this directory.">
          <span className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all', textAlign: 'right' }}>
            {status?.workspaceRoot ?? '—'}
          </span>
        </Row>
        <Row title="Configuration" description="Settings, memories, snapshots and installed plugins.">
          <span className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all', textAlign: 'right' }}>
            {store.configDir || status?.configDir || '—'}
          </span>
        </Row>
        <Row title="Gateway" description="The local engine is bound to loopback and follows the app lifecycle.">
          <span className="mono" style={{ fontSize: 10.5 }}>
            127.0.0.1:4317
          </span>
        </Row>
      </Group>
      <Group title="Maintenance">
        <Row title="Reload configuration" description="Re-read settings, status, skills, memory and installed extensions.">
          <button className="btn-flat btn-compact" onClick={() => void store.refreshAll().then(() => notify('Configuration reloaded.', true))}>
            <RefreshCw size={11} /> Reload
          </button>
        </Row>
        <Row title="Catalog health" description="Bundled provider, plugin and connector catalogs.">
          <span className="mono" style={{ fontSize: 10.5 }}>
            {store.providers.items.length} providers · {store.pluginCatalogTotal} plugins · {store.connectors.items.length} connectors
          </span>
        </Row>
      </Group>
    </>
  );
};

export const AboutSection: React.FC<SectionProps> = ({ store }) => (
  <>
    <div className="about-brand">
      <span className="about-mark">TERVIXA WIGGLE</span>
      <h3>Tervixa Wiggle developed by Tervixa Corporation.</h3>
      <p>
        Version {store.status?.version || '1.0.0'} · built by Tervixa Corporation. The identity above is compiled into
        every conversation and cannot be replaced by project instructions.
      </p>
    </div>
    <div className="kv-table">
      <div className="kv-row">
        <span>License</span>
        <strong>MIT</strong>
      </div>
      <div className="kv-row">
        <span>Runtime</span>
        <strong>Tauri shell + bundled local engine</strong>
      </div>
      <div className="kv-row">
        <span>Interface</span>
        <strong>React 19, flat monochrome</strong>
      </div>
      <div className="kv-row">
        <span>Plugin catalog</span>
        <strong>{store.pluginCatalogTotal} Claude Code marketplace plugins</strong>
      </div>
      <div className="kv-row">
        <span>Connectors</span>
        <strong>
          {store.connectorStats.remote} remote MCP · {store.connectorStats.hosted} hosted apps
        </strong>
      </div>
    </div>
  </>
);
