import { Bot } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';

const ROLES = [
  { name: 'architect', copy: 'Reads the repo, plans the change, and decides which files are in scope.' },
  { name: 'coder', copy: 'Applies edits and runs the build or tests to verify them.' },
  { name: 'explorer', copy: 'Fast search across files and symbols to gather context.' },
  { name: 'reviewer', copy: 'Audits the resulting diff for bugs and rule violations.' },
];

export function AgentSwarmView() {
  const { session } = useWiggle();
  const runs = session.messages.flatMap((message) => message.tools);

  return (
    <div className="pane">
      <div style={{ padding: '16px 16px 0' }}>
        <h2 className="empty-title" style={{ fontSize: 14 }}>Agents</h2>
        <p className="empty-copy" style={{ fontSize: 11.5, marginBottom: 0 }}>
          Parallel agent execution is not enabled. Every task currently runs as a single agent in this
          session; the roles below describe the intended split, not a running swarm.
        </p>
      </div>

      <div className="agent-grid">
        {ROLES.map((role) => (
          <div className="agent-card" key={role.name}>
            <h3><Bot size={12} /> {role.name}</h3>
            <p>{role.copy}</p>
            <div className="meta">not scheduled</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="section-label" style={{ padding: '8px 0' }}>This session</div>
        {runs.length === 0 ? (
          <p className="empty-copy" style={{ fontSize: 11.5 }}>No tool calls yet.</p>
        ) : (
          <div className="mono-list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 3 }}>
            {runs.map((tool) => (
              <div className="row" key={tool.id}>
                <span className={tool.status === 'ok' ? 'status-dot ok' : tool.status === 'running' ? 'status-dot idle pulse' : 'status-dot err'} />
                <span className="val">{tool.name}</span>
                <span className="spacer" />
                <span className="key">{tool.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
