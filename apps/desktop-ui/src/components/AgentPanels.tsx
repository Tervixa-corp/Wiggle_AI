import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileCode2, Wrench, X } from 'lucide-react';

export type Step = { name: string; args: Record<string, unknown>; status: 'ok' | 'error'; summary: string; proposalId?: string };
export type Proposal = { id: string; path: string; status: string; hunks: number; stats: { added: number; removed: number } };

const toolLabels: Record<string, string> = { list_dir: 'List folder', read_file: 'Read file', search_text: 'Search text', propose_edit: 'Propose edit' };

// Collapsible list of the tool calls the agent made while answering.
export function StepList({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="agent-steps">
      <button className="agent-steps-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Wrench size={12} /> {steps.length} tool step{steps.length === 1 ? '' : 's'} {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <ol className="agent-step-list">
          {steps.map((step, i) => (
            <li key={i} className={step.status === 'error' ? 'step error' : 'step'}>
              <strong>{toolLabels[step.name] ?? step.name}</strong>
              <span>{step.summary}</span>
              {step.status === 'error' && <em>failed</em>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Props = {
  proposals: Proposal[];
  busy: boolean;
  onApprove: (proposal: Proposal) => void;
  onReject: (proposal: Proposal) => void;
  onReview: (path: string) => void;
};

// Edits the agent proposed that are waiting for the user. Nothing is written until Approve.
export function PendingProposals({ proposals, busy, onApprove, onReject, onReview }: Props) {
  const pending = proposals.filter(p => p.status === 'pending');
  if (!pending.length) return null;
  return (
    <section className="pending-proposals" aria-label="Pending edits">
      <div className="pending-head"><strong>{pending.length} pending edit{pending.length === 1 ? '' : 's'}</strong><span>Not applied until you approve</span></div>
      {pending.map(p => (
        <div className="pending-item" key={p.id}>
          <FileCode2 size={14} />
          <div className="pending-meta"><span>{p.path}</span><small>+{p.stats.added} −{p.stats.removed} · {p.hunks} change block{p.hunks === 1 ? '' : 's'}</small></div>
          <button className="outline-button" onClick={() => onReview(p.path)}>Review</button>
          <button className="icon-button" aria-label={`Reject edit to ${p.path}`} disabled={busy} onClick={() => onReject(p)}><X size={14} /></button>
          <button className="outline-button primary" aria-label={`Approve edit to ${p.path}`} disabled={busy} onClick={() => onApprove(p)}><Check size={14} /> Approve</button>
        </div>
      ))}
    </section>
  );
}
