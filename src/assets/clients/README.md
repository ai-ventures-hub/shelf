# Client brand logos (drop zone)

Official brand marks shown on the AI Connections page. The UI falls back to
lettermarks (`C`, `CC`, `Cu`, `Cx`) for any file that is missing — the app
builds and runs fine with this folder empty.

## Exact filenames

| File | Shown for |
| --- | --- |
| `claude.svg` | Claude Desktop |
| `claude-code.svg` | Claude Code |
| `cursor.svg` | Cursor |
| `codex.svg` | OpenAI Codex |

Optional per-file dark-theme override: add `-dark` before the extension
(e.g. `cursor-dark.svg`) and it is used instead when the app is in dark mode.
If you only drop one file per client, it is used in both themes — so prefer a
variant that reads on both light and dark backgrounds.

## Format

- **SVG strongly preferred** (crisp at any size). PNG also works: square,
  transparent background, at least 128×128.
- Use the **glyph-only mark**, not the horizontal wordmark — it renders inside
  a 36px rounded tile at ~22px.
- Download unmodified assets from each vendor's official brand/press page and
  follow their guidelines (no recoloring, no distortion).

Files here are bundled into the app by Vite (`src/lib/clientLogos.ts` picks
them up by name — no code change needed when adding or swapping a file).

## Provenance (current files)

| File | Source | Modified? |
| --- | --- | --- |
| `claude.svg` | Claude brand glyph, `https://claude.ai/favicon.svg` (#D97757, transparent) | no |
| `claude-code.png` | Official Claude Code product icon, Anthropic's VS Code Marketplace listing (`anthropic.claude-code`), 266×266 RGBA | no |
| `cursor.svg` | `General Logos/Cube/SVG/CUBE_2D_LIGHT.svg` from Cursor's brand kit (`cursor.com/brand`) | no |
| `cursor-dark.svg` | `General Logos/Cube/SVG/CUBE_2D_DARK.svg` from the same kit | no |
| `codex.svg` | OpenAI black monoblossom, `https://developers.openai.com/assets/OpenAI-black-monoblossom.svg` | no |
| `codex-dark.svg` | Same file with `fill="black"` → `fill="white"` (OpenAI's sanctioned monochrome inversion; they do not publish the white SVG on an ungated URL) | recolor only |

Notes:

- Anthropic does not publish a Claude Code glyph that is distinct from the
  Claude sunburst, so the two Anthropic tiles are differentiated by treatment:
  open clay sunburst (Claude Desktop) vs. white sunburst on a clay disc
  (Claude Code, their own product icon).
- Anthropic's brand assets live in a gated Brandfolder; `anthropic.com/brand`
  is a 404. The glyph above is taken from Anthropic's own product surface.
- Cursor and OpenAI marks are single-colour, so both ship a `-dark` override —
  without it they disappear against the dark tile (`--input: #0b101c`).
