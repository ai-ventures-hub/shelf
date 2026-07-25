# Shelf

Personal command center for the tools you build.

Shelf is a macOS Electron prototype that stores a visual library of local tools — scripts, web apps, and utilities — and launches them with remembered commands, live status, and logs.

## Requirements

- macOS
- Node.js 20+

## Develop

```bash
npm install
npm run electron:dev
```

This starts the Vite renderer on `http://127.0.0.1:5173` and opens the Electron shell.

## Install a desktop prototype (.app)

```bash
npm run install:desktop
```

That builds Shelf, packages `Shelf.app`, and copies it to `/Applications` (when permissions allow) and Desktop. Prefer opening **Shelf** from `/Applications` — MCP Connect writes that durable path when both copies exist. Do not launch the raw Electron binary inside `node_modules`.

First launch of an unsigned local build: right-click → **Open** if macOS Gatekeeper blocks it.

Rebuild/reinstall after code changes with the same command.

## Use

1. Click **Add tool** (or press `⌘N`).
2. Choose a project folder — Shelf suggests launch command, port, tags, and DESIGN.md when it can.
3. Open the tool and click **Launch** — or use **Quick Open** (`⌘K`) to jump to a tool and `⌘↵` to launch/stop.
4. Watch status and live logs; use **Stop** / **Restart** as needed.
5. Open URL, folder, editor (Cursor/VS Code), or Terminal from the detail view.

Library data lives at:

`~/Library/Application Support/Shelf/library.json`

Run receipts (launch history):

`~/Library/Application Support/Shelf/receipts.json`

### Menu bar & `shelf://`

Shelf can sit in the menu bar (Settings → Menu bar). Global show/hide defaults to `⌘⇧Space`.

URL examples (packaged app registers the scheme):

```bash
open 'shelf://open'
open 'shelf://quick-open'
open 'shelf://tools/<id>/launch'
open 'shelf://launch?name=Photo%20Prepper'
```

## MCP (Cursor / agents)

**Easiest path:** open Shelf → **MCP Connections** → Connect Claude, Cursor, or Codex. Shelf writes the client MCP config for you (Claude: quit and reopen; Cursor: reload MCP; Codex: restart / new CLI session), then ask “List my Shelf tools.”

Shelf exposes a local stdio MCP server that reads and writes the **same** library as the GUI, and can launch/stop tools.

```bash
npm run mcp:build
```

This produces a **standalone** bundle at `dist-mcp/mcp/server.js` (MCP SDK deps included). The packaged desktop app ships the same file under `Shelf.app/Contents/Resources/mcp/`.

Add to Cursor MCP settings (prefer the path shown in **MCP Connect** inside Shelf):

```json
{
  "mcpServers": {
    "shelf": {
      "command": "node",
      "args": [
        "/Applications/Shelf.app/Contents/Resources/mcp/mcp/server.js"
      ]
    }
  }
}
```

Tools: `shelf_list_tools`, `shelf_get_tool`, `shelf_find_free_port`, `shelf_inspect_project`, `shelf_upsert_tool`, `shelf_remove_tool`, `shelf_launch_tool`, `shelf_stop_tool`, `shelf_get_status`, `shelf_get_logs`, `shelf_list_receipts`, `shelf_clear_receipts`, `shelf_list_collections`, `shelf_get_design_md`. Resource: `shelf://tools/{id}/design-md`.

Project skill for agents: [`.cursor/skills/shelf-register/SKILL.md`](.cursor/skills/shelf-register/SKILL.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run electron:dev` | Dev app with hot reload |
| `npm run build` | Compile shared + Electron + MCP + Vite |
| `npm run mcp` | Build and run the MCP server on stdio |
| `npm run typecheck` | TypeScript checks |
| `npm run smoke` | Shell/port readiness smoke test |
| `npm run smoke:quick-open` | Quick Open ranking helpers |
| `npm run smoke:import` | Smart project-import inspector |
| `npm run smoke:receipts` | Run receipt store |
| `npm run smoke:receipt-export` | Receipt filter + JSON/CSV export |
| `npm run smoke:shelf-url` | `shelf://` URL parser |
| `npm run smoke:adopt` | Adopt/stop a tool launched by another ProcessManager |
| `npm run smoke:claude-connect` | One-click Claude Desktop config merge |
| `npm run smoke:cursor-connect` | One-click Cursor MCP config merge |
| `npm run smoke:codex-connect` | One-click Codex `config.toml` upsert |
| `npm run smoke:mcp-path` | Prefer `/Applications` MCP path over Desktop |
| `npm run smoke:electron` | Library + ProcessManager integration smoke |
| `npm run smoke:mcp` | MCP client end-to-end smoke |
| `npm run smoke:all` | Full pre-product smoke gate |

## License

MIT — see [LICENSE](LICENSE).

## CI

GitHub Actions runs `npm run typecheck` and `npm run smoke:all` on macOS for pushes/PRs to `main`.

## Notes

- Commands run via `/bin/zsh -lc` so login PATH (nvm/fnm) is available.
- Interactive prompts and `sudo` are not supported in the MVP.
- Status never reports Running for port-backed tools until TCP readiness succeeds.
- MCP responses mask env keys matching `TOKEN|SECRET|PASSWORD|KEY`.
