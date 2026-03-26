# ClaudusBridge Bug Tracker

Production-ready bug tracking system that bridges **Discord**, **local dashboards**, and **Cloudflare Workers** for the ClaudusBridge Unreal Engine plugin ecosystem.

Built to collect error logs from UE5 plugin users, track bugs through resolution, and drive product improvements — all integrated with AI-powered analysis via MCP.

---

## Architecture

```
Discord Bot ──► SQLite (local) ──► Express Dashboard (SSE real-time)
     │                                      │
     └──────► Cloudflare D1 ──► Worker Dashboard (cloud)
                                            │
                               MCP Server ──► Claude AI
```

## Key Features

- **Discord Bug Reporting** — Slash commands with modals for structured bug intake, auto-detection of UE module/domain from error logs
- **Dual Dashboard** — Local Express + Cloud Cloudflare Workers with real-time updates via Server-Sent Events
- **FAB Order Verification** — Validates purchase proof and detects fraud (duplicate order IDs across accounts)
- **Smart Bug Lifecycle** — Status workflow: `open → investigating → fixed → wont-fix` with auto-notifications
- **MCP Integration** — 10+ tools for Claude AI to query, manage bugs, and create improvement tasks programmatically
- **Analytics Engine** — Severity distribution, module breakdown, UE version compatibility matrix, fraud metrics

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Discord Bot | Node.js, discord.js 14 |
| Local Dashboard | Express.js, SQLite (better-sqlite3), SSE |
| Cloud Worker | Cloudflare Workers, Hono 4, D1 |
| AI Integration | MCP SDK (Model Context Protocol) |
| Frontend | Vanilla JS, real-time SSE updates |

## Project Structure

```
bot/                  # Discord bot — slash commands, notifications, fraud detection
dashboard/            # Local Express dashboard — REST API + SSE real-time UI
worker/               # Cloudflare Workers — cloud dashboard + D1 sync
mcp/                  # MCP Server — Claude AI integration (10+ tools)
docs/                 # Setup documentation
data/                 # SQLite DB + notification/fix-request storage
```

## Metrics

| Metric | Value |
|--------|-------|
| Lines of Code | ~8,200 |
| Source Files | 22 |
| API Endpoints | 40+ |
| MCP Tools | 10+ |
| Database Tables | 7 |
| Discord Commands | 2 |

## Data Flow

1. User reports bug via Discord `/report-bug` with UE error log
2. Bot auto-detects module, verifies FAB order, checks for fraud
3. Bug saved to local SQLite + synced to Cloudflare D1
4. Dashboards update in real-time via SSE
5. Fix-poller monitors resolved bugs every 30s
6. Resolution triggers Discord notification to reporter + team channel
7. MCP server enables Claude to analyze patterns and manage bugs

## License

MIT
