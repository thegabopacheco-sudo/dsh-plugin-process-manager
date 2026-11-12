// Test end-to-end de process-manager.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'process-manager'), { recursive: true });
writeFileSync(path.join(home, 'process-manager', 'config.json'), JSON.stringify({}), 'utf8');
const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 600));

function makeClient(extraEnv = {}) {
  const entry = process.env.PROCMAN_SERVER ? path.resolve(process.env.PROCMAN_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'procman-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const all = textOf(await client.callTool({ name: 'list', arguments: {} }));
console.log('--- list ---'); console.log(all.split('\n').slice(0, 6).join('\n'));
console.log('lista procesos:', /Procesos: \d+/.test(all) && all.includes('PID'));
const filtered = textOf(await client.callTool({ name: 'list', arguments: { filter: 'node' } }));
console.log('filtra node:', filtered.toLowerCase().includes('node'));
console.log('encuentra dummy:', filtered.includes(String(dummy.pid)));
const killed = await client.callTool({ name: 'kill', arguments: { pid: dummy.pid } });
console.log('kill sin confirm isError:', killed.isError === true);
const exited = new Promise((resolve) => dummy.on('exit', () => resolve(true)));
const killResult = await client.callTool({ name: 'kill', arguments: { pid: dummy.pid, confirm: true } });
console.log('--- kill ---'); console.log(textOf(killResult));
const dead = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), 5000))]);
console.log('proceso terminado:', dead === true);
const invalid = await client.callTool({ name: 'kill', arguments: { pid: 999999, confirm: true } });
console.log('pid inexistente isError:', invalid.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_PROCMAN_MODE: 'read-only' });
const roKill = await roClient.callTool({ name: 'kill', arguments: { pid: process.pid, confirm: true } });
console.log('read-only kill isError:', roKill.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
try { if (!dummy.killed) dummy.kill(); } catch {}
console.log('OK');
