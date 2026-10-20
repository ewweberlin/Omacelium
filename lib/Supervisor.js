// Supervisor policy for the Omacelium node service. Pure + node-testable.
// Process rules are IMPLEMENTATION_PLAN.md §3; the launcher contract lives in
// bin/mesh-node (pidfile + fingerprint + detached grandchild), so crash
// detection is poll-driven (Quickshell cannot watch a detached process).

.pragma library

// Crash-restart backoff (plan §3 rule 4): 2 s, 5 s, 15 s, 60 s, then stay
// degraded with a manual restart. Attempt counts start at 1 after the first
// observed death.
var BACKOFF_SECS = [2, 5, 15, 60]
var MAX_CRASH_ATTEMPTS = 4

// Next auto respawn delay after `crashesSeen` observed deaths, or null when
// the policy says "stop; a human restarts".
function respawnDelaySecs(crashesSeen) {
    var count = Number(crashesSeen) || 0
    if (count < 1) return 0
    if (count <= MAX_CRASH_ATTEMPTS) return BACKOFF_SECS[count - 1]
    return null
}

// Map one preflight result (JSON object from bin/mesh-preflight) to the next
// supervisor decision. Never trusts a version the binary cannot prove; ports
// are classified by binding, ours-vs-foreign by the management API.
function preflightDecision(pf) {
    if (!pf || typeof pf !== "object") return { action: "retry", reason: "no-preflight" }
    if (!pf.binary) return { action: "block-absent", reason: "no-binary" }
    var pin = pf.pin || {}
    if (pin.ok !== true || pin.reason === "different-major")
        return { action: "block-version", reason: pin.reason || "version" }

    var ports = pf.ports || {}
    var consolePort = ports.console || ""
    var apiPort = ports.api || ""

    if (consolePort === "free" && apiPort === "free") return { action: "spawn", reason: "ports-free" }

    // Our node on the wire but no usable pidfile: started outside the plugin
    // (rule 3 "another mesh-llm is using the ports" — never kill blindly).
    if (consolePort === "ours" || apiPort === "ours")
        return { action: "surface-unmanaged", reason: "ports-ours" }
    if (consolePort === "foreign" || apiPort === "foreign")
        return { action: "surface-foreign", reason: "ports-foreign" }
    return { action: "retry", reason: "ports:" + consolePort + "/" + apiPort }
}

// Human-readable collision strings (verbatim style per branding §10).
function reasonText(reason) {
    switch (reason) {
    case "no-binary":
        return "mesh-llm not found"
    case "different-major":
        return "mesh-llm version outside the pinned family"
    case "ports-foreign":
        return "Ports 3131/9337 taken by another service"
    case "ports-ours":
        return "mesh-llm is already running (started outside the plugin)"
    case "no-preflight":
        return "preflight did not answer"
    case "spawned":
        return ""
    default:
        return ""
    }
}

// Launcher stop/exit events → supervisor transition. "occupied" refuses to
// touch a foreign owner; service keeps state until the user decides (M2).
function stopResultToState(event) {
    switch (event) {
    case "stopped":
    case "not-running":
    case "was-dead":
    case "killed":
    case "forced-stop":
        return "detached"
    case "occupied":
        return "occupied"
    case "busy":
        return "busy"
    default:
        return "unknown"
    }
}

// Should the service treat a failed /api/status probe as a node crash? Only
// when the node is supposed to be up and the launcher also reports it gone.
function isCrashEligible(wishEnabled, supState) {
    return wishEnabled === true
        && (supState === "attached" || supState === "starting")
}
