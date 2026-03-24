/**
 * Fix Request Auto-Poller
 * Polls the Worker API for pending fix requests every 30 seconds.
 * When found, analyzes the error log and resolves the bug with fix notes.
 * Runs as part of the process manager alongside bot + dashboard.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKER_URL = process.env.WORKER_URL || 'https://claudusbridge-bugs.eosspirit.workers.dev';
const API_KEY = process.env.WORKER_API_KEY || '';
const POLL_INTERVAL = 30_000; // 30 seconds
const PLUGIN_PATH = process.env.PLUGIN_PATH || 'C:\\Users\\eos\\Documents\\Nueva carpeta (5)\\ClaudusBridge';
const PLUGIN_SRC = path.join(PLUGIN_PATH, 'Source', 'ClaudusBridge', 'Private');
const PLUGIN_PUB = path.join(PLUGIN_PATH, 'Source', 'ClaudusBridge', 'Public');

// ClaudusBridge module knowledge base for auto-analysis
const MODULE_FIXES = {
  CBMaterialManager: {
    keywords: ['CreateNode', 'ConnectNodes', 'MaterialExpression', 'TextureSample'],
    commonFixes: 'Null pointer on node creation. Add null check after UMaterialExpression factory lookup. Validate node type exists in NodeFactoryMap before dereferencing. Guard ConnectNodes() against null source/target pins.',
  },
  CBMeshManager: {
    keywords: ['CreateMesh', 'StaticMesh', 'ProceduralMesh', 'MeshComponent'],
    commonFixes: 'Mesh creation failure. Verify asset path validity, check if mesh component is properly attached to actor. Add bounds validation for procedural mesh vertices.',
  },
  CBNiagaraManager: {
    keywords: ['NiagaraSystem', 'NiagaraEmitter', 'SpawnParticles', 'NiagaraComponent'],
    commonFixes: 'Niagara system spawn failure. Validate NiagaraSystem asset reference, ensure emitter is enabled, check particle spawn rate parameters are > 0.',
  },
  CBNodeManager: {
    keywords: ['CreateNode', 'BlueprintNode', 'K2Node', 'GraphNode'],
    commonFixes: 'Blueprint node creation error. Validate node class exists, check graph context is valid, ensure pin connections match expected types.',
  },
  CBActorManager: {
    keywords: ['SpawnActor', 'DestroyActor', 'ActorComponent', 'AActor'],
    commonFixes: 'Actor spawn/destroy issue. Verify world context, check actor class is valid, ensure spawn transform is not degenerate. Add null world guard.',
  },
  CBWidgetManager: {
    keywords: ['CreateWidget', 'UMG', 'UserWidget', 'WidgetTree'],
    commonFixes: 'Widget creation failure. Verify owning player controller exists, check widget class is valid UUserWidget subclass, ensure widget tree is initialized.',
  },
  CBSequencerManager: {
    keywords: ['Sequencer', 'MovieScene', 'LevelSequence', 'Track'],
    commonFixes: 'Sequencer operation failure. Validate LevelSequence asset, check MovieScene is accessible, ensure track type is registered.',
  },
  CBPhysicsManager: {
    keywords: ['Physics', 'Collision', 'RigidBody', 'PhysicsHandle'],
    commonFixes: 'Physics setup error. Verify collision profile exists, check physics body is initialized, ensure simulation is enabled on component.',
  },
  CBAnimationManager: {
    keywords: ['Animation', 'AnimSequence', 'Montage', 'AnimBlueprint'],
    commonFixes: 'Animation error. Validate animation asset compatibility with skeleton, check montage slot name, ensure AnimInstance is valid.',
  },
  CBLandscapeManager: {
    keywords: ['Landscape', 'Terrain', 'Heightmap', 'LandscapeComponent'],
    commonFixes: 'Landscape operation failure. Verify landscape actor exists, check component dimensions are valid, ensure heightmap data size matches.',
  },
  CBMetaSoundManager: {
    keywords: ['MetaSound', 'AudioComponent', 'SoundWave', 'MetaSoundSource'],
    commonFixes: 'MetaSound error. Validate MetaSound source asset, check audio component is attached, ensure output format is compatible.',
  },
  CBEditorManager: {
    keywords: ['Editor', 'EditorUtility', 'AssetRegistry', 'ContentBrowser'],
    commonFixes: 'Editor utility error. Verify running in editor context (not runtime), check asset registry is loaded, ensure editor subsystem is initialized.',
  },
};

function analyzeErrorLog(errorLog, detectedModule) {
  const lines = (errorLog || '').split('\n');
  const analysis = {
    crashType: 'unknown',
    location: null,
    lineNumber: null,
    suggestion: '',
  };

  // Detect crash type
  if (/access.violation|nullptr|null/i.test(errorLog)) {
    analysis.crashType = 'null_pointer';
  } else if (/assert|assertion/i.test(errorLog)) {
    analysis.crashType = 'assertion_failure';
  } else if (/out.of.range|index|bounds/i.test(errorLog)) {
    analysis.crashType = 'out_of_bounds';
  } else if (/cast|dynamic_cast|static_cast/i.test(errorLog)) {
    analysis.crashType = 'invalid_cast';
  } else if (/timeout|deadlock/i.test(errorLog)) {
    analysis.crashType = 'timeout';
  }

  // Extract file and line
  const fileMatch = errorLog.match(/\[File:\s*([^\]]+)\]/i) || errorLog.match(/(\w+\.cpp):(\d+)/);
  if (fileMatch) {
    analysis.location = fileMatch[1];
  }
  const lineMatch = errorLog.match(/\[Line:\s*(\d+)\]/i) || errorLog.match(/\.cpp:(\d+)/);
  if (lineMatch) {
    analysis.lineNumber = lineMatch[1];
  }

  // Module-specific fix
  if (detectedModule && MODULE_FIXES[detectedModule]) {
    analysis.suggestion = MODULE_FIXES[detectedModule].commonFixes;
  }

  return analysis;
}

function generateFixNotes(bug, analysis) {
  const parts = [];

  parts.push(`Module: ${bug.detected_module || 'Unknown'}`);
  parts.push(`Crash type: ${analysis.crashType.replace('_', ' ')}`);

  if (analysis.location) {
    parts.push(`Location: ${analysis.location}${analysis.lineNumber ? ':' + analysis.lineNumber : ''}`);
  }

  if (analysis.suggestion) {
    parts.push(`Fix: ${analysis.suggestion}`);
  } else {
    // Generic fix based on crash type
    switch (analysis.crashType) {
      case 'null_pointer':
        parts.push('Fix: Add null pointer validation before dereferencing. Check object initialization order.');
        break;
      case 'assertion_failure':
        parts.push('Fix: Review assertion condition - the expected state is not met. Add proper error handling instead of assert.');
        break;
      case 'out_of_bounds':
        parts.push('Fix: Add bounds checking before array/container access. Validate index ranges.');
        break;
      case 'invalid_cast':
        parts.push('Fix: Verify object type before casting. Use Cast<T> with null check instead of static cast.');
        break;
      default:
        parts.push('Fix: Review error context and add proper error handling with user-friendly fallback.');
    }
  }

  if (bug.ue_version) parts.push(`UE Version: ${bug.ue_version}`);

  return parts.join('\n');
}

async function workerFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  const res = await fetch(`${WORKER_URL}${path}`, { ...options, headers });
  return res.json();
}

// --- Source file helpers ---

function findSourceFile(filename) {
  const privatePath = path.join(PLUGIN_SRC, filename);
  if (fs.existsSync(privatePath)) return privatePath;
  const publicPath = path.join(PLUGIN_PUB, filename);
  if (fs.existsSync(publicPath)) return publicPath;
  return null;
}

function extractFileAndLine(errorLog) {
  // Match patterns like [File:CBMaterialManager.cpp] [Line:347]
  const fileMatch = errorLog.match(/\[File:\s*([^\]]+\.(?:cpp|h))\]/i);
  const lineMatch = errorLog.match(/\[Line:\s*(\d+)\]/i);
  // Also match CBModule::Function() [file.cpp:123]
  const altMatch = errorLog.match(/(\w+\.cpp):(\d+)/);

  return {
    file: fileMatch ? fileMatch[1] : (altMatch ? altMatch[1] : null),
    line: lineMatch ? parseInt(lineMatch[1]) : (altMatch ? parseInt(altMatch[2]) : null),
  };
}

function applyNullGuard(sourceCode, lineNumber, variableName) {
  const lines = sourceCode.split('\n');
  if (lineNumber <= 0 || lineNumber > lines.length) return null;

  const idx = lineNumber - 1;
  const targetLine = lines[idx];
  const indent = targetLine.match(/^(\s*)/)[1];

  // Add null check before the problematic line
  const guard = `${indent}if (!${variableName})\n${indent}{\n${indent}\tUE_LOG(LogClaudusBridge, Error, TEXT("${variableName} is null at line ${lineNumber}"));\n${indent}\treturn;\n${indent}}`;

  lines.splice(idx, 0, guard);
  return lines.join('\n');
}

function applyBoundsCheck(sourceCode, lineNumber) {
  const lines = sourceCode.split('\n');
  if (lineNumber <= 0 || lineNumber > lines.length) return null;

  const idx = lineNumber - 1;
  const targetLine = lines[idx];
  const indent = targetLine.match(/^(\s*)/)[1];

  // Add bounds check
  const guard = `${indent}// Fix: Added bounds validation\n${indent}if (Index < 0 || Index >= Array.Num())\n${indent}{\n${indent}\tUE_LOG(LogClaudusBridge, Error, TEXT("Index out of bounds: %d / %d"), Index, Array.Num());\n${indent}\treturn;\n${indent}}`;

  lines.splice(idx, 0, guard);
  return lines.join('\n');
}

function patchSourceFile(filePath, errorLog, analysis) {
  if (!fs.existsSync(filePath)) return { patched: false, reason: 'File not found' };

  const source = fs.readFileSync(filePath, 'utf-8');
  const { line } = extractFileAndLine(errorLog);
  let newSource = null;
  let patchDesc = '';

  switch (analysis.crashType) {
    case 'null_pointer': {
      // Find the variable being dereferenced
      const varMatch = errorLog.match(/(\w+Ptr|\w+Controller|\w+Component|\w+System\w*)\s*!=\s*nullptr/i)
        || errorLog.match(/(\w+)\s+is\s+null/i);
      const varName = varMatch ? varMatch[1] : 'Ptr';
      if (line) {
        newSource = applyNullGuard(source, line, varName);
        patchDesc = `Added null check for ${varName} before line ${line}`;
      }
      break;
    }
    case 'out_of_bounds': {
      if (line) {
        newSource = applyBoundsCheck(source, line);
        patchDesc = `Added bounds validation before line ${line}`;
      }
      break;
    }
    case 'assertion_failure': {
      // Convert assert to graceful error handling
      if (line && line <= source.split('\n').length) {
        const lines = source.split('\n');
        const idx = line - 1;
        const targetLine = lines[idx];
        if (/check\(|ensure\(|assert/i.test(targetLine)) {
          const indent = targetLine.match(/^(\s*)/)[1];
          const condition = targetLine.match(/(?:check|ensure|assert)\w*\(\s*(.+?)\s*\)/i);
          if (condition) {
            lines[idx] = `${indent}// Fix: Converted assertion to graceful error handling\n${indent}if (!(${condition[1]}))\n${indent}{\n${indent}\tUE_LOG(LogClaudusBridge, Error, TEXT("Condition failed: ${condition[1].replace(/"/g, '\\"')}"));\n${indent}\treturn;\n${indent}}`;
            newSource = lines.join('\n');
            patchDesc = `Converted assertion to graceful error handling at line ${line}`;
          }
        }
      }
      break;
    }
  }

  if (newSource && newSource !== source) {
    fs.writeFileSync(filePath, newSource, 'utf-8');
    return { patched: true, description: patchDesc };
  }

  return { patched: false, reason: 'Could not determine safe patch' };
}

function gitCommit(ticketId, title, patchDesc) {
  try {
    const opts = { cwd: PLUGIN_PATH, encoding: 'utf-8' };
    execSync('git add -A', opts);
    const status = execSync('git status --short', opts).trim();
    if (!status) return { committed: false, reason: 'No changes' };

    const msg = `fix(${ticketId}): ${title}\n\n${patchDesc}\n\nAuto-fixed by ClaudusBridge Bug Tracker`;
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, opts);
    const log = execSync('git log --oneline -1', opts).trim();

    // Try push (non-blocking)
    try {
      execSync('git push', opts);
    } catch (_) {
      console.log(`[fix-poller] Push failed for ${ticketId}, commit is local only`);
    }

    return { committed: true, commit: log };
  } catch (err) {
    return { committed: false, reason: err.message };
  }
}

// --- Main processor ---

async function processFixRequests() {
  try {
    const data = await workerFetch('/api/fix-requests');
    const requests = data.fix_requests || [];

    if (requests.length === 0) return;

    console.log(`[fix-poller] Found ${requests.length} pending fix request(s)`);

    for (const req of requests) {
      try {
        console.log(`[fix-poller] Processing ${req.ticket_id}: ${req.title}`);

        // Analyze the error
        const analysis = analyzeErrorLog(req.error_log, req.detected_module);
        let fixNotes = generateFixNotes(req, analysis);
        let commitInfo = null;

        // Try to patch source code
        const { file } = extractFileAndLine(req.error_log || '');
        if (file) {
          const filePath = findSourceFile(file);
          if (filePath) {
            console.log(`[fix-poller] Found source: ${filePath}`);
            const patch = patchSourceFile(filePath, req.error_log, analysis);

            if (patch.patched) {
              console.log(`[fix-poller] Patched: ${patch.description}`);
              fixNotes += `\n\nSource patched: ${patch.description}`;

              // Git commit
              const git = gitCommit(req.ticket_id, req.title, patch.description);
              if (git.committed) {
                console.log(`[fix-poller] Committed: ${git.commit}`);
                fixNotes += `\nCommit: ${git.commit}`;
                commitInfo = git.commit;
              }
            } else {
              console.log(`[fix-poller] Could not auto-patch: ${patch.reason}`);
              fixNotes += `\n\nAuto-patch skipped: ${patch.reason}. Manual review needed.`;
            }
          } else {
            console.log(`[fix-poller] Source file ${file} not found in plugin`);
          }
        }

        console.log(`[fix-poller] Analysis for ${req.ticket_id}: ${analysis.crashType} in ${analysis.location || 'unknown'}`);

        // Resolve the bug
        await workerFetch(`/api/bugs/${req.bug_id}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ fix_notes: fixNotes }),
        });

        // Clean up fix request
        await workerFetch(`/api/fix-requests/${req.ticket_id}`, { method: 'DELETE' });

        console.log(`[fix-poller] ${req.ticket_id} resolved${commitInfo ? ' + committed' : ''}`);
      } catch (err) {
        console.error(`[fix-poller] Error processing ${req.ticket_id}:`, err.message);
      }
    }
  } catch (err) {
    // Silently fail if Worker is down
    if (err.message && !err.message.includes('fetch')) {
      console.error('[fix-poller] Poll error:', err.message);
    }
  }
}

// Start polling
console.log(`[fix-poller] Started. Polling ${WORKER_URL} every ${POLL_INTERVAL / 1000}s`);
processFixRequests(); // Run immediately on start
setInterval(processFixRequests, POLL_INTERVAL);
