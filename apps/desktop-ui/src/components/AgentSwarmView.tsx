import React, { useState } from 'react';
import { ArrowUpRight, Bot, Loader2, Play } from 'lucide-react';
import type { WiggleStore } from '../store/useWiggleStore';

interface Props {
  store: WiggleStore;
}

const ROLE_LIBRARY = [
  { role: 'explorer', desc: 'Maps the repository, gathers context and cites the files that matter.' },
  { role: 'architect', desc: 'Designs the change, names the seams and orders the work.' },
  { role: 'coder', desc: 'Writes the smallest correct diff inside the existing style.' },
  { role: 'reviewer', desc: 'Audits the result for regressions, security and missing tests.' },
];

const ROLE_PROMPTS: Record<string, string> = {
  explorer: 'Act as the explorer. Map the parts of this workspace the goal touches, cite exact file paths, and list the unknowns.',
  architect: 'Act as the architect. Propose the smallest design that satisfies the goal, name the files to change and the order to change them.',
  coder: 'Act as the coder. Implement the goal with the smallest correct diff, then run the relevant checks.',
  reviewer: 'Act as the reviewer. Audit the current changes for correctness, security, regressions and missing tests. Be specific and terse.',
};

export const AgentSwarmView: React.FC<Props> = ({ store }) => {
  const [goal, setGoal] = useState(store.swarmGoal);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const dispatch = async () => {
    const value = goal.trim();
    if (!value || running) return;
    setRunning(true);
    setError('');
    try {
      await store.runSwarm(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The planner could not be reached.');
    } finally {
      setRunning(false);
    }
  };

  const runRole = async (role: string, detail: string) => {
    store.setCenterView('chat');
    store.setActiveFilePath(null);
    await store.sendMessage(`${ROLE_PROMPTS[role] ?? ROLE_PROMPTS.coder}\n\nGoal: ${store.swarmGoal || goal}\n\nPlan detail: ${detail}`);
  };

  const cards = store.swarmTasks.length
    ? store.swarmTasks
    : ROLE_LIBRARY.map((entry) => ({
        id: entry.role,
        role: entry.role,
        title: entry.role[0].toUpperCase() + entry.role.slice(1),
        status: 'idle',
        leasedFiles: [],
        summary: entry.desc,
      }));

  return (
    <div className="chat-scroll">
      <div className="chat-container swarm-wrap">
        <div className="swarm-head">
          <div>
            <h2>Agent swarm</h2>
            <p className="settings-desc">
              The orchestrator splits one goal into roles. Nothing runs until you dispatch a role — each card opens a
              focused turn in the chat workbench with the same provider, permissions and undo snapshots.
            </p>
          </div>
          <span className="title-pill">
            <Bot size={11} />
            <span>{store.swarmTasks.length ? `${store.swarmTasks.length} queued` : 'role library'}</span>
          </span>
        </div>

        <div className="swarm-dispatch">
          <input
            className="input-flat"
            placeholder="Describe a goal, e.g. add rate limiting to the public API and cover it with tests"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void dispatch()}
          />
          <button className="btn-primary" disabled={!goal.trim() || running} onClick={() => void dispatch()}>
            {running ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            <span>{running ? 'Planning…' : 'Plan swarm'}</span>
          </button>
        </div>

        {error && <div className="settings-note settings-note-error">{error}</div>}

        <div className="swarm-grid">
          {cards.map((task) => (
            <div className="swarm-card" key={task.id}>
              <div className="swarm-card-head">
                <span className="swarm-role">
                  <Bot size={14} />
                  <span>{task.title || task.role}</span>
                </span>
                <span className="wb-badge">
                  <span
                    className={`dot ${
                      task.status === 'completed' ? 'dot-ok' : task.status === 'queued' ? 'dot-warn' : 'dot-muted'
                    }`}
                  />
                  {task.status}
                </span>
              </div>
              <p className="swarm-summary">{task.summary}</p>
              <div className="swarm-card-foot">
                <span className="mono">{task.role}</span>
                <button
                  className="btn-flat btn-compact"
                  disabled={!store.status?.ready}
                  title={store.status?.ready ? 'Open this role in chat' : 'Configure a provider first'}
                  onClick={() => void runRole(task.role, task.summary)}
                >
                  <ArrowUpRight size={11} /> Run in chat
                </button>
              </div>
            </div>
          ))}
        </div>

        {!store.status?.ready && (
          <div className="settings-note settings-note-info swarm-note">
            Swarm planning needs a configured provider. Settings → Models.
          </div>
        )}
      </div>
    </div>
  );
};
