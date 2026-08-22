# CapDAG machine notation extension

This public landing page is for people editing `.machine` files in VS Code. It
shows the extension's editor features and configuration; the canonical language
reference is the CapDAG [machine notation specification](../docs/09-machine-notation.md).

## Features

- **Syntax highlighting** — brackets, cap URNs, media URNs, arrows, aliases
- **Diagnostics** — parse errors, undefined aliases, duplicate aliases, invalid URNs with precise positions
- **Hover info** — cap URN details, media def types, registry-enriched metadata
- **Autocomplete** — registry-backed suggestions for cap URNs, media URNs, ops, node names, and aliases
- **Live graph** — Mermaid flowchart that renders beside the editor and updates as you type

## Try a machine file

```
[extract cap:in="media:ext=pdf";extract;out="media:ext=txt;enc=utf-8"]
[embed cap:in="media:enc=utf-8";embed;out="media:embedding-vector;fmt=json;record"]

[document -> extract -> text]
[text -> embed -> vectors]
```

This example uses the canonical bracketed form. Headers bind aliases to cap
URNs; wirings connect nodes through capabilities with `->`. Fan-in uses a
parenthesized source group, as in `[(a, b) -> cap -> target]`. Per-item mapping
is derived from capability cardinality and has no separate syntax.

## Commands

| Command | Description |
|---|---|
| **Machine: Show Fabric** | Open the Mermaid graph view beside the editor |

The graph icon also appears in the editor title bar for `.machine` files.

## Settings

| Setting | Default | Description |
|---|---|---|
| `machine.registryUrl` | `https://capdag.com` | Base URL for the cap/media registry |
| `machine.registryCacheTtl` | `300` | Registry cache TTL in seconds |

## Requirements

- VS Code 1.85.0 or later
- Internet connection for registry-backed completions and hover enrichment (diagnostics and graph work offline)
