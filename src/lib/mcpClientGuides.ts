/** Static MCP client guides + deep-link examples for MCP Connect. */

export type ClientId = 'claude' | 'cursor' | 'codex' | 'windsurf' | 'generic'

export interface ClientGuide {
  id: ClientId
  name: string
  summary: string
  steps: string[]
  configLabel: string
  config: (serverPath: string) => string
}

export const MCP_TEST_PROMPT =
  'List my Shelf tools and tell me which ones are running.'

export const SHELF_URL_EXAMPLES = [
  { url: "open 'shelf://open'", hint: 'Show the library' },
  { url: "open 'shelf://quick-open'", hint: 'Open Quick Open (⌘K)' },
  { url: "open 'shelf://tools/<id>/launch'", hint: 'Launch a tool by id' },
  { url: "open 'shelf://tools/<id>/stop'", hint: 'Stop a running tool' },
  { url: "open 'shelf://launch?name=Photo%20Prepper'", hint: 'Launch by name' },
  { url: "open 'shelf://mcp'", hint: 'Open this page' },
]

function stdioJsonConfig(serverPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        shelf: {
          command: 'node',
          args: [serverPath],
        },
      },
    },
    null,
    2,
  )
}

export const CLIENTS: ClientGuide[] = [
  {
    id: 'claude',
    name: 'Claude Desktop',
    summary: 'One-click connect — Shelf writes Claude’s MCP config for you.',
    steps: [
      'Use Connect on this page (or paste the JSON below).',
      'Fully Quit Claude Desktop, then reopen it.',
      'Ask: “List my Shelf tools.”',
    ],
    configLabel: 'Advanced: claude_desktop_config.json snippet',
    config: stdioJsonConfig,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    summary: 'One-click connect — Shelf writes ~/.cursor/mcp.json for you.',
    steps: [
      'Use Connect on this page (or paste the JSON below).',
      'Reload MCP in Cursor Settings → MCP.',
      'Ask: “List my Shelf tools.”',
    ],
    configLabel: 'Advanced: ~/.cursor/mcp.json snippet',
    config: stdioJsonConfig,
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    summary: 'One-click connect — Shelf upserts [mcp_servers.shelf] in ~/.codex/config.toml.',
    steps: [
      'Use Connect on this page (or paste the TOML below).',
      'Restart Codex / ChatGPT Codex, or start a new CLI session.',
      'Ask: “List my Shelf tools.”',
    ],
    configLabel: 'Advanced: ~/.codex/config.toml snippet',
    config: (serverPath) =>
      [
        '[mcp_servers.shelf]',
        'command = "node"',
        `args = ["${serverPath}"]`,
        '',
      ].join('\n'),
  },
  {
    id: 'windsurf',
    name: 'Windsurf / Cascade',
    summary: 'Add a custom MCP server with the stdio command shown below.',
    steps: [
      'Open Windsurf MCP / Cascade tool settings.',
      'Create a custom stdio MCP server named shelf.',
      'Set command to node and args to the absolute server.js path.',
      'Reload Cascade and confirm shelf_* tools load.',
    ],
    configLabel: 'Windsurf MCP server entry',
    config: stdioJsonConfig,
  },
  {
    id: 'generic',
    name: 'Other MCP clients',
    summary: 'Any MCP client that supports local stdio servers can use this entry.',
    steps: [
      'Choose stdio / local process transport (not HTTP).',
      'Command: node',
      'Args: one absolute path to dist-mcp/mcp/server.js',
      'Do not write logs to stdout from wrappers — stdout is the MCP channel.',
    ],
    configLabel: 'Generic stdio config',
    config: (serverPath) =>
      JSON.stringify(
        {
          name: 'shelf',
          transport: 'stdio',
          command: 'node',
          args: [serverPath],
        },
        null,
        2,
      ),
  },
]

export const ONE_CLICK_CLIENTS: ClientId[] = ['claude', 'cursor', 'codex']
