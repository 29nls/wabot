# Wabot Control Plane Design Direction

## Reading

Reading this as: an operator console for a single WhatsApp group bot owner, in a ledger-like visual language, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

## Identity

Wabot is a small control room, not a growth dashboard. The interface should feel like a well-kept operations ledger: direct labels, visible state, and enough character that it does not look like a generic admin template. The primary user is one owner who needs to know whether the Worker, database, and bot session are healthy before touching group settings.

## Palette

Three core colors plus one accent.

- Paper: `#f4f1e8` for the working surface. A warm paper tone separates the console from the blue-grey default.
- Ink: `#17231d` for text. Near-black green keeps the product tied to its WhatsApp context without copying WhatsApp branding.
- Moss: `#1f5a45` for primary actions and healthy state. It is darker than a generic success green so it can carry white text at AA contrast.
- Accent: `#a8792a` for focus, small labels, and the active edge. Amber is used sparingly because it marks attention, not decoration.

Dark mode uses the same roles with `#0e1712` paper, `#e9e5d8` ink, `#8cc7a6` action, and `#e0b45b` accent. The introduction panel keeps a deeper green surface in both modes so the login screen has a stable identity.

Reason: the palette should read as a private operations tool with a paper trail, not a SaaS marketing page.

## Typography

- Display: `Iowan Old Style`, `Palatino Linotype`, Palatino, Georgia, serif. The serif headline gives the console a human, editorial voice and prevents the all-sans admin look.
- Interface: `Segoe UI Variable`, `Segoe UI`, `Helvetica Neue`, Arial, sans-serif. System UI type keeps forms legible and avoids a network font dependency.
- Labels and identifiers: `Cascadia Mono`, `SFMono-Regular`, Consolas, monospace. Monospace is limited to small labels and status metadata, not headlines.

Reason: the product handles operational state and short instructions. The type pairing separates the human-facing introduction from the precise system labels without turning the page into a fake terminal.

## Layout

The login screen uses a split ledger. The left panel states what Wabot is and the three facts that matter before login: pairing uses an 8 digit code, D1 is the source of truth, and the control plane runs on a Worker. The right panel holds the single action.

On narrow screens the split becomes a stacked document: introduction first, login form second. The layout has a distinct middle state at 900px and a compact phone state at 560px; it is not a desktop grid squeezed into 360px.

The authenticated landing page uses the same ledger motif for system status. There is no sidebar or navigation until those destinations exist. A dead navigation item is worse than no navigation.

Reason: the owner needs one clear next action and a trustworthy status read, not a template shell with empty modules.

## Motion

MOTION 1. Only state feedback moves: a thin loading line, button color changes, and pressed states. All motion stops under `prefers-reduced-motion: reduce`.

Reason: operational tools should not animate for atmosphere. Motion confirms that something is happening.

## States

Every data surface has loading, empty, and error states.

- Session check: loading screen, error screen with retry, login screen.
- Health status: checking, active, unavailable, with a retry control.
- Bot status: unpaired, pairing, connected, disconnected, logged out, or needs attention.
- Form: idle, submitting, field error, rate limited, server error.

Empty states use plain language and do not invent numbers. The dashboard never shows fabricated uptime, user counts, or testimonials.

## Content Rules

- No em dash in interface copy.
- No fake statistics, logos, testimonials, or security claims.
- The unofficial WhatsApp protocol disclaimer appears before pairing and on the login screen.
- Buttons name the action: "Masuk ke dashboard", "Periksa lagi", "Keluar".
- Technical claims describe what the code actually does.

## Anti Slop Notes

The ledger rows are an identity motif, not a background grid. The amber accent appears on focus, small labels, and status warnings, not on every surface. There are no gradients, glass panels, glows, pill-shaped controls, or icon set decorations. The interface uses native controls with visible focus states and a minimum 44px target.
