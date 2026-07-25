# Suds System Studio Design Language

> **Reusable visual specification.** Give this document to an AI agent or developer when another
> application should feel like Suds System Studio. It describes the implemented design system, not a
> speculative redesign. Product facts and operating procedures remain in the owning documentation.

## 1. Design intent

Suds System Studio is a high-trust technical control room. It should feel calm, precise, premium, and
operationally serious. The interface supports long-lived release, fleet, documentation, and visual
review work, so clarity and confidence matter more than novelty.

Use these attributes as the visual brief:

- dark, restrained, and quietly technical;
- information-dense without feeling crowded;
- generous page-level space with compact controls;
- strong hierarchy led by oversized editorial headings;
- understated indigo as the single brand accent;
- semantic green, amber, and red used only for meaningful state;
- crisp borders and opaque surfaces rather than decorative glass effects;
- small, precise labels paired with plain-language operational copy.

Avoid neon cyberpunk styling, generic white SaaS dashboards, heavy glassmorphism, loud gradients,
excessive shadows, playful consumer-app decoration, and color used without semantic meaning.

## 2. Canonical visual tokens

Keep the token names when implementing this language in another application. Brand customization
should normally change the mark, product name, and indigo accent—not the hierarchy or semantic color
roles.

```css
:root {
  color-scheme: dark;

  --ink: #f6f7fb;
  --muted: #99a3b8;
  --subtle: #6f7a91;

  --surface: #090d16;
  --panel: #111725;
  --panel-raised: #171e2f;
  --line: #273047;

  --brand: #7895ff;
  --brand-strong: #9badff;

  --success: #48d597;
  --warning: #f3bc62;
  --danger: #f0787d;
}
```

### Color usage

| Token | Role |
|---|---|
| `--surface` | Page canvas and deepest background |
| `--panel` | Standard cards, tables, filters, and operational surfaces |
| `--panel-raised` | Featured cards and subtle surface gradients |
| `--line` | Borders, separators, and structure |
| `--ink` | Primary headings and high-priority values |
| `--muted` | Body copy and supporting explanations |
| `--subtle` | Metadata, secondary labels, timestamps, and low-emphasis text |
| `--brand` | Primary actions, active emphasis, and focus language |
| `--brand-strong` | Links, eyebrows, code-like next actions, and hover emphasis |
| semantic colors | Verified state only; never decoration |

The body background uses a restrained blue glow, not a full gradient:

```css
body {
  background:
    radial-gradient(circle at 15% -10%, rgb(73 98 193 / 18%), transparent 30rem),
    var(--surface);
}
```

## 3. Typography

Use Inter when available, followed by the native system stack. Do not delay rendering for a decorative
display typeface.

```css
font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system,
  BlinkMacSystemFont, "Segoe UI", sans-serif;
```

### Type hierarchy

- Page title: `clamp(2.2rem, 5vw, 4.25rem)`, line-height `0.98`, tracking `-0.055em`.
- Section title: `clamp(1.3rem, 3vw, 1.8rem)`, tracking `-0.025em`.
- Eyebrow: `0.72rem`, weight `760`, tracking `0.14em`, uppercase, `--brand-strong`.
- Introductory copy: `1.05rem`, max width `62ch`, `--muted`.
- Navigation: `0.82rem`, weight approximately `680`.
- Metadata/table labels: `0.67–0.75rem`, often uppercase with `0.08–0.10em` tracking.
- Code and identifiers: SFMono/Consolas/Liberation Mono at about `0.86em`.

Use sentence case for headings and actions. Reserve uppercase for compact structural labels such as
`APPROVED SYSTEM`, `SOURCE`, or `STATUS`.

## 4. Spacing, radius, and depth

The system uses a practical 4/8-based rhythm even though values are expressed in `rem`.

- Tight inline gap: `0.4–0.5rem`.
- Standard component gap: `0.8–1rem`.
- Card padding: `1.2–1.5rem`.
- Page section gap: `1–2rem`.
- Major section separation: `3–5rem`.
- Input/button height: `42–48px`.
- Control radius: `8–11px`.
- Card radius: `14–18px`.
- Hero/login card radius: `24px`.
- Pills: `999px`.

Most surfaces use a one-pixel `--line` border with no shadow. The centered landing/login card is the
exception and may use `0 30px 90px rgb(0 0 0 / 36%)`. The brand mark may use a restrained blue glow.

## 5. Application shells

### Authenticated Studio shell

- Use a two-column frame: `250px` sidebar plus a flexible content column.
- Keep the sidebar sticky and full viewport height on desktop.
- Use a translucent `--surface` sidebar, a single right border, and `1.1rem` internal padding.
- Put product identity first, primary navigation next, and account/public links at the bottom.
- Navigation items use muted text, a transparent border, `9px` radius, and compact padding. Hover and
  keyboard focus raise the item to `--panel` and `--ink`.
- Constrain content to `1220px`, use `calc(100% - 3rem)` width, and center it.
- Give page headers generous top space: `clamp(3rem, 8vw, 6.2rem)`.
- Align the title block and its single primary action along their bottom edge on wide screens.

### Public documentation/library shell

- Constrain content to `1180px` with at least `1rem` outer gutters.
- Use a quiet `78px` header with a bottom border.
- Keep navigation small and text-led.
- Reuse the same tokens and typography so public manuals feel like the same product, not a marketing
  microsite.

### Landing and authentication shell

- Center one focused card in the viewport.
- Use a maximum width of `620px` for landing and `480px` for login.
- Use a raised dark gradient, `24px` radius, and responsive `1.5–3.5rem` padding.
- Keep the action count low and make security guidance direct.

## 6. Brand signature

The Studio mark is a compact rounded square, not a complex illustration.

- Standard size: `44px`; sidebar size: `38px`.
- Radius: `14px` standard, `11px` compact.
- Fill: `linear-gradient(145deg, #9aafff, #526fdd)`.
- Foreground: deep navy `#081021`.
- Weight: approximately `850`.
- Shadow: `0 14px 36px rgb(82 111 221 / 34%)`.

An agent rebranding another application may replace the letter, wordmark, and product subtitle. Keep
the mark geometry, visual weight, and restrained gradient unless the new brand has an established
identity that must take precedence.

## 7. Component language

### Buttons

- Base: inline-flex, centered, minimum height `42px`, `11px` radius, weight `720`.
- Primary: solid `--brand` with deep navy text; hover uses `--brand-strong`.
- Quiet: transparent fill, `--line` border, `--ink` text.
- Destructive: red-tinted border and surface; never use the primary blue treatment.
- Small utility action: minimum height `34px`, `0.75rem` type.
- Use one visually dominant action per region.

### Cards and panels

- Standard card: `--panel`, one-pixel border, `16–18px` radius.
- Featured card: subtle `--panel-raised` to `--panel` gradient.
- Status card: minimum height `165px` and a `3px` semantic top border.
- Panel: clip overflow; keep the heading and content separated by a border.
- Summary/brief cards: `24px` internal padding and a two-column grid on desktop.
- Next-action card: blue-tinted gradient, 40%-opacity brand border, and a single clear action.

### Status and health

- Use compact pills with low-opacity semantic backgrounds.
- Green means reporting, active, verified, or published.
- Amber means stale, candidate, warning, or operator review.
- Red means disabled, revoked, archived, expired, failed, or destructive.
- Gray means none, unknown, or neutral.
- Missing data must read `Unknown` or `Unverified`; never convert absence into a healthy state.

### Tables

- Use full-width, border-collapse tables inside an overflow wrapper.
- Header labels are uppercase, small, tracked, and `--subtle`.
- Rows use generous horizontal padding and faint separators.
- Hover may add only a 1.8%-white surface tint.
- Put the main entity name in bold and supporting identifiers/links below it.
- Responsive behavior should preserve data via horizontal scrolling or a deliberate card layout; do
  not hide operational columns without an alternate detail view.

### Forms

- Inputs use the deepest surface (`#070b13` or `#0b101c`), a `--line` border, and light text.
- Labels are compact, medium-bold, and slightly brighter than body copy.
- Destructive or irreversible controls require explicit confirmation language.
- Secret values must never appear in persistent logs or general status views. One-time credentials
  require a clearly bounded reveal/copy state.

### Release/workflow steps

- Represent a fixed workflow as compact numbered cells joined by one-pixel gaps.
- Use monospaced indigo step numbers and small bold labels.
- Distinguish current, completed, blocked, and terminal states semantically.
- Always pair visual progress with an exact next action.

### Empty, warning, and safety states

- Empty states are spacious, centered, and written in plain language.
- Warning/boundary cards use a low-opacity amber surface and border.
- State what is known, what is unknown, and what the operator should do next.

## 8. Responsive behavior

The implemented breakpoints are part of the design contract:

- At `1000px` and below: four-card grids become two columns; brief cards stack; large header actions
  stack; eight-step flows become four columns; seven-skin matrices become four columns.
- At `700px` and below: the sidebar becomes a normal top block, navigation becomes two columns, page
  gutters become `1rem`, all primary content grids become one column, and flows become two columns.
- At `420px` and below: metric grids become one column.

Acceptance viewports are `390px`, `768px`, and at least `1440px`. Every new surface must have zero
horizontal page overflow, readable identifiers, visible focus states, and usable controls at each.

## 9. Accessibility and motion

- Preserve native HTML landmarks, heading order, labels, table semantics, and disclosure controls.
- Every interactive element needs a visible `3px` indigo focus ring with `2px` offset.
- Do not encode status by color alone; always include a text label.
- Maintain WCAG AA contrast for body text and controls.
- Respect `prefers-reduced-motion`; operational comprehension must not depend on animation.
- Motion should be rare, short, and functional (for example, a state transition), never ambient.
- Provide useful error messages and retain user-entered non-secret form values after recoverable errors.
- Public manuals require print styles that remove navigation, preserve headings, and avoid splitting
  critical procedures across pages where practical.

## 10. Content voice

Write like a calm senior operator:

- lead with the current state;
- use specific nouns and explicit verbs;
- name the consequence of an action;
- distinguish current, planned, experimental, deprecated, and archived behavior;
- avoid hype, jokes, vague success messages, and unexplained jargon;
- end operational panels with the next safe action;
- repeat critical boundaries where the action occurs, not only in documentation.

Examples:

- Good: `Stable 2.1.9 · No canary · 0 sites behind`.
- Good: `System current. Approve a newer system revision before starting another release.`
- Good: `A merge is not a release.`
- Avoid: `Everything looks awesome!` or `Ready to go` without evidence.

## 11. AI implementation brief

Give an implementation agent these rules together with this file:

1. Audit the existing application before editing it. Reuse its routing, components, helpers, tokens,
   authorization boundaries, and data-loading patterns.
2. Implement this visual language through shared tokens and reusable components; do not scatter raw
   colors and spacing values through pages.
3. Preserve server rendering and type safety. Add client-side JavaScript only for real interaction.
4. Keep operational truth visible: unknown state is not healthy state.
5. Reuse one application shell and one component vocabulary across public and private surfaces.
6. Do not copy Suds product facts, credentials, customer data, or release identifiers into another
   branded application. This document licenses the visual language, not production data.
7. Do not introduce a component library or dependency solely to reproduce simple CSS already
   described here.
8. Verify keyboard navigation, semantic HTML, responsive behavior, loading/error/empty states, and
   contrast before considering the branding complete.

## 12. Branding checklist

- [ ] Product name, subtitle, mark letter/symbol, metadata, and favicon are intentionally branded.
- [ ] The dark token system and semantic status roles are centralized.
- [ ] Studio, public docs, library, login, tables, and forms share one visual language.
- [ ] Page titles retain the oversized, tight-tracked editorial hierarchy.
- [ ] Sidebar and page gutters match the responsive rules.
- [ ] Cards have real internal padding and consistent `16–18px` radii.
- [ ] Primary, quiet, and destructive actions are visually distinct.
- [ ] Unknown and unverified states are explicit.
- [ ] Focus, keyboard, contrast, reduced-motion, and screen-reader checks pass.
- [ ] Screens are verified at `390px`, `768px`, and `1440px+` with no page overflow.
- [ ] No secret, client data, or environment-specific identifier is embedded in the UI or screenshots.

## 13. Canonical implementation references

The current Suds implementation lives in:

- `app/globals.css` — tokens, shells, responsive behavior, and component styling;
- `components/studio-shell.tsx` — authenticated shell and navigation;
- `components/public-shell.tsx` — public documentation/library shell;
- `app/studio/page.tsx` — operational overview patterns;
- `app/studio/brief/page.tsx` — summary cards and next-action hierarchy;
- `app/docs/page.tsx` and `app/library/page.tsx` — public content patterns;
- `design-qa.md` — verified return-brief spacing and responsive evidence.

These files are implementation references, not permission to duplicate production configuration or
data. When this document and the implementation differ, verify whether the implementation changed
intentionally and update this specification in the same reviewed change.
