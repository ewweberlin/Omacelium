const test = require("node:test")
const assert = require("node:assert/strict")
const { loadModule } = require("./load-lib.js")

const State = loadModule("State.js")

test("uiState maps documented daemon_state values", () => {
    const runtime = (extra) => ({ runtime: Object.assign({}, extra) })

    assert.deepEqual(State.uiState(runtime({ daemon_state: "starting" }), true),
        { state: "starting", reason: "starting" })
    assert.deepEqual(State.uiState(runtime({ daemon_state: "stopping" }), true),
        { state: "stopping", reason: "stopping" })
    assert.deepEqual(State.uiState(runtime({ daemon_state: "degraded" }), true),
        { state: "degraded", reason: "degraded" })
    assert.deepEqual(State.uiState(runtime({ daemon_state: "error" }), true),
        { state: "error", reason: "error" })
})

test("uiState: ready_ + local_serving -> contributing; proxying -> joined", () => {
    const build = (daemon, extra) => ({ state: null, reason: null,
        mapped: State.uiState({ runtime: Object.assign({
            daemon_state: daemon }, extra) }, true) })

    const serving = build("ready_serving", { local_serving: true })
    assert.equal(serving.mapped.state, "contributing")
    assert.equal(serving.mapped.reason, "local-serving")

    const proxying = build("ready_proxying", { proxying: true })
    assert.equal(proxying.mapped.state, "joined")

    const readyIdle = build("ready_idle", {})
    assert.equal(readyIdle.mapped.state, "joined")
    assert.equal(readyIdle.mapped.reason, "ready_idle")
})

test("uiState: activity admission paused wins over flags -> idle", () => {
    const mapped = State.uiState({
        runtime: { daemon_state: "ready_serving", local_serving: true,
            activity_paused: true }
    }, true)
    assert.equal(mapped.state, "idle")
    assert.equal(mapped.reason, "activity-paused")
})

test("uiState handles unreachable / dead / malformed shapes", () => {
    assert.deepEqual(State.uiState(null, false), { state: "offline", reason: "unreachable" })
    assert.deepEqual(State.uiState(null, true), { state: "offline", reason: "dead" })
    assert.deepEqual(State.uiState({}, true), { state: "degraded", reason: "no-runtime" })
    assert.deepEqual(State.uiState({ runtime: 42 }, true),
        { state: "degraded", reason: "no-runtime" })
    assert.deepEqual(
        State.uiState({ runtime: { daemon_state: "mystery_state" } }, true),
        { state: "degraded", reason: "unknown-daemon-state" })
    // Reachability failure wins even with stale state around.
    assert.deepEqual(
        State.uiState({ runtime: { daemon_state: "ready_idle" } }, false),
        { state: "offline", reason: "unreachable" })
})

test("poll intervals match the plan and back off after failures", () => {
    assert.equal(State.pollIntervalMs("panel", 0), 3000)
    assert.equal(State.pollIntervalMs("bar", 0), 10000)
    assert.equal(State.pollIntervalMs("idle", 0), 30000)
    assert.equal(State.pollIntervalMs("panel", 3), 3000)
    assert.equal(State.pollIntervalMs("bar", 2), 10000)
    assert.equal(State.pollIntervalMs("bar", 3), 60000)
    assert.equal(State.pollIntervalMs("idle", 4), 60000)
})

test("maxVram maps percent of advertised bytes, clamps to [1, advertised]", () => {
    const GIB = 1024 * 1024 * 1024
    assert.equal(State.maxVramGb(50, 12 * GIB), 6.0)
    assert.equal(State.maxVramGb(30, 12 * GIB), 3.6)
    assert.equal(State.maxVramGb(10, 12 * GIB), 1.2)
    // 8 GiB budget at 10% = 0.8 -> clamped to the 1 GB floor.
    assert.equal(State.maxVramGb(10, 8 * GIB), 1)
    // 100% of 8 GiB never exceeds the advertised budget.
    assert.equal(State.maxVramGb(100, 8 * GIB), 8)
    // Degenerate inputs return 0 (no advertised memory -> no boolean VM).
    assert.equal(State.maxVramGb(50, 0), 0)
    assert.equal(State.maxVramGb(50, undefined), 0)
    assert.equal(State.maxVramGb(undefined, 8 * GIB), 0)
})

test("pinned version accepts same major+minor (0.78.x), warns same major", () => {
    assert.deepEqual(State.versionWithinPinned("0.78.1", "0.78"),
        { ok: true, warn: false, reason: "same-minor" })
    assert.deepEqual(State.versionWithinPinned("0.79.2", "0.78"),
        { ok: true, warn: true, reason: "same-major" })
    const reject = State.versionWithinPinned("1.0.0", "0.78")
    assert.deepEqual(reject, { ok: false, warn: false, reason: "different-major" })
    assert.equal(State.versionWithinPinned("", "0.78").ok, false)
    assert.equal(State.versionWithinPinned(undefined, "0.78").ok, false)
    assert.equal(State.versionWithinPinned(null, null).ok, false)
})

test("labels follow the verbatim microcopy table", () => {
    assert.equal(State.stateLabel("contributing"), "Serving peers")
    assert.equal(State.stateLabel("joined"), "Joined mesh")
    assert.equal(State.stateLabel("idle"), "Standing by")
    assert.equal(State.stateLabel("offline"), "Offline")
    assert.equal(State.stateLabel("nonsense"), "Offline")
    assert.equal(State.compactLabel("contributing"), "serving")
    assert.equal(State.compactLabel("offline"), "")
})
