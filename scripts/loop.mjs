#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = process.cwd();
const logDir = path.join(root, 'data', 'work');
const logPath = path.join(logDir, 'loop.log');

await fs.ensureDir(logDir);

function now(){ return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function append(line){
  await fs.appendFile(logPath, `[${now()}] ${line}\n`);
  console.log(line);
}

function run(cmd, args){
  return new Promise((resolve)=>{
    const child = spawn(cmd, args, { cwd: root, stdio: ['ignore','pipe','pipe'], shell: false });
    child.stdout.on('data', d=>append(`${cmd} ${args.join(' ')}: ${String(d)}`));
    child.stderr.on('data', d=>append(`${cmd} ${args.join(' ')} [err]: ${String(d)}`));
    child.on('close', code=> resolve(code ?? 1));
  });
}

const intervalSec = parseInt(process.env.CRAWL_INTERVAL_SEC || (process.argv.includes('--interval') ? process.argv[process.argv.indexOf('--interval')+1] : '60'),10);
const maxArg = process.argv.includes('--max') ? process.argv[process.argv.indexOf('--max')+1] : '0';

await append(`loop starting (interval=${intervalSec}s, max=${maxArg})`);

let iter = 0;
while(true){
  iter++;
  await append(`=== iteration ${iter} begin ===`);

  let code = await run('npm', ['run','discover','--','--max', String(maxArg||'0')]);
  if (code !== 0){ await append(`discover failed with code ${code}`); await sleep(30000); continue; }

  code = await run('npm', ['run','thumbs']);
  if (code !== 0){ await append(`thumbs failed with code ${code}`); await sleep(30000); continue; }

  code = await run('npm', ['run','publish']);
  if (code !== 0){ await append(`publish failed with code ${code}`); await sleep(30000); continue; }

  await append(`=== iteration ${iter} complete; sleeping ${intervalSec}s ===`);
  await sleep(intervalSec*1000);
}

