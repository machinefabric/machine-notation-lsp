# CapDAG machine notation extension

This public landing page is for people editing `.machine` files in VS Code. It
shows the extension's editor features and configuration; the canonical language
reference is the CapDAG [machine notation specification](../docs/09-machine-notation.md).

## Features

- **Syntax highlighting** — headers, cap URNs, arrows, named members and targets, constants, step policies
- **Diagnostics** — what the text alone refuses, and what the cap definitions refuse: an arg or output
  the cap does not declare, a member of the wrong type, a constant its media's rules refuse, members
  the types leave ambiguous — each at the member, step or statement it is about
- **Hover info** — a step's cap with its args and outputs by name, an arg or output a member or target
  names, the media a node holds
- **Autocomplete** — the arg names of a wiring's step as `name=`, its output names, node names,
  header and fabric aliases, cap URNs and media URNs
- **Live graph** — a Mermaid flowchart of the resolved machine beside the editor, updated as you type

## Try a machine file

```
[extract cap:in="media:document;ext=pdf";extract;out="media:ext=txt;enc=utf-8"]
[embed cap:in="media:enc=utf-8";embed;out="media:embedding-vector;fmt=json;record"]

[document -> extract -> text]
[(text, model="small") -> embed{retry=2} -> vectors]
```

Headers bind aliases to cap URNs; wirings connect nodes through a step with
`->`. A member may name the arg it is for (`model=...`) and may be a constant;
a target may name the output it takes; `()` on either side is a source or a
sink; a policy in braces after the step says how its failures are met. A step
may also be a fabric alias, written with no header. Per-item mapping is derived
from cardinality and has no syntax of its own.

## Commands

| Command | Description |
|---|---|
| **Machine: Show Fabric** | Open the Mermaid graph view beside the editor |

The graph icon also appears in the editor title bar for `.machine` files.

## Settings

| Setting | Default | Description |
|---|---|---|
| `machine.registryUrl` | `https://fabric.capdag.com` | Base URL of the fabric registry |
| `machine.manifestVersion` | unset | The fabric manifest to read; unset, the registry's latest |

## Requirements

- VS Code 1.85.0 or later
- A connection to the fabric registry: a machine is resolved against the definitions of the caps it
  names. Without one, only what the text alone refuses is reported.
