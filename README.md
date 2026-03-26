<div align="center">

# ClaudusBridge Bug Tracker

### Discord-Integrated Bug Tracking & Product Improvement Pipeline

**Collect UE5 error logs from users, track bugs through resolution, and drive product improvements — with AI-powered analysis via MCP.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

[![Express](https://img.shields.io/badge/Express.js-4.21-000?style=flat-square&logo=express)](https://expressjs.com/)
[![Hono](https://img.shields.io/badge/Hono-4.4-E36002?style=flat-square)](https://hono.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-SDK-7C3AED?style=flat-square)](https://modelcontextprotocol.io/)

[Features](#features) | [Architecture](#architecture) | [How It Works](#how-it-works) | [Tech Stack](#tech-stack) | [Project Structure](#project-structure)

---

</div>

## The Problem

Managing bug reports for a commercial Unreal Engine plugin with 2,000+ users across multiple channels is chaotic. Reports come in unstructured, duplicate purchases get abused for refunds, and there's no automated way to track patterns or prioritize fixes.

## The Solution

A complete pipeline that turns Discord messages into structured, trackable bugs — with fraud detection, real-time dashboards, and AI-powered analysis:

```
Discord Report → Auto-Parse → Verify Purchase → Track → Dashboard → AI Analysis
```

> *Users type `/report-bug`, paste their UE error log, and the system handles everything else.*

---

## Features

| Feature | Description |
|---------|-------------|
| **Discord Bug Intake** | Slash commands with modals for structured reporting — users paste error logs directly |
| **Auto Log Parser** | Detects UE module and domain from error logs automatically |
| **FAB Order Verification** | Validates purchase proof against FAB Store orders |
| **Fraud Detection** | Flags duplicate order IDs used across different Discord accounts |
| **Dual Dashboard** | Local (Express + SQLite) and Cloud (Cloudflare Workers + D1) with real-time SSE |
| **Bug Lifecycle** | Full workflow: `open → investigating → fixed → wont-fix` with auto-notifications |
| **MCP Integration** | 10+ tools for Claude AI to query bugs, detect patterns, and create improvements |
| **Analytics Engine** | Severity distribution, module breakdown, UE version matrix, fraud metrics |
| **Auto-Notifications** | Discord DM + team channel alerts when bugs are resolved |
| **Fix Poller** | Background process monitors resolved bugs every 30s |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  CLAUDUSBRIDGE BUG TRACKER                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DISCORD BOT                                                │
│  ├── /report-bug    → Modal → Parse log → Verify order     │
│  ├── /bug-status    → Query by ticket ID                    │
│  └── Notifications  → DM user + team channel on resolution  │
│       │                                                     │
│       ▼                                                     │
│  LOCAL LAYER                                                │
│  ├── SQLite (WAL)   → 7 tables, fraud log, events          │
│  ├── Express API    → 40+ endpoints, SSE real-time          │
│  └── Dashboard UI   → Vanilla JS, live updates              │
│       │                                                     │
│       ▼                                                     │
│  CLOUD LAYER                                                │
│  ├── Cloudflare D1  → Synced database                       │
│  ├── Hono Worker    → Cloud API + dashboard                 │
│  └── Auth Middleware → API key validation                    │
│       │                                                     │
│       ▼                                                     │
│  AI LAYER                                                   │
│  └── MCP Server     → 10+ tools for Claude integration      │
│       ├── list_bugs, get_bug, update_bug                    │
│       ├── create_improvement, link_bug                      │
│       └── analytics, patterns, priority                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## How It Works

1. **Report** — User types `/report-bug` in Discord, fills modal with title + UE error log
2. **Parse** — Bot auto-detects module (e.g., `OceanRenderer`) and domain (e.g., `Rendering`) from the log
3. **Verify** — FAB Store order ID is validated; fraud check runs against registry
4. **Store** — Bug saved to SQLite locally + synced to Cloudflare D1
5. **Track** — Ticket ID generated (CB-001), status set to `open`
6. **Dashboard** — Both local and cloud dashboards update in real-time via SSE
7. **Resolve** — When status changes to `fixed`, reporter gets Discord DM with fix notes
8. **Analyze** — MCP server lets Claude query patterns, suggest priorities, create improvement tasks

---

## Tech Stack

| Layer | Technology | Purpose |
|:-----:|:----------:|:-------:|
| **Discord Bot** | Node.js, discord.js 14 | User-facing bug intake + notifications |
| **Local API** | Express.js 4.21, SQLite | REST API + real-time SSE dashboard |
| **Cloud API** | Cloudflare Workers, Hono 4, D1 | Cloud dashboard + synced database |
| **AI Integration** | MCP SDK | 10+ tools for Claude to manage bugs |
| **Frontend** | Vanilla JS, SSE | Real-time dashboard updates |
| **Process Manager** | Custom Node.js | Orchestrates 3 services with auto-restart |

---

## Project Metrics

| Metric | Value |
|:------:|:-----:|
| Lines of Code | **~8,200** |
| Source Files | **22** |
| API Endpoints | **40+** |
| MCP Tools | **10+** |
| Database Tables | **7** |
| Discord Commands | **2** |

---

## Project Structure

```
claudusbridge-bug-tracker/
│
├── bot/                    # Discord bot
│   ├── commands/           # /report-bug, /bug-status
│   ├── utils/
│   │   ├── database.js     # SQLite operations (bugs, fraud, events)
│   │   ├── log-parser.js   # Auto-detect module/domain from UE logs
│   │   └── notifier.js     # Discord embeds & notification builder
│   ├── fix-poller.js       # Auto-resolve monitor (30s interval)
│   └── index.js            # Main bot + notification polling
│
├── dashboard/              # Local Express dashboard
│   ├── routes/
│   │   ├── bugs.js         # GET/PATCH /api/bugs + filtering
│   │   ├── improvements.js # Improvement task management
│   │   └── analytics.js    # Metrics & statistics endpoints
│   ├── public/js/app.js    # SPA frontend with SSE
│   └── server.js           # Express + SSE server (port 3000)
│
├── worker/                 # Cloudflare Workers
│   ├── src/
│   │   ├── index.js        # Hono app + auth middleware
│   │   ├── db.js           # D1 database wrapper
│   │   └── routes/         # bugs, improvements, analytics, events, notifications
│   ├── public/js/app.js    # Cloud dashboard frontend
│   └── wrangler.toml       # Cloudflare config (D1 binding)
│
├── mcp/                    # MCP Server for Claude
│   └── server.js           # 10+ tools: list, get, update, create, analyze
│
├── data/                   # Local storage
│   ├── bugs.db             # SQLite database (WAL mode)
│   ├── notifications/      # Resolved bug notification queue
│   └── fix-requests/       # Fix request tracking
│
├── docs/                   # Setup documentation
├── start.js                # Process manager (3 services, auto-restart)
└── package.json
```

---

## Database Schema

| Table | Purpose |
|:-----:|:-------:|
| `bug_reports` | Core bug data — title, log, severity, status, module, domain |
| `improvement_tasks` | Product improvement tasks linked to bugs |
| `bug_improvement_links` | Many-to-many relationship between bugs and improvements |
| `fab_order_registry` | Verified FAB Store purchase records |
| `fab_fraud_log` | Flagged duplicate/suspicious order attempts |
| `events` | SSE event stream for real-time dashboard |
| `notifications` | Queued notifications for Discord delivery |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built by [spirit122](https://github.com/spirit122)** — Part of the ClaudusBridge ecosystem

</div>
