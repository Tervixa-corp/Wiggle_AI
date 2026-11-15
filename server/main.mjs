import { createApp, readConfig } from './app.mjs';

const port = Number(process.env.WIGGLE_PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WIGGLE_PORT');

const config = readConfig();
const server = createApp({ config });

server.listen(port, config.host, () => {
  const model = config.model ? `model: ${config.model}` : 'no model configured';
  console.log(`Tervixa Wiggle: http://${config.host}:${port} (${model}, tools: ${config.permissions})`);
  if (config.allowedHosts.length) console.log(`Host allowlist extended: ${config.allowedHosts.join(', ')}`);
  console.log(`Workspace: ${config.workspace}`);
});
