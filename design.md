# Design — Babel Content Downloader

A locked design system for the extension welcome and settings pages. Both pages
must read as one local utility, with the connection state and next action visible
before setup detail.

## Genre

Modern-minimal utility interface.

## Macrostructure family

- App home: wide workbench with an asymmetric introduction and live-status panel.
- Settings: two-column configuration workbench, collapsing to one column below tablet width.
- Long technical material: collapsed details or a dedicated settings section; never part of the home-page reading path.

## Theme

- `--color-paper`: quiet blue-grey canvas.
- `--color-surface`: neutral working surface.
- `--color-ink`: deep blue-grey text.
- `--color-muted`: secondary explanatory text.
- `--color-rule`: low-contrast structural border.
- `--color-accent`: Babel teal, used for actions and state emphasis.
- `--color-focus`: brighter teal focus ring.

Concrete OKLCH values live in `extension/ui/base.css`. Page styles may only use
those semantic tokens.

## Typography

- Display: system sans, weight 720, upright.
- Body: system sans, weight 400–650.
- Mono: system monospace for commands and identifiers only.
- Display tracking: slightly tightened; long translated headings may wrap anywhere.

## Spacing

Use the named 4/8-point scale in `extension/ui/base.css`. Page rules must use
the named tokens instead of introducing one-off spacing values.

## Motion

- No motion library and no entrance animation.
- Hover and focus transitions use the short duration token.
- Reduced-motion users receive immediate state changes.

## Microinteractions stance

- State changes are quiet and textual.
- Focus is always visible.
- Destructive controls remain visually separate from routine connection actions.
- Long setup commands stay selectable and horizontally contained.

## CTA voice

- Primary: filled Babel teal, concise verb, one line.
- Secondary: plain bordered control.
- Navigation: text link with arrow only when it changes page.

## Per-page allowances

- Welcome page shows connection state, three-step usage, and common prompts.
- Settings page owns setup commands, client selection, connection controls, and technical identifiers.
- Technical diagnostics and uncommon examples default to collapsed disclosure widgets.

## What pages MUST share

- Logo, colour tokens, typography, spacing, focus treatment, language selector, and button voice.
- Maximum content width of 1180px with responsive gutters.
- English fallback and the same persisted language preference.

## What pages MAY differ on

- Welcome uses an asymmetric status-first layout.
- Settings uses denser configuration panels and a larger command block.
