// Headless render entry point for the workbench smoke test.
//
// Bundled with esbuild and executed in Node, this catches the class of failures
// a type check cannot: bad imports, provider misuse, and render-time crashes.

import { renderToString } from 'react-dom/server';
import App from '../../apps/desktop-ui/src/App';
import { WiggleProvider } from '../../apps/desktop-ui/src/store/useWiggleStore';
import { ChatWorkbench } from '../../apps/desktop-ui/src/components/ChatWorkbench';
import { SettingsModal } from '../../apps/desktop-ui/src/components/SettingsModal';
import { CodeDiffEditor } from '../../apps/desktop-ui/src/components/CodeDiffEditor';

export function renderApp() {
  return renderToString(
    <WiggleProvider>
      <App />
    </WiggleProvider>,
  );
}

export function renderChat() {
  return renderToString(
    <WiggleProvider>
      <ChatWorkbench />
    </WiggleProvider>,
  );
}

export function renderEditor() {
  return renderToString(
    <WiggleProvider>
      <CodeDiffEditor />
    </WiggleProvider>,
  );
}

export function renderSettings() {
  return renderToString(
    <WiggleProvider>
      <SettingsModal onClose={() => {}} />
    </WiggleProvider>,
  );
}
