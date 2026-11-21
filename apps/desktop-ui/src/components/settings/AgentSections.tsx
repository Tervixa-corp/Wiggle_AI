import React, { useEffect, useState } from 'react';
import type { ApprovalMode, WiggleSettings } from '../../store/useWiggleStore';
import {
  Callout,
  ChipList,
  Group,
  Intro,
  Note,
  NumberField,
  Row,
  SelectField,
  TextField,
  Toggle,
  useSave,
  type SectionProps,
} from './primitives';

const TextAreaField: React.FC<{
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  rows?: number;
  label: string;
  mono?: boolean;
}> = ({ value, onCommit, placeholder, rows = 6, label, mono = true }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className={`input-flat ${mono ? 'mono' : ''}`}
      aria-label={label}
      rows={rows}
      style={{ width: '100%', minHeight: 110, resize: 'vertical', lineHeight: 1.5 }}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      placeholder={placeholder}
    />
  );
};

export const AgentsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = store.settings as WiggleSettings | null;
  const save = useSave(store, notify);
  const roles = settings?.roleModels ?? {};

  return (
    <>
      <Intro>
        The Tervixa identity is compiled first on every turn and cannot be replaced by project files or these
        preferences. Everything below shapes how the agent works inside that boundary.
      </Intro>

      <Callout>
        <strong>Tervixa Wiggle, developed by Tervixa Corporation.</strong> The agent answers with this identity whenever
        it is asked who built it.
      </Callout>

      <Group title="Instructions">
        <Row
          title="Custom instructions"
          description="Appended as user preferences on every request. Project files (WIGGLE.md, CLAUDE.md, AGENTS.md) are applied separately."
        >
          <TextAreaField
            label="Custom instructions"
            value={settings?.customIdentityInstructions ?? ''}
            onCommit={(next) => void save({ customIdentityInstructions: next })}
            placeholder="Prefer small diffs. Run the checks before claiming success. Match the existing style."
          />
        </Row>
      </Group>

      <Group title="Execution">
        <Row title="Max steps per turn" description="Upper bound on model/tool iterations before the turn ends.">
          <NumberField
            label="Max steps per turn"
            value={settings?.maxSteps ?? 8}
            min={1}
            max={30}
            onCommit={(next) => void save({ maxSteps: next })}
          />
        </Row>
        <Row title="Swarm roles" description="How many specialised roles the planner may create for one task.">
          <NumberField
            label="Swarm roles"
            value={settings?.maxParallelAgents ?? 4}
            min={1}
            max={12}
            onCommit={(next) => void save({ maxParallelAgents: next })}
          />
        </Row>
        <Row title="Dynamic workflows" description="Turn off to keep every turn single-agent.">
          <Toggle
            label="Dynamic workflows"
            checked={settings?.dynamicWorkflows !== false}
            onChange={(next) => void save({ dynamicWorkflows: next })}
          />
        </Row>
      </Group>

      <Group title="Per-role model routing">
        <Row title="Orchestrator" description="Plans the turn and coordinates other roles.">
          <TextField
            label="Orchestrator model"
            mono
            value={roles.orchestrator ?? ''}
            placeholder="Inherit the active model"
            onCommit={(next) => void save({ roleModels: { ...roles, orchestrator: next } })}
          />
        </Row>
        <Row title="Coder" description="Writes edits and runs verification.">
          <TextField
            label="Coder model"
            mono
            value={roles.coder ?? ''}
            placeholder="Inherit the active model"
            onCommit={(next) => void save({ roleModels: { ...roles, coder: next } })}
          />
        </Row>
        <Row title="Explorer" description="Searches the repository and documentation.">
          <TextField
            label="Explorer model"
            mono
            value={roles.explorer ?? ''}
            placeholder="Inherit the active model"
            onCommit={(next) => void save({ roleModels: { ...roles, explorer: next } })}
          />
        </Row>
        <Row title="Reviewer" description="Audits diffs for correctness and security.">
          <TextField
            label="Reviewer model"
            mono
            value={roles.reviewer ?? ''}
            placeholder="Inherit the active model"
            onCommit={(next) => void save({ roleModels: { ...roles, reviewer: next } })}
          />
        </Row>
      </Group>
      <Note>Role models take the exact provider model id. Leave a role empty to inherit the active model.</Note>
    </>
  );
};

const POLICY_ROWS = [
  ['read_file, list_dir, glob, grep', 'allow', 'allow', 'allow'],
  ['write_file, edit_file', 'ask', 'allow', 'allow'],
  ['run_command', 'ask', 'ask', 'allow'],
  ['browser_inspect, web_fetch', 'ask', 'ask', 'allow'],
  ['destructive shell patterns', 'blocked', 'blocked', 'blocked'],
];

export const PermissionsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const settings = store.settings as WiggleSettings | null;
  const save = useSave(store, notify);
  const mode: ApprovalMode = settings?.approvalMode ?? 'suggest';

  return (
    <>
      <Intro>
        Every tool call passes one gate. Deny-by-default, workspace-confined, and the shell is screened independently of
        your approval.
      </Intro>

      <Group title="Approval mode">
        <Row title="Mode" description="What the agent may do without asking.">
          <SelectField
            label="Approval mode"
            value={mode}
            onChange={(next) => void save({ approvalMode: next as ApprovalMode })}
            options={[
              { value: 'suggest', label: 'Suggest' },
              { value: 'auto_edit', label: 'Auto-edit' },
              { value: 'full_auto', label: 'Full auto' },
            ]}
          />
        </Row>
        <Note>
          Suggest: reads run, edits and commands ask. Auto-edit: writes run, commands ask. Full auto: every tool runs, the
          destructive patterns below stay blocked.
        </Note>
        <Row title="Shell allowlist" description="Command prefixes that never ask, even in suggest mode.">
          <ChipList
            label="Shell allowlist"
            values={settings?.shellAllowlist ?? []}
            placeholder="npm test"
            onChange={(next) => void save({ shellAllowlist: next })}
          />
        </Row>
      </Group>

      <Group title="Tool policy">
        <div className="kv-table">
          <div className="kv-row" style={{ fontWeight: 530 }}>
            <span>Tool</span>
            <strong className="mono">suggest · auto-edit · full-auto</strong>
          </div>
          {POLICY_ROWS.map(([tool, suggest, autoEdit, full]) => (
            <div className="kv-row" key={tool}>
              <span className="mono" style={{ fontSize: 10.5 }}>
                {tool}
              </span>
              <strong className="mono" style={{ fontSize: 10.5 }}>
                {suggest} · {autoEdit} · {full}
              </strong>
            </div>
          ))}
        </div>
        <Note>
          A denial is final for that call. The terminal refuses root deletion, privilege escalation, disk formatting,
          power control, download-piped-to-shell and fork bombs.
        </Note>
      </Group>

      <Group title="Workspace boundary">
        <Row title="Root" description="File tools cannot resolve a path outside this directory.">
          <span className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all', textAlign: 'right' }}>
            {store.status?.workspaceRoot ?? '—'}
          </span>
        </Row>
        <Row title="Undo snapshots" description="Each turn and save commits a reversible snapshot.">
          <span className="mono" style={{ fontSize: 10.5 }}>
            {store.status?.undoCount ?? 0} undo · {store.status?.redoCount ?? 0} redo
          </span>
        </Row>
      </Group>
    </>
  );
};
