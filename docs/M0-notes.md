# M0 — spike notes (contract + facade behavior)

Status: 2026-10-20, verified on this Omarchy machine against omarchy-shell
`quattro`-era source (`/usr/share/omarchy/shell`), plugin live-loaded and
exercised in the running bar. The /api/status capture is still open — it needs
mesh-llm installed (plan §7 makes that a user-confirmed step).

## What shipped in M0

- `manifest.json` — kinds `service` + `bar-widget`, `keepLoaded: true`,
  inline settings schema under `barWidget` (defaults: join off, 50%,
  public mesh, local endpoint on, pause-on-activity on).
- `Service.qml` — management-API probe loop (curl, port 3131), state mapping,
  capture hook, settings facade (`mergedSettings` / `applySetting`).
- `BarWidget.qml` — bar mark (Canvas-drawn hyphal mark; see below), compact
  state label, click-to-open panel.
- `OmaceliumPanel.qml` — KeyboardPanel popout: state chip, Join mesh / Local
  endpoint toggles, contributed-load slider, hostest-models + agent-endpoint
  placeholders (honest M-gated captions, no invented data).
- `lib/MeshApi.js`, `lib/State.js`, `lib/Settings.js` — pure, `node --test`
  covered (16 tests, all passing; runner in `tests/load-lib.js`).
- `bin/omacelium-node` — POSIX sh helper, `capture api-status|v1-models` and
  `check-live`, state under `~/.local/state/omarchy/ewweberlin.omacelium`
  (0700/0600).

## Facade behavior (verified from shell source and live)

1. **Service mounting.** `ShellRoot.ensureService(id)` requires the manifest to
   declare `kinds: ["service"]` and `entryPoints.service`; it creates the entry
   point with `Qt.createComponent(url, PreferSynchronous)` and injects `shell`
   (scoped `PluginShellApi`), `manifest` (public view), `barWidgetRegistry`,
   `pluginRegistry` and `omarchyPath` right after `createObject` — so
   `Component.onCompleted` cannot see them yet (our ready log fires early; the
   `onShellChanged` log records the real wiring).
2. **Widget-facing shell.** The trusted first-party bar gives a registered
   third-party widget a `PluginBarApi` whose `.shell` is
   `pluginShellForId(moduleName)`. For a non-first-party manifest that resolves
   to the full scoped facade with `allowOwnService = true`, so
   `bar.shell.serviceFor("<own id>")` returns the live service instance. This
   is the documented pattern for service+bar-widget plugins and it works live.
3. **Settings.** There is one settings object per bar entry (or `plugins[]`
   entry for service-only installs). The widget receives it via `settings`
   from the bar slot; the service reads manifest `barWidget` defaults/schema.
   `shell.updateEntryInline(id, settings)` **replaces the whole settings
   object** — callers must merge before writing. `Service.applySetting` runs
   integer keys through the schema clamp (min/max/step) and writes the full
   merged object. Live-verified both directions:
   `omarchy bar set … contributionPct 70` → panel showed 70% instantly, and a
   panel toggle click → shell.json carried `enabled:false` **plus** all
   manifest defaults merged in.
4. **Panel popout.** `OmaceliumPanel.qml` extends `qs.Ui.Panel` and hosts a
   `KeyboardPanel` anchored to the bar button (`dev.git` pattern). It is a
   child of the widget instance (one per monitor), `manageIpc: false` for now,
   IPC registration is deferred to M2.

## Naming/loading gotchas worth remembering

- A plugin file named `Panel.qml` collides with the shell module type
  `qs.Ui.Panel` at instantiation (`Cannot assign to non-existent property`)
  — the panel file is named `OmaceliumPanel.qml` instead.
- Qt's SVG renderer cannot tint `currentColor` from the brand `*-mono.svg`;
  the bar mark is drawn with Canvas from the same geometry instead.
- `omarchy plugin validate <repo path>` passes (exit 0); it refuses the
  symlinked install folder by design. Install is
  `ln -sfn ~/Projects/Omacelium ~/.config/omarchy/plugins/ewweberlin.omacelium`
  + `omarchy-shell shell rescanPlugins` + restart of the shell once
  (`omarchy restart shell`) because the scanner will not pick up a new
  symlink by hot-reload alone.
- `quickshell.qmlscanner` logs "Module path … outside of the config folder"
  for every symlinked plugin dir (`dev.git`, quickswitch included) — benign.

## Verified acceptance gates

| Gate | Result |
| --- | --- |
| `omarchy plugin validate` (repo path) | pass, exit 0 |
| Service loads, registering/log line | `[omacelium] service ready as ewweberlin.omacelium` |
| Scoped shell service-capable | `onShellChanged` log: `service-capable` |
| `serviceFor(own id)` from the widget | live: panel state + clearthrough toggle |
| Settings round-trip (CLI → UI) | live: 50% → 70% + Mesh on reflected instantly |
| Settings round-trip (UI → shell.json) | live: full merged object written |
| `node --test` | 16/16 pass |
| Bar + panel render, correct state | live (desktop screenshots) |
| `/api/status` capture | **open — needs mesh-llm installed** |

## Deliberately deferred to capture first

The control labels stay honest until a real /api/status JSON exists
(plan §4 "capture before modeling"): `--max-vram` mapping text, hosted model
list, peer counts, agent endpoint liveness. None of the M0 UI invents values.
