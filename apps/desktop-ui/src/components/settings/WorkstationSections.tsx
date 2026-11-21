import React, { useEffect, useState } from 'react';
import { Check, Clipboard, GitBranch, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { WiggleSettings } from '../../store/useWiggleStore';
import { Callout, Group, Intro, Note, Row, TextField, Toggle, useSave, type SectionProps } from './primitives';

const CopyButton: React.FC<{ value: string; label?: string }> = ({ value, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-flat btn-compact"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={11} /> : <Clipboard size={11} />} {copied ? 'Copied' : label}
    </button>
  );
};

/* -------------------------------------------------------------------------- */
/* Worktrees                                                                  */
/* -------------------------------------------------------------------------- */

export const WorktreesSection: React.FC<SectionProps> = ({ store, notify }) => {
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const save = useSave(store, notify);

  useEffect(() => {
    void store.loadWorktrees().catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not list worktrees.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Intro>
        A worktree is a second checkout of this repository on its own branch. The agent gets an isolated directory while
        your main checkout stays exactly as it is.
      </Intro>

      <Group title="Worktrees on this machine">
        <div className="inline-row" style={{ marginBottom: 8 }}>
          <button className="btn-flat btn-compact" onClick={() => void store.loadWorktrees()}>
            <RefreshCw size={11} /> Refresh
          </button>
          <span className="field-hint">{store.worktrees.length} listed</span>
        </div>
        {store.worktrees.map((worktree) => (
          <div className="list-row" key={worktree.path}>
            <div className="list-row-main">
              <strong className="mono" style={{ wordBreak: 'break-all', fontSize: 11 }}>
                {worktree.path}
              </strong>
              <span className="list-row-sub mono">
                {worktree.branch || (worktree.detached ? 'detached HEAD' : 'no branch')}
                {worktree.locked ? ' · locked' : ''}
                {worktree.primary ? ' · main checkout' : ''}
              </span>
            </div>
            <div className="list-row-actions">
              <CopyButton value={worktree.path} label="Path" />
              {!worktree.primary && (
                <button
                  className="icon-btn"
                  title="Remove worktree"
                  onClick={() => {
                    void store
                      .deleteWorktree(worktree.path)
                      .then(() => notify('Worktree removed.', true))
                      .catch((caught) => {
                        const message = caught instanceof Error ? caught.message : 'Could not remove the worktree.';
                        if (/modified|untracked|dirty/i.test(message)) {
                          if (window.confirm(`${message}\n\nRemove it anyway and discard those files?`)) {
                            void store
                              .deleteWorktree(worktree.path, true)
                              .then(() => notify('Worktree force-removed.', true))
                              .catch((forced) => notify(forced instanceof Error ? forced.message : 'Removal failed.', false));
                          }
                          return;
                        }
                        notify(message, false);
                      });
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
        {store.worktrees.length === 0 && <div className="catalog-empty">{error || 'No worktrees found (or this folder is not a git repository).'}</div>}
      </Group>

      <Group title="Create a worktree">
        <Row title="Branch" description="A new branch is created for the worktree. Letters, digits, dot, slash, dash and underscore.">
          <input
            className="input-flat mono"
            aria-label="Worktree branch"
            value={branch}
            placeholder="feature/login"
            onChange={(event) => setBranch(event.target.value)}
          />
        </Row>
        <Row title="Base ref" description="Leave empty to branch from the current HEAD.">
          <input
            className="input-flat mono"
            aria-label="Worktree base"
            value={base}
            placeholder="main"
            onChange={(event) => setBase(event.target.value)}
          />
        </Row>
        <Row title="Path" description="Leave empty for a sibling folder named after the branch.">
          <input
            className="input-flat mono"
            aria-label="Worktree path"
            value={target}
            placeholder="C:\\work\\login"
            onChange={(event) => setTarget(event.target.value)}
          />
        </Row>
        <Row title="Remember for automation" description="When this is on, the pull-request flow suggests a fresh worktree per branch.">
          <Toggle
            label="Suggest worktrees"
            checked={Boolean(store.settings?.worktreeAuto)}
            onChange={(next) => void save({ worktreeAuto: next })}
          />
        </Row>
        <div className="detail-actions">
          <button
            className="btn-primary"
            disabled={!branch.trim() || store.worktreeBusy}
            onClick={() => {
              setError('');
              void store
                .createWorktree({ branch: branch.trim(), base: base.trim() || undefined, path: target.trim() || undefined })
                .then((created) => {
                  notify(`Worktree created at ${created.path}.`, true);
                  setBranch('');
                  setBase('');
                  setTarget('');
                })
                .catch((caught) => notify(caught instanceof Error ? caught.message : 'Could not create the worktree.', false));
            }}
          >
            {store.worktreeBusy ? <Loader2 size={12} className="spin" /> : <Plus size={12} />} Create worktree
          </button>
        </div>
      </Group>
      <Note>Removing a worktree deletes that directory; the branch and its commits stay in the repository.</Note>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Pull requests                                                              */
/* -------------------------------------------------------------------------- */

export const PullRequestsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = store.settings as WiggleSettings | null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<{ ok: boolean; url?: string; compareUrl?: string; error?: string } | null>(null);
  const save = useSave(store, notify);
  const info = store.pullRequest;

  useEffect(() => {
    void store.loadPullRequest().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Intro>
        Open a pull request from the current branch. The GitHub CLI does the work when it is installed and signed in;
        otherwise the app gives you the compare page to open yourself.
      </Intro>

      <Group title="Repository">
        <Row title="Branch" description="The branch that will be proposed.">
          <span className="mono" style={{ fontSize: 11 }}>
            {info?.branch || '—'}
          </span>
        </Row>
        <Row title="Base branch" description="Where the pull request lands. Saved for the next one.">
          <TextField
            label="Pull request base"
            mono
            value={settings?.prBaseBranch ?? 'main'}
            placeholder="main"
            onCommit={(next) => void save({ prBaseBranch: next || 'main' })}
          />
        </Row>
        <Row title="Commits ahead" description="Commits on this branch that are not on the base.">
          <span className="mono" style={{ fontSize: 11 }}>
            {info?.ahead === null || info?.ahead === undefined ? 'unknown' : info.ahead}
          </span>
        </Row>
        <Row title="Uncommitted files" description="A pull request only carries commits.">
          <span className="mono" style={{ fontSize: 11 }}>
            {info?.uncommitted ?? 0}
          </span>
        </Row>
        <Row title="GitHub CLI" description="gh is used for creation, drafts and the returned URL.">
          <span className="mono" style={{ fontSize: 11 }}>
            {info?.ghAvailable ? info.ghVersion || 'installed' : 'not installed'}
          </span>
        </Row>
        <Row title="Remote" description="origin as configured in this repository.">
          <span className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all', textAlign: 'right' }}>
            {info?.remote || 'no origin remote'}
          </span>
        </Row>
      </Group>

      <Group title="New pull request">
        <Row title="Title" description="One line that describes the change.">
          <input
            className="input-flat"
            aria-label="Pull request title"
            value={title}
            placeholder="Add profile management"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Row>
        <div className="field-group">
          <span className="field-label">Description</span>
          <textarea
            className="input-flat"
            rows={5}
            placeholder="What changed, and how it was verified."
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
        <Row title="Draft" description="Open it as a draft pull request.">
          <Toggle label="Draft pull request" checked={Boolean(settings?.prDraft)} onChange={(next) => void save({ prDraft: next })} />
        </Row>
        <div className="detail-actions">
          <button
            className="btn-primary"
            disabled={!title.trim() || store.prBusy || info?.ghAvailable === false}
            onClick={() => {
              setResult(null);
              void store
                .submitPullRequest({
                  title: title.trim(),
                  body: body.trim(),
                  base: settings?.prBaseBranch || 'main',
                  draft: Boolean(settings?.prDraft),
                })
                .then((created) => {
                  setResult(created);
                  notify(created.ok ? 'Pull request opened.' : created.error || 'The pull request was not created.', created.ok);
                })
                .catch((caught) => notify(caught instanceof Error ? caught.message : 'Could not create the pull request.', false));
            }}
          >
            {store.prBusy ? <Loader2 size={12} className="spin" /> : <GitBranch size={12} />} Create pull request
          </button>
          <button className="btn-flat" onClick={() => void store.loadPullRequest().then(() => notify('Repository state reloaded.', true))}>
            <RefreshCw size={12} /> Reload
          </button>
        </div>
        {result && (
          <Callout>
            {result.ok ? 'Opened: ' : result.error || 'Not created. '}
            {(result.url || result.compareUrl) && (
              <a href={result.url || result.compareUrl} target="_blank" rel="noreferrer">
                {result.url || result.compareUrl}
              </a>
            )}
          </Callout>
        )}
        {!info?.ghAvailable && info?.compareUrl && (
          <Note>
            Without gh, commit and push the branch first, then use the compare page:{' '}
            <a href={info.compareUrl} target="_blank" rel="noreferrer">
              open compare page
            </a>
            .
          </Note>
        )}
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Remote / WSL                                                               */
/* -------------------------------------------------------------------------- */

export const RemoteSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = store.settings as WiggleSettings | null;
  const save = useSave(store, notify);
  const target = settings?.remoteTarget ?? 'local';
  const tunnels = settings?.sshHost ? `ssh -N -L 4317:127.0.0.1:4317 ${settings.sshHost}` : '';

  return (
    <>
      <Intro>
        Run the terminal and the agent's commands on another machine. The gateway itself always stays on loopback; the
        tunnel command below is how you reach it from the remote side.
      </Intro>

      <Group title="Execution target">
        <Row title="Where commands run" description="Applies to the terminal pane and to the agent's run_command tool.">
          <select
            className="select-flat"
            aria-label="Remote target"
            value={target}
            onChange={(event) => void save({ remoteTarget: event.target.value as WiggleSettings['remoteTarget'] })}
          >
            <option value="local">This machine</option>
            <option value="wsl">WSL distribution</option>
            <option value="ssh">SSH host</option>
          </select>
        </Row>
        {target === 'wsl' && (
          <>
            <Row title="Distribution" description="The WSL distro name exactly as `wsl -l -q` prints it.">
              <TextField
                label="WSL distribution"
                mono
                value={settings?.wslDistro ?? ''}
                placeholder="Ubuntu"
                onCommit={(next) => void save({ wslDistro: next })}
              />
            </Row>
            {store.remoteState?.distros?.length ? (
              <div className="chip-row" style={{ paddingBottom: 8 }}>
                {store.remoteState.distros.map((distro) => (
                  <button key={distro} className="wb-badge" onClick={() => void save({ wslDistro: distro })}>
                    {distro}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
        {target === 'ssh' && (
          <>
            <Row title="Host" description="user@machine, or an alias from ~/.ssh/config. Key-based auth only (BatchMode).">
              <TextField
                label="SSH host"
                mono
                value={settings?.sshHost ?? ''}
                placeholder="dev@buildbox"
                onCommit={(next) => void save({ sshHost: next })}
              />
            </Row>
            <Row title="Remote directory" description="Where commands start on the remote host. Leave empty for the login directory.">
              <TextField
                label="Remote directory"
                mono
                value={settings?.remoteWorkdir ?? ''}
                placeholder="/srv/project"
                onCommit={(next) => void save({ remoteWorkdir: next })}
              />
            </Row>
          </>
        )}
        <div className="detail-actions">
          <button
            className="btn-flat"
            onClick={() =>
              void store
                .testRemote()
                .then((data) => notify(data.ok ? 'Target reachable.' : 'Target did not answer.', data.ok))
                .catch((caught) => notify(caught instanceof Error ? caught.message : 'Test failed.', false))
            }
          >
            <RefreshCw size={12} /> Test connection
          </button>
          {tunnels && <CopyButton value={tunnels} label="Copy tunnel command" />}
        </div>
        {store.remoteState && (
          <pre className="terminal-log" style={{ maxHeight: 160, overflow: 'auto', marginTop: 8 }}>
            {store.remoteState.output}
          </pre>
        )}
      </Group>

      <Group title="Remote pairing">
        <Row title="Gateway address" description="The packaged app always opens this address on this machine.">
          <span className="mono" style={{ fontSize: 11 }}>
            127.0.0.1:4317
          </span>
        </Row>
        <Row title="From the remote host" description="Forward the port, then open the same address there.">
          <CopyButton value={tunnels || 'ssh -N -L 4317:127.0.0.1:4317 <host>'} label="Copy" />
        </Row>
      </Group>
      <Note>
        Remote execution uses the shell on the target for terminal commands and agent run_command calls. The workspace
        file tree, editor and snapshots still read the local folder.
      </Note>
    </>
  );
};
