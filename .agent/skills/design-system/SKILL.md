---
name: design-system
description: Aegis Fancy UI design tokens, typography, glassmorphism, animation rules. Use when working on UI components, styles, or visual redesign.
---
# Design System

Read these files for all design values:
- FANCY-AEGIS-MASTER-PLAN.md — full token spec, component designs, animation params
- design/mockup-shield.html — visual reference, extract CSS variables
- src/renderer/tokens.css — current tokens (extend, don't replace)

## Key Principles
- All colors via CSS variables from tokens.css
- Fonts: Outfit (titles), DM Sans (body), DM Mono (data) — LOCAL in assets/fonts/
- Glassmorphism: .panel class with backdrop-filter, inset shadow, border
- Animations: transform/opacity/filter ONLY. GPU composited. Never layout properties.
- Sparklines: pure SVG <polyline> with vector-effect="non-scaling-stroke"
- Spotlight hover: ::before pseudo-element, pointer-events: none, opacity toggle
