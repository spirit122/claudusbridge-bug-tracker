import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "bugs.db");
const PLUGIN_PATH = "C:\\Users\\zetxD\\Documents\\MCP discord\\ClaudusBridge";
const PLUGIN_SRC = join(PLUGIN_PATH, "Source", "ClaudusBridge", "Private");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- MCP Server ---

const server = new McpServer({
  name: "claudusbridge-bug-tracker",
  version: "1.0.0",
});

// ==================== TOOLS ====================

// --- list_bugs ---
server.tool(
  "list_bugs",
  "List bug reports with optional filters. Returns ticket ID, title, severity, module, status, UE version, and reporter.",
  {
    status: z.enum(["open", "investigating", "fixed", "wont-fix"]).optional().describe("Filter by status"),
    severity: z.enum(["Critical", "High", "Medium", "Low"]).optional().describe("Filter by severity"),
    domain: z.string().optional().describe("Filter by domain (e.g. 'Mesh', 'Materials', 'MCP Server')"),
    module: z.string().optional().describe("Filter by detected module (e.g. 'CBMeshManager')"),
    ue_version: z.string().optional().describe("Filter by Unreal Engine version (e.g. '5.7')"),
    search: z.string().optional().describe("Search in title and error log"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async ({ status, severity, domain, module, ue_version, search, limit }) => {
    let query = "SELECT * FROM bug_reports WHERE 1=1";
    const params = [];

    if (status) { query += " AND status = ?"; params.push(status); }
    if (severity) { query += " AND severity = ?"; params.push(severity); }
    if (domain) { query += " AND domain = ?"; params.push(domain); }
    if (module) { query += " AND detected_module = ?"; params.push(module); }
    if (ue_version) { query += " AND ue_version = ?"; params.push(ue_version); }
    if (search) { query += " AND (title LIKE ? OR error_log LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit || 50);

    const bugs = db.prepare(query).all(...params);
    const total = db.prepare("SELECT COUNT(*) as c FROM bug_reports").get().c;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total, count: bugs.length, bugs }, null, 2),
      }],
    };
  }
);

// --- get_bug ---
server.tool(
  "get_bug",
  "Get full details of a bug report by ticket ID (e.g. CB-001) or numeric ID. Includes error log, steps to reproduce, and linked improvements.",
  {
    ticket: z.string().describe("Ticket ID (e.g. 'CB-001') or numeric ID"),
  },
  async ({ ticket }) => {
    let bug;
    if (ticket.startsWith("CB-")) {
      bug = db.prepare("SELECT * FROM bug_reports WHERE ticket_id = ?").get(ticket.toUpperCase());
    } else {
      bug = db.prepare("SELECT * FROM bug_reports WHERE id = ?").get(parseInt(ticket));
    }

    if (!bug) {
      return { content: [{ type: "text", text: `Bug "${ticket}" not found.` }] };
    }

    const improvements = db.prepare(`
      SELECT i.* FROM improvement_tasks i
      JOIN bug_improvement_links l ON l.improvement_id = i.id
      WHERE l.bug_id = ?
    `).all(bug.id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ bug, improvements }, null, 2),
      }],
    };
  }
);

// --- update_bug ---
server.tool(
  "update_bug",
  "Update a bug report's status or severity. Use this after fixing a bug to mark it as resolved.",
  {
    ticket: z.string().describe("Ticket ID (e.g. 'CB-001') or numeric ID"),
    status: z.enum(["open", "investigating", "fixed", "wont-fix"]).optional().describe("New status"),
    severity: z.enum(["Critical", "High", "Medium", "Low"]).optional().describe("New severity"),
  },
  async ({ ticket, status, severity }) => {
    let bug;
    if (ticket.startsWith("CB-")) {
      bug = db.prepare("SELECT * FROM bug_reports WHERE ticket_id = ?").get(ticket.toUpperCase());
    } else {
      bug = db.prepare("SELECT * FROM bug_reports WHERE id = ?").get(parseInt(ticket));
    }

    if (!bug) {
      return { content: [{ type: "text", text: `Bug "${ticket}" not found.` }] };
    }

    const sets = [];
    const params = [];
    if (status) { sets.push("status = ?"); params.push(status); }
    if (severity) { sets.push("severity = ?"); params.push(severity); }

    if (sets.length === 0) {
      return { content: [{ type: "text", text: "No fields to update." }] };
    }

    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(bug.id);

    db.prepare(`UPDATE bug_reports SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    const updated = db.prepare("SELECT * FROM bug_reports WHERE id = ?").get(bug.id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `Bug ${updated.ticket_id} updated.`, bug: updated }, null, 2),
      }],
    };
  }
);

// --- create_improvement ---
server.tool(
  "create_improvement",
  "Create an improvement task to track a fix or enhancement. Optionally link it to bug reports.",
  {
    title: z.string().describe("Title of the improvement"),
    description: z.string().optional().describe("Detailed description of what needs to change"),
    affected_module: z.string().optional().describe("ClaudusBridge module (e.g. 'CBMeshManager')"),
    affected_files: z.array(z.string()).optional().describe("List of affected source files"),
    priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().describe("Priority level"),
    target_version: z.string().optional().describe("Target release version (e.g. 'v0.3.0')"),
    bug_ids: z.array(z.number()).optional().describe("Bug report IDs to link"),
  },
  async ({ title, description, affected_module, affected_files, priority, target_version, bug_ids }) => {
    const row = db.prepare("SELECT MAX(id) as max_id FROM improvement_tasks").get();
    const next = (row.max_id || 0) + 1;
    const task_id = `IMP-${String(next).padStart(3, "0")}`;

    db.prepare(`
      INSERT INTO improvement_tasks (task_id, title, description, affected_module, affected_files, priority, target_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(task_id, title, description || null, affected_module || null, JSON.stringify(affected_files || []), priority || "Medium", target_version || null);

    const imp = db.prepare("SELECT * FROM improvement_tasks WHERE task_id = ?").get(task_id);

    if (bug_ids && bug_ids.length > 0) {
      const linkStmt = db.prepare("INSERT OR IGNORE INTO bug_improvement_links (bug_id, improvement_id) VALUES (?, ?)");
      for (const bugId of bug_ids) {
        linkStmt.run(bugId, imp.id);
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `Improvement ${task_id} created.`, improvement: imp }, null, 2),
      }],
    };
  }
);

// --- update_improvement ---
server.tool(
  "update_improvement",
  "Update an improvement task's status, priority, or fix notes.",
  {
    task_id: z.string().describe("Task ID (e.g. 'IMP-001') or numeric ID"),
    status: z.enum(["planned", "in-progress", "fixed", "released"]).optional().describe("New status"),
    priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().describe("New priority"),
    fix_notes: z.string().optional().describe("Notes about what was fixed and how"),
  },
  async ({ task_id, status, priority, fix_notes }) => {
    let imp;
    if (task_id.startsWith("IMP-")) {
      imp = db.prepare("SELECT * FROM improvement_tasks WHERE task_id = ?").get(task_id.toUpperCase());
    } else {
      imp = db.prepare("SELECT * FROM improvement_tasks WHERE id = ?").get(parseInt(task_id));
    }

    if (!imp) {
      return { content: [{ type: "text", text: `Improvement "${task_id}" not found.` }] };
    }

    const sets = [];
    const params = [];
    if (status) { sets.push("status = ?"); params.push(status); }
    if (priority) { sets.push("priority = ?"); params.push(priority); }
    if (fix_notes !== undefined) { sets.push("fix_notes = ?"); params.push(fix_notes); }

    if (sets.length === 0) {
      return { content: [{ type: "text", text: "No fields to update." }] };
    }

    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(imp.id);

    db.prepare(`UPDATE improvement_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    const updated = db.prepare("SELECT * FROM improvement_tasks WHERE id = ?").get(imp.id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `Improvement ${updated.task_id} updated.`, improvement: updated }, null, 2),
      }],
    };
  }
);

// --- link_bug_improvement ---
server.tool(
  "link_bug_improvement",
  "Link a bug report to an improvement task, creating a traceability relationship.",
  {
    bug_id: z.number().describe("Bug report numeric ID"),
    improvement_id: z.number().describe("Improvement task numeric ID"),
  },
  async ({ bug_id, improvement_id }) => {
    db.prepare("INSERT OR IGNORE INTO bug_improvement_links (bug_id, improvement_id) VALUES (?, ?)").run(bug_id, improvement_id);
    return {
      content: [{
        type: "text",
        text: `Linked bug #${bug_id} to improvement #${improvement_id}.`,
      }],
    };
  }
);

// --- get_analytics ---
server.tool(
  "get_analytics",
  "Get bug tracker analytics: counts by status, severity, module, domain, UE version, and recent trends.",
  {},
  async () => {
    const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM bug_reports GROUP BY status").all();
    const bySeverity = db.prepare("SELECT severity, COUNT(*) as count FROM bug_reports GROUP BY severity").all();
    const byModule = db.prepare("SELECT detected_module, COUNT(*) as count FROM bug_reports WHERE detected_module IS NOT NULL GROUP BY detected_module ORDER BY count DESC").all();
    const byDomain = db.prepare("SELECT domain, COUNT(*) as count FROM bug_reports WHERE domain IS NOT NULL GROUP BY domain ORDER BY count DESC").all();
    const total = db.prepare("SELECT COUNT(*) as c FROM bug_reports").get().c;
    const totalImprovements = db.prepare("SELECT COUNT(*) as c FROM improvement_tasks").get().c;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total, totalImprovements, byStatus, bySeverity, byModule, byDomain }, null, 2),
      }],
    };
  }
);

// ==================== PLUGIN SOURCE TOOLS ====================

// --- list_plugin_files ---
server.tool(
  "list_plugin_files",
  "List all source files in the ClaudusBridge UE5 plugin. Use to find which files to read/edit when fixing a bug.",
  {
    filter: z.string().optional().describe("Filter filenames (e.g. 'Mesh' to find CBMeshManager files)"),
  },
  async ({ filter }) => {
    const files = readdirSync(PLUGIN_SRC).filter(f => f.endsWith(".cpp") || f.endsWith(".h"));
    const filtered = filter ? files.filter(f => f.toLowerCase().includes(filter.toLowerCase())) : files;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          plugin_path: PLUGIN_PATH,
          source_path: PLUGIN_SRC,
          total: filtered.length,
          files: filtered,
        }, null, 2),
      }],
    };
  }
);

// --- read_plugin_file ---
server.tool(
  "read_plugin_file",
  "Read the contents of a source file from the ClaudusBridge UE5 plugin. Use to analyze code related to a bug.",
  {
    filename: z.string().describe("Filename (e.g. 'CBMeshManager.cpp')"),
  },
  async ({ filename }) => {
    // Check Private first, then Public
    let filepath = join(PLUGIN_SRC, filename);
    if (!existsSync(filepath)) {
      filepath = join(PLUGIN_PATH, "Source", "ClaudusBridge", "Public", filename);
    }
    if (!existsSync(filepath)) {
      return { content: [{ type: "text", text: `File "${filename}" not found in plugin source.` }] };
    }

    const content = readFileSync(filepath, "utf-8");
    return {
      content: [{
        type: "text",
        text: `// File: ${filepath}\n// Lines: ${content.split("\n").length}\n\n${content}`,
      }],
    };
  }
);

// --- write_plugin_file ---
server.tool(
  "write_plugin_file",
  "Write/update a source file in the ClaudusBridge UE5 plugin. Use after analyzing a bug to apply the fix.",
  {
    filename: z.string().describe("Filename (e.g. 'CBMeshManager.cpp')"),
    content: z.string().describe("Full file content to write"),
  },
  async ({ filename, content }) => {
    let filepath = join(PLUGIN_SRC, filename);
    if (!existsSync(filepath)) {
      filepath = join(PLUGIN_PATH, "Source", "ClaudusBridge", "Public", filename);
    }
    if (!existsSync(filepath)) {
      return { content: [{ type: "text", text: `File "${filename}" not found. Cannot create new files via MCP.` }] };
    }

    writeFileSync(filepath, content, "utf-8");
    return {
      content: [{
        type: "text",
        text: `File "${filename}" updated successfully (${content.split("\n").length} lines).`,
      }],
    };
  }
);

// --- commit_plugin_fix ---
server.tool(
  "commit_plugin_fix",
  "Commit changes in the ClaudusBridge plugin repo and push to origin. Use after writing fixes to source files.",
  {
    message: z.string().describe("Commit message describing the fix"),
    files: z.array(z.string()).optional().describe("Specific files to commit (default: all changed files)"),
  },
  async ({ message, files }) => {
    try {
      const cwd = PLUGIN_PATH;
      const opts = { cwd, encoding: "utf-8" };

      if (files && files.length > 0) {
        for (const f of files) {
          execSync(`git add "Source/ClaudusBridge/Private/${f}"`, opts);
        }
      } else {
        execSync("git add -A", opts);
      }

      const status = execSync("git status --short", opts).trim();
      if (!status) {
        return { content: [{ type: "text", text: "No changes to commit." }] };
      }

      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, opts);
      const log = execSync("git log --oneline -1", opts).trim();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ message: "Committed and ready.", commit: log, changed_files: status }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Git error: ${err.message}` }] };
    }
  }
);

// --- resolve_bug ---
server.tool(
  "resolve_bug",
  "Mark a bug as fixed and notify the reporter via Discord DM. Combines update_bug + Discord notification in one step.",
  {
    ticket: z.string().describe("Ticket ID (e.g. 'CB-001')"),
    fix_notes: z.string().optional().describe("Notes about what was fixed"),
  },
  async ({ ticket, fix_notes }) => {
    let bug;
    if (ticket.startsWith("CB-")) {
      bug = db.prepare("SELECT * FROM bug_reports WHERE ticket_id = ?").get(ticket.toUpperCase());
    } else {
      bug = db.prepare("SELECT * FROM bug_reports WHERE id = ?").get(parseInt(ticket));
    }

    if (!bug) {
      return { content: [{ type: "text", text: `Bug "${ticket}" not found.` }] };
    }

    // Update status to fixed
    db.prepare("UPDATE bug_reports SET status = 'fixed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(bug.id);

    // Try to notify via Discord bot's HTTP endpoint or direct webhook
    // We write a notification file that the bot can poll
    const notifDir = join(__dirname, "..", "data", "notifications");
    mkdirSync(notifDir, { recursive: true });
    const notif = {
      type: "bug_resolved",
      ticket_id: bug.ticket_id,
      title: bug.title,
      discord_user_id: bug.discord_user_id,
      discord_user: bug.discord_user,
      fix_notes: fix_notes || null,
      resolved_at: new Date().toISOString(),
    };
    writeFileSync(join(notifDir, `${bug.ticket_id}.json`), JSON.stringify(notif, null, 2));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Bug ${bug.ticket_id} marked as fixed.`,
          notification: `Notification queued for ${bug.discord_user || bug.discord_user_id}.`,
          fix_notes: fix_notes || "none",
          bug: { ...bug, status: "fixed" },
        }, null, 2),
      }],
    };
  }
);

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
