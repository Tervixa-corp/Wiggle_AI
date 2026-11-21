import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import type { WiggleStore } from '../store/useWiggleStore';
import { AgentsSection, PermissionsSection } from './settings/AgentSections';
import { MemorySection, PluginsSection, SkillsSection } from './settings/ExtensionSections';
import { ModelSection } from './settings/ModelSection';
import { PullRequestsSection, RemoteSection, WorktreesSection } from './settings/WorkstationSections';
import {
  AboutSection,
  AppearanceSection,
  BrowserSection,
  EditorSection,
  GeneralSection,
  ImportExportSection,
  NotificationsSection,
  PrivacySection,
  ShortcutsSection,
  SystemSection,
  TerminalSection,
  UsageSection,
} from './settings/PreferencesSections';

interface Props {
  store: WiggleStore;
}

interface NavEntry {
  id: string;
  label: string;
  group: 'Preferences' | 'This computer' | 'Customize';
  terms: string;
}

const NAV: NavEntry[] = [
  { id: 'General', label: 'General', group: 'Preferences', terms: 'workspace behaviour layout transcript output style permissions follow-up' },
  { id: 'Appearance', label: 'Appearance', group: 'Preferences', terms: 'theme colour color font density contrast motion' },
  { id: 'Notifications', label: 'Notifications', group: 'Preferences', terms: 'notifications sound alerts flash attention' },
  { id: 'Usage', label: 'Usage', group: 'Preferences', terms: 'tokens cost usage sessions messages' },
  { id: 'Privacy', label: 'Privacy', group: 'Preferences', terms: 'privacy local data memory clear' },
  { id: 'Import & Export', label: 'Import & export', group: 'Preferences', terms: 'backup settings json import export sessions' },
  { id: 'System', label: 'System', group: 'This computer', terms: 'version platform paths configuration gateway developer' },
  { id: 'Browser', label: 'Browser', group: 'This computer', terms: 'browser preview reader allowed sites extraction' },
  { id: 'Editor', label: 'Editor', group: 'This computer', terms: 'editor tab size wrap spellcheck autosave line numbers' },
  { id: 'Terminal', label: 'Terminal', group: 'This computer', terms: 'terminal shell powershell bash scrollback font' },
  { id: 'Worktrees', label: 'Worktrees', group: 'This computer', terms: 'git worktree branch checkout parallel' },
  { id: 'Pull requests', label: 'Pull requests', group: 'This computer', terms: 'github gh pull request pr compare branch push' },
  { id: 'WSL & remote', label: 'WSL & remote', group: 'This computer', terms: 'wsl ssh remote host tunnel pairing distribution' },
  { id: 'Models', label: 'Models & providers', group: 'Customize', terms: 'providers models api keys byok openai anthropic gemini openrouter custom' },
  { id: 'Agents', label: 'Agents', group: 'Customize', terms: 'agents instructions steps swarm roles routing memory prompt' },
  { id: 'Permissions', label: 'Permissions & tools', group: 'Customize', terms: 'permissions approval sandbox tools shell allowlist' },
  { id: 'Plugins', label: 'Plugins & connectors', group: 'Customize', terms: 'plugins connectors mcp apps extensions marketplace skills install' },
  { id: 'Skills', label: 'Skills', group: 'Customize', terms: 'skills markdown instructions skil.md' },
  { id: 'Memory', label: 'Memory', group: 'Customize', terms: 'memory facts learned pin' },
  { id: 'Shortcuts', label: 'Shortcuts', group: 'Customize', terms: 'keyboard shortcuts keybindings hotkeys' },
  { id: 'About', label: 'About', group: 'Customize', terms: 'about version license identity tervixa' },
];

/** Section names used by older call sites and the command palette. */
const ALIASES: Record<string, string> = {
  Providers: 'Models',
  'Agent Behaviour': 'Agents',
  Connectors: 'Plugins',
  'Permissions & Tools': 'Permissions',
};

const SECTIONS: Record<string, React.ComponentType<{ store: WiggleStore; notify: (text: string, ok?: boolean) => void }>> = {
  General: GeneralSection,
  Appearance: AppearanceSection,
  Notifications: NotificationsSection,
  Usage: UsageSection,
  Privacy: PrivacySection,
  'Import & Export': ImportExportSection,
  System: SystemSection,
  Browser: BrowserSection,
  Editor: EditorSection,
  Terminal: TerminalSection,
  Worktrees: WorktreesSection,
  'Pull requests': PullRequestsSection,
  'WSL & remote': RemoteSection,
  Models: ModelSection,
  Agents: AgentsSection,
  Permissions: PermissionsSection,
  Plugins: PluginsSection,
  Skills: SkillsSection,
  Memory: MemorySection,
  Shortcuts: ShortcutsSection,
  About: AboutSection,
};

const resolveSection = (value: string) => {
  const mapped = ALIASES[value] ?? value;
  return NAV.some((entry) => entry.id === mapped) ? mapped : 'General';
};

export const SETTINGS_SECTIONS = NAV.map((entry) => entry.id);

export const SettingsModal: React.FC<Props> = ({ store }) => {
  const [section, setSection] = useState(() => resolveSection(store.settingsSection));
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    setSection(resolveSection(store.settingsSection));
  }, [store.settingsSection]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!store.settingsOpen) {
      setQuery('');
      setToast(null);
    }
  }, [store.settingsOpen]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return NAV;
    return NAV.filter((entry) => `${entry.label} ${entry.terms}`.toLowerCase().includes(needle));
  }, [query]);

  if (!store.settingsOpen) return null;

  const notify = (text: string, ok = true) => setToast({ text, ok });
  const selectSection = (next: string) => {
    setSection(next);
    store.setSettingsSection(next);
  };

  const Section = SECTIONS[section] ?? GeneralSection;
  const meta =
    section === 'Models'
      ? `${store.providers.items.length} providers · ${store.pluginCatalogTotal} plugins · ${store.connectorServers.length} connections`
      : section === 'Plugins'
        ? `${store.pluginCatalogTotal} marketplace plugins · ${store.connectors.items.length} apps`
        : section === 'Skills'
          ? `${store.skills.filter((skill) => skill.enabled).length} of ${store.skills.length} enabled`
          : section === 'Memory'
            ? `${store.memories.length} facts on this machine`
            : '';

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && store.setSettingsOpen(false)}
    >
      <div className="wg-set" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="wg-set-nav" aria-label="Settings sections">
          <div className="wg-set-nav-head">
            <button className="wg-set-back" onClick={() => store.setSettingsOpen(false)}>
              <ArrowLeft size={13} /> Back
            </button>
            <span className="wg-set-nav-title">Settings</span>
            <button className="icon-btn" onClick={() => store.setSettingsOpen(false)} aria-label="Close settings">
              <X size={15} />
            </button>
          </div>
          <div className="wg-set-search">
            <div className="catalog-search">
              <Search size={12} />
              <input
                className="input-flat"
                placeholder="Search settings"
                aria-label="Search settings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="wg-set-nav-scroll">
            {(['Preferences', 'This computer', 'Customize'] as const).map((group) => {
              const entries = visible.filter((entry) => entry.group === group);
              if (entries.length === 0) return null;
              return (
                <div key={group}>
                  <div className="wg-set-nav-group">{group}</div>
                  {entries.map((entry) => (
                    <button
                      key={entry.id}
                      className={`wg-set-navbtn ${section === entry.id ? 'is-active' : ''}`}
                      onClick={() => selectSection(entry.id)}
                      aria-current={section === entry.id}
                    >
                      <span>{entry.label}</span>
                      {entry.id === 'Plugins' && (
                        <span className="wg-set-navcount">
                          {(store.settings?.installedPlugins.length ?? 0) + store.connectorServers.length}
                        </span>
                      )}
                      {entry.id === 'Skills' && (
                        <span className="wg-set-navcount">{store.skills.filter((skill) => skill.enabled).length}</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
            {visible.length === 0 && <div className="catalog-empty">No setting matches “{query}”.</div>}
          </div>
          <div className="wg-set-nav-foot">
            Tervixa Wiggle {store.status?.version ?? '1.0.0'}
            <br />
            Tervixa Corporation
          </div>
        </nav>

        <section className="wg-set-main">
          <header className="wg-set-head">
            <h2>{NAV.find((entry) => entry.id === section)?.label ?? section}</h2>
            {meta && <span className="wg-set-head-meta">{meta}</span>}
          </header>
          <div className="wg-set-scroll">
            {toast && <div className={`settings-note ${toast.ok ? 'settings-note-ok' : 'settings-note-error'}`}>{toast.text}</div>}
            <Section store={store} notify={notify} />
          </div>
        </section>
      </div>
    </div>
  );
};
