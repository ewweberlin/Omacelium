// Mesh-LLM management-API bindings. Question-first: every function is pure and
// testable with `node --test`; nothing here touches QML or the shell.
//
// Ports come from Mesh-LLM's own docs and were confirmed on 0.78.x: the
// console/management API listens on 3131 and the OpenAI-compatible endpoint on
// 9337. Field names used below are only the ones the milestone captured on a
// live node first (IMPLEMENTATION_PLAN.md §4); unknown fields are read behind
// presence checks in the UI, never assumed.

.pragma library

var CONSOLE_PORT = 3131
var API_PORT = 9337

var CONSOLE_BASE = "http://127.0.0.1:" + CONSOLE_PORT
var API_BASE = "http://127.0.0.1:" + API_PORT

var ENDPOINTS = {
    status: CONSOLE_BASE + "/api/status",
    runtime: CONSOLE_BASE + "/api/runtime",
    runtimeProcesses: CONSOLE_BASE + "/api/runtime/processes",
    runtimeActivity: CONSOLE_BASE + "/api/runtime/activity",
    runtimeActivityOverride: CONSOLE_BASE + "/api/runtime/activity/override",
    runtimeIntents: CONSOLE_BASE + "/api/runtime/intents",
    runtimeModels: CONSOLE_BASE + "/api/runtime/models",
    meshGuardrails: CONSOLE_BASE + "/api/status.runtime.mesh_guardrails",
    v1Models: API_BASE + "/v1/models"
}

// `curl` is in the Omarchy base install; spawning it beats fighting QML fetch
// quirks and keeps every probe reproducible from a terminal.
function curlArgs(url, timeoutSecs) {
    var timeout = 2
    if (typeof timeoutSecs === "number" && timeoutSecs > 0)
        timeout = Math.max(1, Math.round(timeoutSecs))
    return ["curl", "-fsS", "--max-time", String(timeout), String(url)]
}

function isHtmlish(text) {
    var head = String(text || "").slice(0, 512).toLowerCase()
    return head.indexOf("<!doctype") !== -1
        || head.indexOf("<html") !== -1
        || head.indexOf("<head") !== -1
        || head.indexOf("<body") !== -1
}

// Parse a probe result into { ok, status, foreign, error }.
//   ok       true when /api/status returned a JSON object
//   status   the parsed JSON object (may be non-contract-shaped; that is fine -
//            M0's job is to capture reality, not to enforce it early)
//   foreign  true when the port answered with something that is not our node
function parseProbe(text) {
    var out = { ok: false, status: null, foreign: false, error: "" }
    var body = String(text == null ? "" : text).trim()
    if (!body) {
        out.error = "empty"
        return out
    }
    if (isHtmlish(body)) {
        out.foreign = true
        out.error = "foreign"
        return out
    }
    try {
        var parsed = JSON.parse(body)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            out.error = "shape"
            return out
        }
        out.ok = true
        out.status = parsed
        return out
    } catch (e) {
        out.error = "parse"
        return out
    }
}

// Classify a failed probe. curl exit codes cover what we care about:
//   7  connection refused, 28 timeout, 22 HTTP error via -f,
//   6  resolve failure (never on loopback, but cheap to name)
function classifyProbeFailure(exitCode) {
    switch (exitCode) {
    case 0:
        return "none"
    case 7:
        return "refused"
    case 28:
        return "timeout"
    case 6:
        return "resolve"
    case 22:
        return "foreign"
    default:
        return "unreachable"
    }
}

// Pull the runtime sub-object out of a raw status payload without assuming
// anything upstream did not document. Returns { runtime, capabilities } where
// capabilities are booleans that may legitimately be missing.
function readRuntime(status) {
    var runtime = status && typeof status === "object" && !Array.isArray(status)
        ? status.runtime : null
    runtime = runtime && typeof runtime === "object" && !Array.isArray(runtime)
        ? runtime : null
    return {
        runtime: runtime,
        daemonState: runtime && typeof runtime.daemon_state === "string"
            ? runtime.daemon_state : "",
        capabilities: {
            workerCapable: runtime ? runtime.worker_capable === true : false,
            localServing: runtime ? runtime.local_serving === true : false,
            proxying: runtime ? runtime.proxying === true : false,
            pluginIngress: runtime ? runtime.plugin_ingress === true : false,
            acceptingLocal: runtime ? runtime.accepting_local === true : false,
            acceptingRemote: runtime ? runtime.accepting_remote === true : false
        }
    }
}
