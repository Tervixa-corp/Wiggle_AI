import React, { useState } from 'react';
import { Bot, Lock, Play } from 'lucide-react';
import type { SwarmTask } from '../store/useWiggleStore';

interface Props {
  tasks: SwarmTask[];
  onRunSwarm: (goal: string) => Promise<void>;
}

const DEFAULT_ROLES = [
  { role: 'architect', title: 'Architect', desc: 'Analyzes repository structure and coordinates subagent DAGs.' },
  { role: 'coder', title: 'Coder', desc: 'Applies atomic diffs under in-memory FileCoordinator leases.' },
  { role: 'explorer', title: 'Explorer', desc: 'Executes fast glob/grep codebase search and doc lookups.' },
  { role: 'browser', title: 'Browser', desc: 'Inspects DOM accessibility trees ([ref=e1]) and console streams.' },
  { role: 'reviewer', title: 'Reviewer', desc: 'Audits diffs for path traversal, regressions, and minimal UI discipline.' },
];

export const AgentSwarmView: React.FC<Props> = ({ tasks, onRunSwarm }) => {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);

  const launch = async () => {
    if (!goal.trim() || running) return;
    setRunning(true);
    await onRunSwarm(goal.trim());
    setRunning(false);
  };

  return (
    <div className="chat-scroll">
      <div className="chat-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Parallel Multi-Agent Swarm Orchestrator</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>
              In-place parallel coordination via FileCoordinator RwLock leases and transactional /undo snapshots (zero extra Git branches).
            </p>
          </div>
          <span className="title-pill">
            <Lock size={11} />
            <span>FileCoordinator Active</span>
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="input-flat"
            style={{ flex: 1, height: 32 }}
            placeholder="Describe a parallel engineering task (e.g., Audit security & refactor API routes)..."
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && launch()}
          />
          <button className="btn-primary" style={{ height: 32 }} disabled={!goal.trim() || running} onClick={launch}>
            <Play size={13} />
            <span>{running ? 'Dispatching...' : 'Dispatch Swarm'}</span>
          </button>
        </div>

        <div className="swarm-grid">
          {(tasks.length > 0 ? tasks : DEFAULT_ROLES.map((r) => ({ id: r.role, role: r.role, status: 'idle', leasedFiles: [], summary: r.desc }))).map((task) => (
            <div className="swarm-card" key={task.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <Bot size={14} />
                  <span style={{ textTransform: 'capitalize' }}>{task.role}</span>
                </span>
                <span className="wb-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className={`dot ${task.status === 'completed' ? 'dot-ok' : task.status === 'ready' ? 'dot-warn' : 'dot-muted'}`} />
                  {task.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{task.summary}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
