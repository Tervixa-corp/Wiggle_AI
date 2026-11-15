import { GitBranch, Undo2, Redo2 } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';

export function StatusBar() {
  const { status, offline, session, undo, redo } = useWiggle();
  const usage = session.usage;
  const tokens = usage ? (usage.input ?? 0) + (usage.output ?? 0) : 0;

  return (
    <footer className="statusbar">
      <span className="item">
        <GitBranch size={11} />
        <span className="branch">{status?.branch ?? 'no branch'}</span>
      </span>
      <span className="item">
        <span className={offline ? 'status-dot err' : session.running ? 'status-dot warn' : 'status-dot ok'} />
        {offline ? 'Server offline' : session.running ? 'Agent working' : 'Agent idle'}
      </span>
      <span className="item">Tools: {status ? status.permissions : '—'}</span>
      <span className="item">Skills: {status?.skills ?? 0}</span>
      <span className="item">Memory: {status?.memory ?? 0}</span>
      <span className="spacer" />
      <button className="item" onClick={() => void undo()} disabled={!status?.history.undo} title="Undo the last agent turn">
        <Undo2 size={11} /> {status?.history.undo ?? 0}
      </button>
      <button className="item" onClick={() => void redo()} disabled={!status?.history.redo} title="Redo the last undone turn">
        <Redo2 size={11} /> {status?.history.redo ?? 0}
      </button>
      <span className="item">{tokens ? `${(tokens / 1000).toFixed(1)}k tok` : 'UTC'}</span>
      <span className="item">{status?.model ? status.model.slice(0, 24) : 'no model'}</span>
    </footer>
  );
}
