/**
 * ClaudusBridge Bug Tracker - Process Manager
 * Keeps bot and dashboard running with auto-restart on crash.
 * Run: node start.js
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const processes = [];

// Kill anything on port 3000 before starting
try { execSync('npx kill-port 3000', { stdio: 'ignore', timeout: 5000 }); } catch (_) {}

function startProcess(name, script, cwd) {
  console.log(`[${name}] Starting...`);

  const proc = spawn('node', [script], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  proc.stdout.on('data', (d) => {
    d.toString().trim().split('\n').forEach(line => {
      console.log(`[${name}] ${line}`);
    });
  });

  proc.stderr.on('data', (d) => {
    d.toString().trim().split('\n').forEach(line => {
      console.error(`[${name}] ERROR: ${line}`);
    });
  });

  proc.on('exit', (code) => {
    console.log(`[${name}] Exited with code ${code}. Restarting in 3s...`);
    setTimeout(() => startProcess(name, script, cwd), 3000);
  });

  processes.push({ name, proc });
  return proc;
}

// Start dashboard
startProcess('dashboard', 'server.js', path.join(ROOT, 'dashboard'));

// Start bot (from bot dir so .env is found)
startProcess('bot', 'index.js', path.join(ROOT, 'bot'));

// Start fix request auto-poller
startProcess('fix-poller', 'fix-poller.js', path.join(ROOT, 'bot'));

console.log('\n=== ClaudusBridge Bug Tracker ===');
console.log('Dashboard: http://localhost:3000');
console.log('Bot: ClaudusBridge Bug Tracker');
console.log('Fix Poller: Auto-resolving fix requests every 30s');
console.log('Press Ctrl+C to stop all.\n');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  processes.forEach(({ name, proc }) => {
    console.log(`[${name}] Stopping...`);
    proc.kill();
  });
  process.exit(0);
});
