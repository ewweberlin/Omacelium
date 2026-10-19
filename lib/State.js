// Pure state mapping and policy math for the Omacelium node. Everything here
// is side-effect free; run it with node --test (tests/ dir).

.pragma library

// Bar/panel states the service maps onto. The process states (absent…stopped)
// appear in M1; M0 only probes the management API, so the states that can
// actually show up today are offline / starting / joined / contributing /
// idle / degraded / stopping.
var UI_STATES = [
    "absent", "installing", "stopped", "starting",
    "joined", "contributing", "idle", "degraded",
    "stopping", "offline", "error"
]

// IMPLEMENTATION_PLAN.md §3: /api/status.runtime.daemon_state -> bar state.
// Unknown values fall back to "degraded" in the UI only when a node answers
// and we cannot read its state; reachability failures win first, even over a
// cached status JSON - the bar shows the world, not the last good snapshot.
function uiState(statusJson, reachable) {
    if (reachable !== true)
        return { state: "offline", reason: "unreachable" }
    if (statusJson === null || statusJson === undefined)
        return { state: "offline", reason: "dead" }

    var runtime = null
    if (statusJson && typeof statusJson === "object" && !Array.isArray(statusJson))
        runtime = statusJson.runtime
    if (!runtime || typeof runtime !== "object")
        return { state: "degraded", reason: "no-runtime" }

    var daemon = typeof runtime.daemon_state === "string" ? runtime.daemon_state : ""

    if (daemon === "starting") return { state: "starting", reason: daemon }
    if (daemon === "stopping") return { state: "stopping", reason: daemon }
    if (daemon === "degraded") return { state: "degraded", reason: daemon }
    if (daemon === "error") return { state: "error", reason: daemon }

    if (daemon.indexOf("ready_") === 0) {
        // Activity admission paused wins over whatever else is advertised:
        // that is the "Standing by" the user asked for.
        var paused = runtime.activity_paused === true
            || (runtime.activity && typeof runtime.activity === "object"
                && runtime.activity.paused === true)
        if (paused) return { state: "idle", reason: "activity-paused" }

        if (runtime.local_serving === true)
            return { state: "contributing", reason: "local-serving" }
        if (runtime.proxying === true)
            return { state: "joined", reason: "proxying" }
        return { state: "joined", reason: daemon }
    }

    return { state: "degraded", reason: "unknown-daemon-state" }
}

// Polling cadence from IMPLEMENTATION_PLAN.md §3: 3 s with the panel open,
// 10 s when only the bar is visible, 30 s at rest, and back off to 60 s after
// three consecutive failures.
var POLL_INTERVALS_MS = { panel: 3000, bar: 10000, idle: 30000, backoff: 60000 }

function pollIntervalMs(mode, consecutiveFailures) {
    var base = POLL_INTERVALS_MS[mode] || POLL_INTERVALS_MS.idle
    if (mode !== "panel" && (consecutiveFailures || 0) >= 3)
        return POLL_INTERVALS_MS.backoff
    return base
}

// Slider -> --max-vram. Percent of upstream-reported advertised memory,
// clamped to at least 1 GB and at most the advertised budget. advertisedBytes
// is a byte count; the CLI takes GB.
function maxVramGb(contributionPct, advertisedBytes) {
    var pct = Number(contributionPct)
    var bytes = Number(advertisedBytes)
    if (!isFinite(pct) || !isFinite(bytes) || bytes <= 0) return 0
    var gb = (pct / 100) * (bytes / (1024 * 1024 * 1024))
    if (!isFinite(gb)) return 0
    gb = Math.max(1, Math.min(gb, bytes / (1024 * 1024 * 1024)))
    return Math.round(gb * 10) / 10
}

// Version pinning: accept the pinned minor (0.78.x), warn on any other drift.
function versionWithinPinned(have, pinnedPrefix) {
    var want = String(pinnedPrefix || "").trim()
    var value = String(have || "").trim()
    if (!want || !value) return { ok: false, warn: false, reason: "missing" }
    // Tolerate a leading "v".
    if (value.charAt(0) === "v") value = value.slice(1)
    if (want.charAt(0) === "v") want = want.slice(1)
    if (value === want) return { ok: true, warn: false, reason: "exact" }
    var wantParts = want.split(".")
    var haveParts = value.split(".")
    if (wantParts.length >= 2 && haveParts.length >= 2
        && wantParts[0] === haveParts[0] && wantParts[1] === haveParts[1])
        return { ok: true, warn: false, reason: "same-minor" }
    if (wantParts[0] === haveParts[0])
        return { ok: true, warn: true, reason: "same-major" }
    return { ok: false, warn: false, reason: "different-major" }
}

function formatGb(gb) {
    var value = Number(gb)
    if (!isFinite(value)) return "—"
    if (value >= 10) return Math.round(value) + " GB"
    return (Math.round(value * 10) / 10) + " GB"
}

// Verbatim panel microcopy from IMPLEMENTATION_PLAN.md §10 / BRANDING.md.
// tooltip- and panel-facing; the bar keeps its own compact labels via
// compactLabel below.
var STATE_LABELS = {
    joined: "Joined mesh",
    contributing: "Serving peers",
    idle: "Standing by",
    degraded: "Degraded",
    starting: "Starting node",
    stopping: "Leaving mesh",
    stopping_error: "Mesh error",
    absent: "Mesh LLM not found",
    installing: "Installing mesh node",
    stopped: "Mesh off",
    offline: "Offline",
    error: "Mesh error"
}

function stateLabel(uiState) {
    var key = String(uiState || "offline")
    if (Object.prototype.hasOwnProperty.call(STATE_LABELS, key))
        return STATE_LABELS[key]
    return STATE_LABELS.offline
}

// One-word-ish bar label, shown next to the mark. Empty for offline so the
// bar slot stays a plain icon until there is anything to say.
var COMPACT_LABELS = {
    joined: "mesh on",
    contributing: "serving",
    idle: "standing by",
    starting: "starting",
    stopping: "leaving",
    degraded: "degraded",
    error: "error"
}

function compactLabel(uiState) {
    var key = String(uiState || "")
    if (Object.prototype.hasOwnProperty.call(COMPACT_LABELS, key))
        return COMPACT_LABELS[key]
    return ""
}
