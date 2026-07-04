# CAPDAG Machine Notation

VS Code extension for `.machine` files — the bracket-delimited DAG wiring notation used by the [CAPDAG](https://capdag.com) system.

## Features

- **Syntax highlighting** — brackets, cap URNs, media URNs, arrows, aliases
- **Diagnostics** — parse errors, undefined aliases, duplicate aliases, invalid URNs with precise positions
- **Hover info** — cap URN details, media def types, registry-enriched metadata
- **Autocomplete** — registry-backed suggestions for cap URNs, media URNs, ops, node names, and aliases
- **Live graph** — Mermaid flowchart that renders beside the editor and updates as you type

## .machine File Format

```
[extract_metadata cap:in=media:pdf;extract-metadata;out="media:file-metadata;textable;record"]
[extract_outline cap:in=media:pdf;extract-outline;out="media:document-outline;textable;record"]
[generate_thumbnail cap:in=media:pdf;generate-thumbnail;out="media:image;png;thumbnail"]

[pdf_input -> extract_metadata -> metadata]
[pdf_input -> extract_outline -> outline]
[pdf_input -> generate_thumbnail -> thumbnail]
```

Each statement is enclosed in brackets. **Headers** bind an alias to a cap URN. **Wirings** connect nodes through capabilities using `->` arrows. Fan-in uses parenthesized groups: `[(a, b) -> cap -> target]`. Per-item mapping (ForEach) is derived automatically from capability cardinality by the engine.

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
