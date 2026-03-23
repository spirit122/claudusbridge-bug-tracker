// Auto-detect ClaudusBridge module from error log text
// Maps source file names and keywords to human-readable domains

const MODULE_MAP = [
  // Core routing
  { pattern: /CBRouter/i, module: 'CBRouter', domain: 'Routing' },
  { pattern: /CBMCPServer/i, module: 'CBMCPServer', domain: 'MCP Server' },
  { pattern: /CBConnector/i, module: 'CBConnector', domain: 'Connector' },

  // Actors
  { pattern: /CBActorManager/i, module: 'CBActorManager', domain: 'Actors' },

  // Blueprints
  { pattern: /CBNodeManager/i, module: 'CBNodeManager', domain: 'Blueprint Nodes' },
  { pattern: /CBFunctionManager/i, module: 'CBFunctionManager', domain: 'Blueprint Functions' },
  { pattern: /CBVariableManager/i, module: 'CBVariableManager', domain: 'Blueprint Variables' },
  { pattern: /CBBlueprintLisp/i, module: 'CBBlueprintLisp', domain: 'Blueprint LISP' },
  { pattern: /CBInspector/i, module: 'CBInspector', domain: 'Blueprint Inspector' },

  // Materials
  { pattern: /CBMaterialManager/i, module: 'CBMaterialManager', domain: 'Materials' },
  { pattern: /CBMaterialUtils/i, module: 'CBMaterialUtils', domain: 'Materials' },

  // Niagara
  { pattern: /CBNiagaraManager/i, module: 'CBNiagaraManager', domain: 'Niagara' },

  // Mesh
  { pattern: /CBMeshManager/i, module: 'CBMeshManager', domain: 'Mesh' },
  { pattern: /CBMeshHelpers/i, module: 'CBMeshHelpers', domain: 'Mesh' },

  // Widgets / UI
  { pattern: /CBWidgetManager/i, module: 'CBWidgetManager', domain: 'Widgets' },
  { pattern: /CBMVVMManager/i, module: 'CBMVVMManager', domain: 'MVVM' },

  // Sequencer
  { pattern: /CBSequencerManager/i, module: 'CBSequencerManager', domain: 'Sequencer' },

  // Physics
  { pattern: /CBPhysicsManager/i, module: 'CBPhysicsManager', domain: 'Physics' },

  // Landscape
  { pattern: /CBLandscapeManager/i, module: 'CBLandscapeManager', domain: 'Landscape' },

  // Audio
  { pattern: /CBMetaSoundManager/i, module: 'CBMetaSoundManager', domain: 'MetaSound' },
  { pattern: /CBAudioManager/i, module: 'CBAudioManager', domain: 'Audio' },

  // Media
  { pattern: /CBMediaManager/i, module: 'CBMediaManager', domain: 'Media' },

  // Editor
  { pattern: /CBEditorManager/i, module: 'CBEditorManager', domain: 'Editor' },

  // Assets
  { pattern: /CBAssetManager/i, module: 'CBAssetManager', domain: 'Assets' },

  // Components
  { pattern: /CBComponentManager/i, module: 'CBComponentManager', domain: 'Components' },

  // Data
  { pattern: /CBDataTableManager/i, module: 'CBDataTableManager', domain: 'Data Tables' },
  { pattern: /CBDataTypeManager/i, module: 'CBDataTypeManager', domain: 'Data Types' },

  // Animation
  { pattern: /CBAnimationManager/i, module: 'CBAnimationManager', domain: 'Animation' },
  { pattern: /CBAnimGraphManager/i, module: 'CBAnimGraphManager', domain: 'Anim Graph' },

  // Behavior Trees
  { pattern: /CBBehaviorTreeManager/i, module: 'CBBehaviorTreeManager', domain: 'Behavior Trees' },

  // Input
  { pattern: /CBInputManager/i, module: 'CBInputManager', domain: 'Input' },

  // Level
  { pattern: /CBLevelManager/i, module: 'CBLevelManager', domain: 'Level' },

  // World
  { pattern: /CBWorldManager/i, module: 'CBWorldManager', domain: 'World' },

  // Gameplay
  { pattern: /CBGameplayManager/i, module: 'CBGameplayManager', domain: 'Gameplay' },

  // Navigation
  { pattern: /CBNavigationManager/i, module: 'CBNavigationManager', domain: 'Navigation' },

  // Source Control
  { pattern: /CBSourceControlManager/i, module: 'CBSourceControlManager', domain: 'Source Control' },

  // Testing
  { pattern: /CBTestRunner/i, module: 'CBTestRunner', domain: 'Testing' },

  // Process
  { pattern: /CBProcessManager/i, module: 'CBProcessManager', domain: 'Processes' },

  // Events
  { pattern: /CBEventManager/i, module: 'CBEventManager', domain: 'Events' },
  { pattern: /CBEventQueue/i, module: 'CBEventQueue', domain: 'Events' },

  // Performance
  { pattern: /CBPerfProfiler/i, module: 'CBPerfProfiler', domain: 'Performance' },

  // Validation
  { pattern: /CBValidationManager/i, module: 'CBValidationManager', domain: 'Validation' },

  // Snapshots
  { pattern: /CBSnapshotManager/i, module: 'CBSnapshotManager', domain: 'Snapshots' },

  // Utilities
  { pattern: /CBUtilManager/i, module: 'CBUtilManager', domain: 'Utilities' },
  { pattern: /CBFileGenerators/i, module: 'CBFileGenerators', domain: 'File Generators' },

  // Generic ClaudusBridge reference
  { pattern: /ClaudusBridge/i, module: 'ClaudusBridge', domain: 'General' },
];

/**
 * Parse an error log and detect which ClaudusBridge module(s) are involved
 * @param {string} logText - The error log text
 * @returns {{ module: string|null, domain: string|null, allMatches: Array }}
 */
function parseLog(logText) {
  if (!logText) return { module: null, domain: null, allMatches: [] };

  const matches = [];
  const seen = new Set();

  for (const entry of MODULE_MAP) {
    if (entry.pattern.test(logText) && !seen.has(entry.module)) {
      seen.add(entry.module);
      matches.push({ module: entry.module, domain: entry.domain });
    }
  }

  return {
    module: matches.length > 0 ? matches[0].module : null,
    domain: matches.length > 0 ? matches[0].domain : null,
    allMatches: matches
  };
}

/**
 * Get all available domains for select menus
 */
function getDomains() {
  const domains = new Set();
  for (const entry of MODULE_MAP) {
    domains.add(entry.domain);
  }
  return [...domains].sort();
}

module.exports = { parseLog, getDomains, MODULE_MAP };
