# Omacelium

Omarchy's mesh for shared inference.

An Omarchy plugin that lets nearby machines pool spare GPU capacity into one
local OpenAI-compatible endpoint, backed by Mesh-LLM.

**Status:** scoping. No installable code yet. Design docs live with the
project; the plugin id is `ewweberlin.omacelium`.

## What it will be

- An Omarchy bar widget plus service that starts, stops, and supervises a
  local Mesh-LLM node.
- A single local endpoint (`http://127.0.0.1:9337/v1`) that agents such as
  OpenCode, Claude Code, and Pi can use.
- Controls for joining the mesh, contributed VRAM, and a local-only switch.

## Security posture

Serving a model means the serving node can read the prompts it serves, so
"no participant sees another's prompts" cannot hold on an open community
mesh. Planned default is local-only; any mesh mode is opt-in and restricted
to trusted owners. See the security scope for the full model.

## Not yet

Nothing here is published to Omarchy. Milestones, contracts, and open
questions are tracked in the planning docs.
