import { useEffect, useRef } from 'react';
import { useWiggle } from '../store/useWiggleStore';

/** Shell output produced by run_command calls in the current session. */
export function TerminalPane() {
  const { session } = useWiggle();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const runs = session.messages
    .flatMap((message) => message.tools)
    .filter((tool) => tool.name === 'run_command');

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [runs.length]);

  if (!runs.length) {
    return (
      <div className="term-empty">
        No commands have run in this session. Wiggle reports each shell command it executes here, with its
        exit status and output. Commands require your approval unless the permission preset allows them.
      </div>
    );
  }

  return (
    <div className="term" ref={scrollRef}>
      {runs.map((tool) => {
        const command = String((tool.input as Record<string, unknown>).command ?? '');
        return (
          <div key={tool.id} style={{ marginBottom: 10 }}>
            <div className="term-line cmd">$ {command}</div>
            {tool.output ? (
              tool.output.split('\n').map((line, index) => (
                <div className={`term-line ${tool.status === 'error' ? 'err' : ''}`} key={index}>{line || ' '}</div>
              ))
            ) : (
              <div className="term-line">{tool.status === 'running' ? 'running…' : '(no output)'}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
