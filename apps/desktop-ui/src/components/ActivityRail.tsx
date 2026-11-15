import React from 'react';
import { Bot, FolderTree, Globe, MessageSquare, Puzzle, Settings } from 'lucide-react';

interface Props {
  activeView: string;
  onSelectChat: () => void;
  onSelectAgents: () => void;
  onToggleSidebar: () => void;
  onSelectBrowser: () => void;
  onOpenMcpSettings: () => void;
  onOpenSettings: () => void;
}

export const ActivityRail: React.FC<Props> = ({
  activeView,
  onSelectChat,
  onSelectAgents,
  onToggleSidebar,
  onSelectBrowser,
  onOpenMcpSettings,
  onOpenSettings,
}) => {
  return (
    <nav className="activity-rail" aria-label="Activity Rail">
      <button
        className={`rail-btn ${activeView === 'chat' ? 'active' : ''}`}
        title="Chat Workbench"
        onClick={onSelectChat}
      >
        <MessageSquare size={17} />
      </button>
      <button
        className={`rail-btn ${activeView === 'agents' ? 'active' : ''}`}
        title="Agent Swarm"
        onClick={onSelectAgents}
      >
        <Bot size={17} />
      </button>
      <button className="rail-btn" title="Explorer" onClick={onToggleSidebar}>
        <FolderTree size={17} />
      </button>
      <button className="rail-btn" title="Built-in Browser" onClick={onSelectBrowser}>
        <Globe size={17} />
      </button>
      <button className="rail-btn" title="MCP & Skills" onClick={onOpenMcpSettings}>
        <Puzzle size={17} />
      </button>
      <div className="rail-spacer" />
      <button className="rail-btn" title="Settings (Ctrl+,)" onClick={onOpenSettings}>
        <Settings size={17} />
      </button>
    </nav>
  );
};
