import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "bugs.db");

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

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
