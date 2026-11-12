#!/usr/bin/env node
// dsh-plugin-process-manager — lista y termina procesos de Windows.
// Tools: status, list, kill.

import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'process-manager', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'process-manager');
const READ_ONLY = String(process.env.DSH_PROCMAN_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write(`[procman] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedProcesses: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedProcesses: [] }; }
function parseTasklist(output) {
  const processes = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = [];
    let current = '';
    let quoted = false;
    for (const char of trimmed) {
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { fields.push(current); current = ''; continue; }
      current += char;
    }
    fields.push(current);
    if (fields.length < 5) continue;
    const memKb = Number(String(fields[4]).replace(/[^\d]/g, '')) || 0;
    processes.push({ name: fields[0], pid: Number(fields[1]), session: fields[2], memKb });
  }
  return processes;
}
function listProcesses(filter, sortBy, limit) {
  const result = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (result.status !== 0) throw new Error(`tasklist falló: ${(result.stderr || '').trim().slice(0, 200)}`);
  let processes = parseTasklist(result.stdout || '');
  if (filter) processes = processes.filter((process) => process.name.toLowerCase().includes(filter.toLowerCase()));
  processes.sort((a, b) => sortBy === 'pid' ? a.pid - b.pid : sortBy === 'name' ? a.name.localeCompare(b.name) : b.memKb - a.memKb);
  return processes.slice(0, limit ?? 30);
}
function fmtMem(memKb) { return memKb >= 1024 * 1024 ? `${(memKb / 1024 / 1024).toFixed(2)} GB` : memKb >= 1024 ? `${(memKb / 1024).toFixed(0)} MB` : `${memKb} KB`; }
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Process Manager: lista y termina procesos de Windows.',
    '',
    'Herramientas: status, list, kill.',
    '',
    'Reglas:',
    '- list es solo lectura (tasklist) con filtro y orden por memoria.',
    '- kill requiere confirm:true y un PID concreto; no mates procesos del sistema sin confirmación explícita.',
    '- Respeta allowedProcesses si está configurada.',
    '- Reporta PID y salida reales.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-process-manager', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool('status', { title: 'Estado', description: 'Plataforma, lista permitida y modo.', inputSchema: z.object({}) }, async () => textResult([`Plataforma: ${process.platform}`, `allowedProcesses: ${loadConfig().allowedProcesses?.length ? loadConfig().allowedProcesses.join(', ') : '(todas)'}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')));
  server.registerTool('list', { title: 'Listar procesos', description: 'Procesos con filtro y orden.', inputSchema: z.object({ filter: z.string().max(60).optional(), sort: z.enum(['mem', 'pid', 'name']).optional(), limit: z.number().int().min(1).max(300).optional() }) }, async (args) => {
    const processes = listProcesses(args.filter, args.sort || 'mem', args.limit ?? 30);
    if (processes.length === 0) return textResult('Sin procesos que coincidan.');
    return textResult([`Procesos: ${processes.length} (mostrados)`, '', ...processes.map((item) => `- ${item.name} · PID ${item.pid} · ${fmtMem(item.memKb)} · sesión ${item.session}`)].join('\n'));
  });
  server.registerTool('kill', { title: 'Terminar proceso', description: 'Mata un proceso por PID. Requiere confirm:true.', inputSchema: z.object({ pid: z.number().int().min(1).max(2147483647), confirm: z.boolean().optional() }) }, async (args) => {
    if (READ_ONLY) throw new Error('modo read-only: kill deshabilitado');
    if (args.confirm !== true) throw new Error('kill requiere confirm:true y pedido explícito');
    const processes = listProcesses(undefined, 'mem', 5000);
    const target = processes.find((process) => process.pid === args.pid);
    const allowed = loadConfig().allowedProcesses || [];
    if (allowed.length && target && !allowed.some((name) => target.name.toLowerCase().includes(String(name).toLowerCase()))) throw new Error(`proceso no permitido: ${target.name}`);
    const result = spawnSync('taskkill', ['/PID', String(args.pid), '/F'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim().slice(0, 300);
    if (result.status !== 0) throw new Error(`taskkill falló: ${output}`);
    return textResult(`Proceso ${args.pid}${target ? ` (${target.name})` : ''} terminado.\n${output}`);
  });
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
