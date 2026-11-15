import { createApp, readConfig } from './app.mjs';
import { createWorkspace } from './workspace.mjs';
const port = Number(process.env.WIGGLE_PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WIGGLE_PORT');
const config = readConfig();
const workspace = config.workspacePath ? await createWorkspace(config.workspacePath) : null;
createApp({ config, workspace }).listen(port, '127.0.0.1', () => console.log(`Wiggle local UI: http://127.0.0.1:${port} (${config.model ? `model: ${config.model}` : 'no model configured'}${workspace ? `, read-only workspace: ${workspace.name}` : ''})`));
