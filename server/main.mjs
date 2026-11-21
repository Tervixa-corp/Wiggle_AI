import path from 'node:path';
import { createApp, readConfig } from './app.mjs';

const env = process.env;
const config = readConfig(env);
const workspaceRoot = path.resolve(env.WIGGLE_WORKSPACE || process.cwd());
const port = config.port;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WIGGLE_PORT');

const app = createApp({ workspaceRoot });
app.listen(port, '127.0.0.1', () => {
  console.log(`Tervixa Wiggle — http://127.0.0.1:${port}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log('Developed by Tervixa Corporation.');
});
