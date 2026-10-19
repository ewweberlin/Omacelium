# MeshLLMPlugin — Implementation Plan

Status: draft for review, 2026-10-19. Design-only checkout; no code yet.
Scope: resolves every open gap in `AGENTS.md` into decisions, contracts, and build order. Branding is contributed separately by Marketina; use placeholders here.

Ground truth checked 2026-10-19 against Mesh-LLM `main` and Omarchy `quattro`:

- Mesh-LLM latest packaged release: **0.78.1** (`Mesh-LLM/mesh-packaging`, tag `packaging-v0.78.1`), Apache-2.0.
- Upstream commands confirmed in `mesh/docs/CLI.md`: `serve`, `client`, `models …`, `gpus [detect] --json`, `load/unload/status`, `stop`, `opencode|claude|pi|goose`, `runtime guardrails`.
- Management API confirmed in `mesh/docs/USAGE.md`: **console port 3131**, OpenAI port **9337**; `/api/status`, `/api/runtime`, `/api/runtime/processes`, `/api/runtime/activity`, `/api/runtime/activity/override`, `/api/runtime/intents`, `/api/runtime/models`, `/api/runtime/mesh-guardrails`.
- Omarchy plugin contract confirmed in `docs/omarchy-shell.md` and `shell/shell.qml`: `schemaVersion: 1`, `kinds`, `entryPoints`, `barWidget` block, `keepLoaded`, inline settings in `~/.config/omarchy/shell.json`.
- Third-party service access confirmed: a third-party plugin's scoped shell facade exposes `serviceFor(<own id>)`; the service must be enabled via `plugins[]` (or the plugin's own enabled state). No cross-plugin service access.

---

## 1. Locked decisions (delta to AGENTS.md)

| Topic | Decision |
|---|---|
| Process supervision | Plugin-owned `Service.qml` supervises a **launcher script** (`bin/mesh-node`) that `exec`s `mesh-llm serve` with a pidfile. Pidfile + argv fingerprint enables orphan reaping. Still not a systemd unit. |
| Service entry | Declare both `service` and `bar-widget`, `keepLoaded: true`. Widget reads state from `bar.shell.serviceFor("<plugin id>")`. Fallback if own-service facade is unavailable on the user's Omarchy build: supervise inside `BarWidget.qml` (feature-flagged at runtime, not a second manifest). |
| Mesh surface v1 | **Public auto-discovery + private invite tokens.** The plugin does not operate a bootstrap node and does not publish an Omarchy mesh in v1. A community mesh is an operator decision made outside the plugin; `--publish` is exposed behind a confirmation. |
| Contribution gating | None, per AGENTS.md. Compensating controls: opt-in toggle, slider, model allow-list, host-activity admission policy, upstream guardrails (`--mesh-guardrails enforce`), and an explicit consent screen stating that serving peers process their prompts. |
| Slider → load | Percent of upstream-reported `advertised_memory` (from `mesh-llm gpus --json`), mapped to `--max-vram <GB>`, clamped to `[1, advertised]`. Tiers recomputed on GPU change. |
| Model selection | No recommender. Panel calls `mesh-llm gpus --json` + `mesh-llm models recommended|installed|search --json` and renders upstream fit-ranked results. Hosting set is persisted as a model allow-list and passed as repeated `--gguf`/`--model`/config intents. |
| Idle behavior | Use upstream `[runtime.activity]` host-activity policy (`pause_remote`, `idle_after_secs`, `resume_debounce_secs`, `advertisement = coarse_state`). Do **not** reimplement Hyprland idle detection. Lock/suspend handled by graceful-leave hook (below). |
| Agent endpoint | Expose stock `http://127.0.0.1:9337/v1`, wire model **`auto`**. No reverse proxy, no API key in v1 (loopback only, `--port 9337` without `--listen-all`). Agent launches delegate to `mesh-llm opencode|claude|pi`, never by editing agent configs ourselves. |
| Version pinning | `PINNED_MESH_VERSION = "0.78.x"`; accept same minor, warn on drift, block start only when `/api/status` contract probe fails. Probe is cached per binary hash. |
| Install | Detect `mesh-llm` on `PATH`; installer is an explicit button with three choices: Arch package asset from `mesh-packaging` (`pacman -U`, user-confirmed), official `install.sh`, or AUR. Never automatic on plugin add/enable. |
| Stats | v1 shows only contract-verified fields; unknown stats render `—` with a tooltip, never an estimate. |

---

## 2. Repository layout

```
manifest.json
BarWidget.qml            # bar icon + state, loads Panel.qml
Panel.qml                # native QML panel
Service.qml              # singleton: process + polling + persistence
lib/
  MeshApi.js             # endpoint constants, fetch helpers, response validation
  State.js               # pure state machine + formatters
  Settings.js            # read/write plugin entry settings
bin/
  mesh-node              # POSIX sh launcher: env, pidfile, exec
  mesh-preflight         # version, port, GPU, binary checks (JSON out)
assets/                  # icon(s) from branding
README.md
AGENTS.md
IMPLEMENTATION_PLAN.md
```

`manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "ewweberlin.omacelium",
  "name": "Omacelium",
  "version": "0.1.0",
  "author": "",
  "license": "MIT",
  "description": "Bloom your GPU into the mesh.",
  "kinds": ["service", "bar-widget"],
  "keepLoaded": true,
  "entryPoints": { "service": "Service.qml", "barWidget": "BarWidget.qml" },
  "barWidget": {
    "displayName": "Omacelium",
    "description": "Mesh node status and contribution controls",
    "category": "AI",
    "allowMultiple": false,
    "defaultSection": "right",
    "defaults": {
      "enabled": false,
      "contributionPct": 50,
      "hostedModels": [],
      "meshMode": "public",
      "agentEndpoint": true,
      "pauseOnActivity": true
    },
    "schema": [
      { "key": "enabled", "type": "boolean", "label": "Join the mesh", "defaultValue": false },
      { "key": "contributionPct", "type": "integer", "label": "Contributed GPU memory (%)", "min": 10, "max": 100, "step": 10, "defaultValue": 50 },
      { "key": "meshMode", "type": "enum", "label": "Mesh", "options": ["public", "private"], "defaultValue": "public" },
      { "key": "agentEndpoint", "type": "boolean", "label": "Offer local agent endpoint", "defaultValue": true },
      { "key": "pauseOnActivity", "type": "boolean", "label": "Pause while this machine is in use", "defaultValue": true }
    ]
  }
}
```

Non-schema state (invite token, allow-list, last pid, install choice) goes in
`~/.local/state/omarchy/<plugin-id>/state.json` (mode 0600), not `shell.json`.
Secrets: invite tokens are secrets; never log them, never place them in
`shell.json` if that file is dotfile-synced without encryption — warn in README.

---

## 3. Service state machine

`Service.qml` owns one child process and one poll loop.

States: `absent` → `installing` → `stopped` → `starting` → `joined` / `contributing` / `idle` / `degraded` → `stopping` → `stopped`; plus `error`.

Mapping from `/api/status.runtime.daemon_state` (documented values):

| daemon_state | Bar state |
|---|---|
| `starting` | starting |
| `ready_serving` + `local_serving` | contributing |
| `ready_proxying` / `ready_idle` | joined |
| `ready_*` + activity admission paused | idle |
| `degraded` | degraded |
| `stopping` | stopping |
| absent/unreachable | offline |

Capability booleans (`worker_capable`, `local_serving`, `proxying`, `plugin_ingress`, `accepting_local`, `accepting_remote`) drive the panel, not invented states.

Process rules:

1. **Spawn**: `bin/mesh-node start` with env `MESH_LLM_MAX_VRAM`, `MESH_LLM_MODELS`, `MESH_LLM_MODE`, `MESH_LLM_STATE_DIR`. Script resolves binary, writes `node.pid` + `node.cmd`, `exec`s `mesh-llm serve … --console 3131 --port 9337`.
2. **Adoption**: on shell restart, if `node.pid` alive and `/proc/<pid>/cmdline` matches the recorded fingerprint, attach instead of spawning (mesh node survives shell restart).
3. **Orphan reaping**: if pid alive but fingerprint mismatches or the plugin is disabled, do not kill blindly; surface "another mesh-llm is using the ports" with actions `Use it` / `Stop it` (latter confirms, then `SIGTERM`, wait 10 s, `SIGKILL`).
4. **Crash restart**: exit code ≠ 0 → backoff 2 s, 5 s, 15 s, 60 s, then stay `degraded` with `Restart` action. Stop after 4 attempts.
5. **Graceful leave**: SIGTERM, wait `drain_timeout_secs` (default 30) + 5 s, then SIGKILL. Wire to shell quit/shutdown if the host exposes a hook; otherwise document `omarchy-restart-shell` behavior and rely on adoption next start.
6. **Port probe before start**: bind-test 9337 and 3131 on 127.0.0.1. Occupied + `/api/status` responds → offer adopt; occupied + foreign → block with a clear message; never silently pick another port (agents need the stable endpoint).
7. **Uninstall/disable**: stop child; keep `~/.mesh-llm` (identity/config) and downloaded models unless the user explicitly purges.

Polling: `/api/status` every 3 s when panel open, 10 s when only bar visible, 30 s when idle; backoff to 60 s after 3 failures. Use Quickshell `Process` + `StdioCollector` or `XMLHttpRequest` through a helper process (`curl` is present in the Omarchy base). Prefer spawning `curl -fsS --max-time 2` to avoid QML fetch quirks and to keep the code testable from the shell.

---

## 4. Management API contract

| UI need | Source | Notes |
|---|---|---|
| Reachability | `GET :3131/api/status` | 2 s timeout; HTML/parse error = foreign service |
| Daemon state + caps | `/api/status.runtime` | `daemon_state`, `worker_capable`, `local_serving`, `proxying`, `accepting_local/remote` |
| Guardrail mode | `/api/status.runtime.openai_guardrails` | confirmed in CLI docs |
| Activity state | `GET /api/runtime/activity` | policy + current admission |
| Manual pause/resume | `PUT/DELETE /api/runtime/activity/override` | session-only upstream; panel shows it as temporary |
| Models available in mesh | `GET :9337/v1/models` | `.data[].id`; includes local + peer models |
| Local runtime/model/process | `/api/runtime`, `/api/runtime/processes` | per-process detail for hosted model cards |
| Load/unload | `POST/DELETE /api/runtime/models` | panel may use CLI passthrough instead for allow-list changes |
| Peers / contribution stats | `/api/status` (fields to capture) | **Gate G3**: record one real JSON response on Omarchy and pin field names before UI binds; if absent, ship without peer counts |

Field names not confirmed by docs are treated as optional and rendered behind a
presence check. No stdout parsing for UI state; CLI is used only for actions and
for JSON subcommands explicitly documented as machine-readable.

---

## 5. Panel design (QML)

One icon, one panel, four zones:

1. **Header** — state chip, mesh name, peer count (if field exists), uptime.
2. **Control** — join toggle, contribution slider (10–100%, step 10, shows computed GB from `advertised_memory`), mode selector (public / private invite), "Pause while I'm using this machine".
3. **Models** — hosted model list with size, fit badge from upstream (`fits` / `tight` / `does not fit`), toggle per model, "Browse models" pushes a subview listing `models recommended --json`; "Download" calls `mesh-llm models download <id>` with a progress row; all commands run with `--json` and are parsed as JSON only.
4. **Agents** — endpoint row (`http://127.0.0.1:9337/v1`, model `auto`, copy button), buttons "Open OpenCode / Claude / Pi on mesh" (delegates to `mesh-llm <agent>`), and an explainer that only sessions launched this way use the mesh.

Panel states that must be designed, not improvised: no binary, no GPU / unsupported GPU, downloading model, starting, no peers, private invite invalid/expired, endpoint port conflict, mesh unreachable but local model serving, version mismatch, disabled by user, degraded with restart.

Accessibility/behavior: keyboard focus order, Escape closes, click-outside closes, no tooltip-only information, vertical-bar variant, and `opened/open()/close()` on the widget root.

---

## 6. Trust, abuse, and licensing

Prompt confidentiality is scoped separately in `SECURITY.md`. Bottom line:
a serving node necessarily sees the prompts it serves, so "no other node sees my
prompts" is satisfiable only by local-only or a trusted-owners private mesh
(default), never by a community mesh. Community mode is opt-in with an explicit
consent screen; split serving is off in private mode.

- Consent screen before first join: served peers receive prompts and model activations over encrypted transport; the host can see prompts it serves; free-riding and unknown peers are possible; leave at any time.
- Abuse controls available in v1: `--mesh-guardrails enforce`, per-model load cap via slider, allow-list, activity pause, one-click leave, and a log of remote-request denials if upstream exposes counters. No custom rate limiter in v1.
- Free-riding: accepted for v1 (no gating is locked). Metrics-only monitoring later; do not build a reputation system without upstream support.
- Takedown: remove the model from the allow-list and delete the local copy via `mesh-llm models delete`; no remote kill switch exists, document that honestly.
- Model licenses: model card link shown in the picker; user confirms "I will host this model under its license" once per model. Plugin is MIT; upstream Apache-2.0; neither covers weights.
- Identity: `~/.mesh-llm` is the node identity. Panel offers "Back up identity" (copy the directory to a user-chosen path) and warns that deleting it changes the node ID.

---

## 7. Build milestones

**M0 — Omarchy contract spike (half day, on Omarchy)**
Create `ewweberlin.omacelium` with a stub service + widget. Verify: service loads when only the widget is in the bar; `bar.shell.serviceFor(own id)` returns the singleton; settings round-trip via `omarchy bar plugin set`; `omarchy plugin validate` and `qmllint` pass.
Exit: written note with exact facade behavior and one captured `/api/status` JSON.

**M1 — Supervisor + bar state**
`bin/mesh-node`, preflight, pidfile/adoption, port conflict, backoff, bar icon states. No panel interaction yet.
Acceptance: kill -9 the child → restarts with backoff; `omarchy-restart-shell` → adopt, no duplicate process; foreign process on 9337 → clear error, no spawn.

**M2 — Panel controls**
Join toggle, slider → `--max-vram`, activity pause, private invite (token field, 0600 state), endpoint row. All settings persist across restart.
Acceptance: slider 30% on a reported 12 GB budget passes `--max-vram ~3.6`; invite token never appears in logs/state exports; pause override reflected within one poll.

**M3 — Model management**
Upstream-driven catalog, fit badges, download progress, allow-list, unload.
Acceptance: on a machine where `--auto` would pick a tiny decision model, explicit allow-list models are what load; a non-fitting model is blocked with upstream's reason.

**M4 — Agent endpoint + install flow**
Install chooser (Arch asset / install.sh / AUR), version check, endpoint copy, launch-agent actions, offline/fallback UX.
Acceptance: with mesh down, panel says so and agents launched via the panel fail with a readable error, not a hang.

**M5 — Hardening + docs**
Idle/lock/suspend leave, log redaction, README (install, privacy, uninstall, ports, firewall), plugin icon from branding, packaging check on a clean Omarchy VM.

---

## 8. Test plan

- **Unit-testable JS**: state mapping, fit-tier math, settings merge, error classification (`lib/*.js`), run with `node --test` in CI without QML.
- **Shell tests on Omarchy**: `shellcheck bin/*`, `qmllint`, `omarchy plugin validate`.
- **Integration matrix**: cold start, adopt after shell restart, port conflict, invalid invite, no GPU, CPU-only, two models one too large, suspend/resume, leave during active request, version mismatch.
- **Privacy check**: grep state/logs after a session containing an invite token and prompts; assert zero matches.

---

## 9. Remaining risks

| Risk | Mitigation |
|---|---|
| Third-party service facade differs on older Omarchy | M0 spike is a hard gate; runtime fallback to widget-owned supervision |
| `/api/status` fields change between 0.78.x patches | Contract probe + presence checks; pin minor, not patch |
| Activity pause semantics surprise users ("why is my node idle?") | Panel shows admission reason and a temporary override |
| Public mesh abuse/no gating | Consent, guardrails, allow-list, leave; document residual risk |
| Model downloads fill the disk | Show `models installed` sizes and free space; confirm before each download > 1 GB |
| Invite token leakage via synced config | Token in 0600 state file, not `shell.json`; README warning |

---

## 10. Branding (delivered by Marketina)

Name: **Omacelium**. Id slug: `ewweberlin.omacelium`.
Tagline: "Bloom your GPU into the mesh."
Alternates: "Spore up, share inference." / "One hypha at a time, whole capacity."

Theme: mycelium/hyphal. Optional toggle flavor pair `Fruiting` / `Dormant` was proposed and **declined by the user**; the spec keeps "Mesh on" / "Mesh off".

Panel microcopy (verbatim):

| Element | String |
|---|---|
| Toggle | `Join mesh`; on `/ off` states `Mesh on`, `Mesh off` |
| Slider | `Contributed load` (%) |
| Endpoint switch | `Local endpoint` |
| joined | `Joined mesh` |
| contributing | `Serving peers` |
| idle | `Standing by` |
| offline | `Offline` |
| no peers | `No peers found` |
| unreachable | `Mesh unreachable` |

Assets in `assets/`: **`hyphal-node.svg` (current mark)**, `hyphal-node-mono.svg` (16 px bar glyph, `currentColor`, tinted with `barForeground`), plus the superseded `node-knot.svg` / `thread-plane.svg` / `node-knot-mono.svg` kept for provenance. Palette: loam bark `#241E2E` badge, pale beige `#E7DCC8` hyphae, amber `#F2A33C` spores and center node. Source notes in `BRANDING.md` and `branding/branding-mycelium.md`.
