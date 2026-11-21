/**
 * Bridge to the native desktop shell.
 *
 * The NSIS build hosts the workbench in a borderless WebView2 window, so the
 * application owns its own title bar. The shell never draws a native caption or
 * menu for us; clicks are forwarded over the WebView2 message channel and the
 * launcher turns them into real system operations (move, resize, minimise).
 *
 * The Tauri build keeps native window decorations, so every helper here is a
 * no-op when `chrome.webview` is absent.
 */

type WebViewHost = {
  postMessage: (message: string) => void;
};

function host(): WebViewHost | null {
  if (typeof window === 'undefined') return null;
  const chrome = (window as unknown as { chrome?: { webview?: WebViewHost } }).chrome;
  return chrome?.webview ?? null;
}

/** True when the page runs inside the bundled desktop window. */
export const desktopShell = (): boolean => host() !== null;

/** Send a shell command. Unknown hosts ignore it. */
export function shellPost(message: string): void {
  const bridge = host();
  if (!bridge) return;
  try {
    bridge.postMessage(message);
  } catch {
    // The host can be torn down while the page is closing.
  }
}

export const shell = {
  drag: () => shellPost('shell:drag'),
  minimize: () => shellPost('shell:minimize'),
  maximize: () => shellPost('shell:maximize'),
  close: () => shellPost('shell:close'),
  reload: () => shellPost('shell:reload'),
  changeWorkspace: () => shellPost('shell:change-workspace'),
  openWorkspace: () => shellPost('shell:open-workspace'),
  openSettingsFolder: () => shellPost('shell:open-settings'),
};
