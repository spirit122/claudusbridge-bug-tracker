import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_URL = process.env.WORKER_URL || "https://claudusbridge-bugs.eosspirit.workers.dev";
const WORKER_API_KEY = process.env.WORKER_API_KEY || "";
const PLUGIN_PATH = process.env.PLUGIN_PATH || "C:\\Users\\eos\\Documents\\ClaudusBridge";
const PLUGIN_SRC = join(PLUGIN_PATH, "Source", "ClaudusBridge", "Private");

// Worker API helper
async function workerFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (WORKER_API_KEY) headers["Authorization"] = `Bearer ${WORKER_API_KEY}`;
  const res = await fetch(`${WORKER_URL}${path}`, { ...options, headers });
  return res.json();
}

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
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (severity) params.set("severity", severity);
    if (domain) params.set("domain", domain);
    if (module) params.set("detected_module", module);
    if (ue_version) params.set("ue_version", ue_version);
    if (search) params.set("search", search);
    if (limit) params.set("limit", String(limit));

    const data = await workerFetch(`/api/bugs?${params}`);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total: data.total, count: data.bugs?.length || 0, bugs: data.bugs }, null, 2),
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
    const id = ticket.startsWith("CB-") ? ticket.toUpperCase() : ticket;
    const data = await workerFetch(`/api/bugs/${id}`);
    if (data.error) {
      return { content: [{ type: "text", text: `Bug "${ticket}" not found.` }] };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ bug: data.bug, improvements: data.improvements }, null, 2),
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
    // First get the bug to find numeric ID
    const id = ticket.startsWith("CB-") ? ticket.toUpperCase() : ticket;
    const getBug = await workerFetch(`/api/bugs/${id}`);
    if (getBug.error) {
      return { content: [{ type: "text", text: `Bug "${ticket}" not found.` }] };
    }

    const body = {};
    if (status) body.status = status;
    if (severity) body.severity = severity;
    if (Object.keys(body).length === 0) {
      return { content: [{ type: "text", text: "No fields to update." }] };
    }

    const updated = await workerFetch(`/api/bugs/${getBug.bug.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `Bug ${ticket} updated.`, bug: updated }, null, 2),
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
    const imp = await workerFetch("/api/improvements", {
      method: "POST",
      body: JSON.stringify({ title, description, affected_module, affected_files, priority, target_version, bug_ids }),
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `Improvement ${imp.task_id} created.`, improvement: imp }, null, 2),
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
    // Get improvement list to find numeric ID
    const list = await workerFetch("/api/improvements");
    const imp = (list.improvements || []).find(i =>
      i.task_id === task_id.toUpperCase() || String(i.id) === task_id
    );
    if (!imp) {
      return { content: [{ type: "text", text: `Improvement "${task_id}" not found.` }] };
    }

    const body = {};
    if (status) body.status = status;
    if (priority) body.priority = priority;
    if (fix_notes !== undefined) body.fix_notes = fix_notes;
    if (Object.keys(body).length === 0) {
      return { content: [{ type: "text", text: "No fields to update." }] };
    }

    const updated = await workerFetch(`/api/improvements/${imp.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ message: `Improvement ${task_id} updated.`, improvement: updated }, null, 2),
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
    await workerFetch(`/api/bugs/${bug_id}/link`, {
      method: "POST",
      body: JSON.stringify({ improvement_id }),
    });
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
    const data = await workerFetch("/api/analytics");
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// --- get_fix_requests ---
server.tool(
  "get_fix_requests",
  "Get pending fix requests from the dashboard. When a user clicks 'Solucionar' on a bug, it creates a fix request with the full error log and module info. Use this to see what bugs need fixing.",
  {},
  async () => {
    const data = await workerFetch("/api/fix-requests");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ pending: (data.fix_requests || []).length, requests: data.fix_requests || [] }, null, 2),
      }],
    };
  }
);

// --- complete_fix_request ---
server.tool(
  "complete_fix_request",
  "Remove a fix request after the bug has been resolved. Call this after resolve_bug to clean up.",
  {
    ticket: z.string().describe("Ticket ID (e.g. 'CB-001')"),
  },
  async ({ ticket }) => {
    await workerFetch(`/api/fix-requests/${ticket.toUpperCase()}`, { method: "DELETE" });
    return { content: [{ type: "text", text: `Fix request for ${ticket} completed and removed.` }] };
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
    const id = ticket.startsWith("CB-") ? ticket.toUpperCase() : ticket;
    const getBug = await workerFetch(`/api/bugs/${id}`);
    if (getBug.error) {
      return { content: [{ type: "text", text: `Bug "${ticket}" not found.` }] };
    }
    const bug = getBug.bug;

    // Resolve via Worker (updates status + creates notification for Discord bot)
    const result = await workerFetch(`/api/bugs/${bug.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ fix_notes: fix_notes || "" }),
    });

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
