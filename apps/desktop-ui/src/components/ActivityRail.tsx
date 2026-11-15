import { Bot, Code2, MessageSquare, Settings } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';

export function ActivityRail({ onSettings }: { onSettings: () => void }) {
  const { view, setView, tabs } = useWiggle();

  return (
    <nav className="rail" aria-label="Primary">
      <button
        className={`rail-button ${view === 'chat' ? 'active' : ''}`}
        onClick={() => setView('chat')}
        title="Chat"
        aria-label="Chat"
        aria-pressed={view === 'chat'}
      >
        <MessageSquare size={16} />
      </button>
      <button
        className={`rail-button ${view === 'agents' ? 'active' : ''}`}
        onClick={() => setView('agents')}
        title="Agents"
        aria-label="Agents"
        aria-pressed={view === 'agents'}
      >
        <Bot size={17} />
      </button>
      <button
        className={`rail-button ${view === 'editor' ? 'active' : ''}`}
        onClick={() => setView('editor')}
        title="Editor and diffs"
        aria-label="Editor and diffs"
        aria-pressed={view === 'editor'}
      >
        <Code2 size={16} />
        {tabs.length > 0 && (
          <span style={{ position: 'absolute', right: 3, bottom: 2, fontSize: 8, color: 'var(--text-muted)' }}>{tabs.length}</span>
        )}
      </button>
      <span className="rail-spacer" />
      <button className="rail-button" onClick={onSettings} title="Settings (Ctrl+,)" aria-label="Settings">
        <Settings size={16} />
      </button>
    </nav>
  );
}
