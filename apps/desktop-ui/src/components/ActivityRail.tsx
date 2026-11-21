import React from 'react';
import { Bot, FolderTree, MessageSquare, Puzzle, Settings } from 'lucide-react';

interface Props {
  activeView: 'chat' | 'agents' | 'files';
  agentsEnabled: boolean;
  onSelectChat: () => void;
  onSelectAgents: () => void;
  onToggleSidebar: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: () => void;
}

export const ActivityRail: React.FC<Props> = ({
  activeView,
  agentsEnabled,
  onSelectChat,
  onSelectAgents,
  onToggleSidebar,
  onOpenExtensions,
  onOpenSettings,
}) => (
  <nav className="wg-rail" aria-label="Activity rail">
    <button
      className={`wg-rail-btn ${activeView === 'chat' ? 'is-active' : ''}`}
      title="Chat"
      aria-label="Chat"
      aria-current={activeView === 'chat'}
      onClick={onSelectChat}
    >
      <MessageSquare size={16} />
    </button>
    {agentsEnabled && (
      <button
        className={`wg-rail-btn ${activeView === 'agents' ? 'is-active' : ''}`}
        title="Agent swarm"
        aria-label="Agent swarm"
        aria-current={activeView === 'agents'}
        onClick={onSelectAgents}
        data-layout="software"
      >
        <Bot size={16} />
      </button>
    )}
    <button
      className={`wg-rail-btn ${activeView === 'files' ? 'is-active' : ''}`}
      title="Explorer"
      aria-label="Explorer"
      onClick={onToggleSidebar}
    >
      <FolderTree size={16} />
    </button>
    <button className="wg-rail-btn" title="Plugins and connectors" aria-label="Plugins and connectors" onClick={onOpenExtensions}>
      <Puzzle size={16} />
    </button>
    <div className="wg-rail-spacer" />
    <button className="wg-rail-btn" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
      <Settings size={16} />
    </button>
  </nav>
);
