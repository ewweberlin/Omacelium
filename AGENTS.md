# AGENTS.md

## Repo state (read first)

Design **and** M0 spike now. The plugin skeleton (`manifest.json`, `Service.qml`,
`BarWidget.qml`, `OmaceliumPanel.qml`, `lib/*.js`, `bin/omacelium-node`,
`tests/`) is live-loaded on the Omarchy machine under the id
`ewweberlin.omacelium`; what is verified is tracked in `docs/M0-notes.md`.
No build/lint/CI config exists beyond `node --test tests/*.test.js`; both are
run from the repo root. The content below is the intended design and must be
kept in sync with the actual implementation as it lands.

**Scoping happens on macOS; real development happens on Omarchy (Arch Linux + Hyprland).** This checkout is for design only. Do not bake in macOS assumptions—target Arch, QML/Omarchy plugin conventions, and Arch packaging.

## Project

Product name: **Omacelium** (plugin id `ewweberlin.omacelium`, tagline "Bloom your GPU into the mesh."). Omarchy plugin that runs a node in a decentralized P2P mesh for LLM inference. Users opt in with a toggle, set contributed load with a slider, and choose which models the node hosts (Hugging Face download suggestions based on local hardware).

## Architecture

The plugin is a **thin wrapper / control plane** around [Mesh-LLM](https://github.com/Mesh-LLM/mesh-llm). It owns UI, process lifecycle, and Omarchy-specific defaults. P2P transport, model serving, routing, and layer splits stay in Mesh-LLM—do not reimplement them here.

Plugin surface:
1. **Bar widget** (QML): icon + status (joined / contributing / idle / offline); click opens a panel with toggle, slider, contribution stats, peer/model list, and a "use mesh endpoint" switch.
2. **Service**: start/stop the `mesh-llm` process, advertise models/capacity per the slider, expose a local OpenAI-compatible endpoint for Omarchy agents (same pattern as the existing Local AI flow), handle membership, health, and graceful leave on logout/shutdown.
3. **Settings / CLI**: `omarchy mesh …`-style commands for bootstrap, private invite links, contribution limits, model allow-list. Persist toggle + slider in plugin state so they survive shell restarts.

## Verified Mesh-LLM facts (re-check before relying on them)

- Apache-2.0, actively developed (2026); Arch packages published from `Mesh-LLM/mesh-packaging`.
- Exposes OpenAI-compatible API at `http://localhost:9337/v1`; web console on `:3131`. A binary can run `--headless` to drop the UI but keep the management API.
- CLI already covers the settings/CLI surface: `serve --auto`, `serve --model <id>`, `serve --join <token>`, `serve --publish`, `client --auto`, `--split`, `--max-vram`, `--local-model-only`.
- Model catalog + downloads are **already upstream**: `mesh-llm models recommended|search|show|download|installed|updates` (all support `--json`), `mesh-llm download <size|catalog-id>`, and `gpus [detect] --json` (per-device VRAM, unified memory, `advertised_memory`, safety margin). `models search` uses Hub `gguf`/`mlx` filters; a bare repo ref is fit-ranked against local VRAM. The web console also ships a hardware-filtered model catalog. **Do not build a recommender.**
- Transport: iroh/QUIC with NAT traversal + regional relays. Private meshes use invite tokens; public discovery uses Nostr.
- Built-in agent integrations: `mesh-llm goose|opencode|claude|pi`. A web console, management API, MCP, and a plugin system already exist.
- Config/identity lives in `~/.mesh-llm` (installer/uninstall details in the upstream README).

## Decisions locked (avoid re-litigating)

- **Stay on Mesh-LLM, do not fork.** It is the only option that is internet-scale P2P, OpenAI-compatible, and already ships the CLI/console/agent wiring this plugin needs. A fork diverges on the wire protocol (breaks interop with stock/public peers) and inherits the native-runtime build matrix. Extend via config, plugins, and upstream PRs; if a fork is ever unavoidable, fork only small pieces (`mesh-packaging`, a config/plugin) pinned to a known-good upstream version.
- **Native QML panel.** Panel is reimplemented in QML for Omarchy feel. Source data from Mesh-LLM's management API (`/api/status`, `/v1/models`, …) — do **not** parse CLI stdout. Keep `omarchy mesh …` a thin passthrough to the upstream CLI.
- **Primary target: an Omarchy community mesh, opt-in, with no contribution gating.** Private invite meshes remain supported. Participation is explicit and warned: E2E transport protects the wire, but the serving node processes prompts/activations.
- **Heterogeneous hosting (each node offers what fits).** No single curated default model. Each node advertises the models it hosts and the mesh routes `/v1` by the `model` field; agents should target the wire model `auto` (not a pinned id) so routing stays flexible. Workers auto-assign a model that is "needed by the mesh, already on disk."
- **Plugin-managed child process** (not a systemd user unit) supervises the `mesh-llm` node. Handle spawn/reap, crash restart with backoff, port `9337` conflicts, orphan cleanup on plugin unload/shell restart, and graceful leave (SIGTERM → `PEER_LEAVING`) on logout/shutdown.
- **Version pinning.** Pin a known-good `mesh-llm` version, verify it at startup, and surface mismatches.

## Implementation plan

See `IMPLEMENTATION_PLAN.md`. It resolves every gap below into a decision,
contract, milestone, and acceptance test. Where the two disagree, the plan wins
until this file is updated again.

Additional verified facts (2026-10-19, Omarchy `quattro`, Mesh-LLM `0.78.1`):

- Console/management API is on `--console` port `3131`; OpenAI API on `--port` `9337`.
  Confirmed routes: `/api/status`, `/api/runtime`, `/api/runtime/processes`,
  `/api/runtime/activity` (+ `override`), `/api/runtime/intents`,
  `/api/runtime/models`, `/api/runtime/mesh-guardrails`.
- `mesh-llm stop` stops local instances tracked in the runtime root; use with care.
- Third-party Omarchy plugins get a scoped shell facade: `serviceFor(<own id>)`
  works, cross-plugin services do not. Services are enabled via `plugins[]` or the
  plugin's enabled state; `keepLoaded: true` keeps them mounted across hot-reload.
- Upstream `[runtime.activity]` already implements host-activity admission, so the
  plugin must not reimplement Hyprland idle detection.
- Arch packages are release assets in `Mesh-LLM/mesh-packaging`, not a pacman repo;
  installing one is an explicit `pacman -U` action the user confirms.

## Open gaps to resolve during implementation

- **Community-mesh trust & abuse** (highest risk given no gating): who bootstraps/publishes the Omarchy mesh, and how are free-riding, malicious peers, rate limits, model-license exposure, and takedown handled?
- QML panel data contract: confirm the exact management-API endpoints/fields to bind to before writing UI.
- Serving policy details: how the slider maps to `--max-vram` and gates selectable model tiers; idle/pause via `[runtime.activity].advertisement`; how each node picks *what* to host from upstream fit data (`gpus --json` `advertised_memory`, `models search/show --json`) rather than a custom recommender. Gotcha: on a 1–8 GB node `--auto` serves a tiny non-chat default (`/systemone` decisions) — pass an explicit `--model` rather than rely on it.
- Resource guardrails + Omarchy idle integration: tie serving to Hyprland idle/lock/lid events so "contribute load" never degrades an active machine.
- Agent-endpoint registration for the Omarchy Local AI flow (agents target wire model `auto`), API key / loopback binding, a hostable-model allow-list, offline/no-peer/no-internet UX and agent fallback when mesh is down.
- Contribution stats source (verify `/api/status`), model-download disk management, identity backup/restore for `~/.mesh-llm`, license implications of hosting models publicly.

## Alternatives considered (context, not a plan to switch)

- **Exo** (exo-explore): best for a single LAN (auto-discovery + layer split, Apple/consumer GPUs). No internet-wide P2P, no invites. Simpler alternative if scope ever narrows to one household.
- **Petals** (bigscience-workshop): internet-scale volunteer swarm + fine-tuning, but older Python/hivemind stack, GPU-centric, thinner OpenAI/CLI polish.
- **llama.cpp RPC**: simplest LAN sharding, but manual topology and no mesh/discovery—reimplements everything Mesh-LLM provides.
- Research-grade (BloomBee, Helix, Parallax, MDI-LLM) and vendor stacks (MLX distributed, DGX Spark) are not turnkey or are hardware-locked.

## Hard constraints

- `omarchy plugin add <git-url>` **only clones** the plugin repo (manifest + QML + bundled scripts) into `~/.config/omarchy/plugins/`. It must **not** install system packages or download external binaries as a side effect. Treat installing `mesh-llm` as an explicit, user-confirmed action.
- Detect whether `mesh-llm` is already on `PATH`. On first enable / first "Start mesh", offer to install (official installer, Arch package, or AUR) and surface a "Mesh LLM not found — Install" button in the panel. Document the dependency in the README.
- Reference official install path (verify before use):
  ```
  curl -fsSL https://raw.githubusercontent.com/Mesh-LLM/mesh-llm/main/install.sh | bash
  mesh-llm setup
  ```

Keep this file updated as the repo gains real code, commands, and conventions.
