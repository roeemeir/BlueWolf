import { spawn } from 'node:child_process';
import { existsSync, cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const standalone = resolve(root, '.next/standalone');
if (!existsSync(resolve(standalone, 'server.js'))) throw new Error('Missing offline build. Prepare the package with npm run build:offline before transferring it to the closed network.');
for (const name of ['public', '.next/static']) {
  if (existsSync(resolve(root, name))) {
    mkdirSync(resolve(standalone, name), { recursive: true });
    cpSync(resolve(root, name), resolve(standalone, name), { recursive: true });
  }
}
const child = spawn(process.execPath, [resolve(standalone, 'server.js')], {
  cwd: standalone, stdio: 'inherit', env: {
    ...process.env, BLUEWOLF_STORAGE: 'sqlite',
    BLUEWOLF_SQLITE_PATH: resolve(process.env.BLUEWOLF_SQLITE_PATH || resolve(root, 'data/bluewolf.sqlite')),
    HOSTNAME: process.env.BLUEWOLF_HOST || '127.0.0.1', PORT: process.env.PORT || '3000',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
