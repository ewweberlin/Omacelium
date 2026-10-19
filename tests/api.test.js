const test = require("node:test")
const assert = require("node:assert/strict")
const { loadModule } = require("./load-lib.js")

const MeshApi = loadModule("MeshApi.js")
const Settings = loadModule("Settings.js")

test("endpoints pin the verified ports", () => {
    assert.equal(MeshApi.CONSOLE_PORT, 3131)
    assert.equal(MeshApi.API_PORT, 9337)
    assert.equal(MeshApi.ENDPOINTS.status, "http://127.0.0.1:3131/api/status")
    assert.equal(MeshApi.ENDPOINTS.v1Models, "http://127.0.0.1:9337/v1/models")
    assert.equal(MeshApi.ENDPOINTS.runtimeActivityOverride,
        "http://127.0.0.1:3131/api/runtime/activity/override")
})

test("curlArgs builds a loopback probe with a bounded timeout", () => {
    assert.deepEqual(MeshApi.curlArgs("http://127.0.0.1:3131/api/status"),
        ["curl", "-fsS", "--max-time", "2", "http://127.0.0.1:3131/api/status"])
    assert.deepEqual(MeshApi.curlArgs("http://127.0.0.1:3131/api/status", 5)[3], "5")
    assert.deepEqual(MeshApi.curlArgs("", 0)[3], "2")
})

test("parseProbe accepts a JSON object, rejects HTML / junk / arrays", () => {
    const ok = MeshApi.parseProbe('{"runtime":{"daemon_state":"ready_idle"}}')
    assert.equal(ok.ok, true)
    assert.equal(ok.status.runtime.daemon_state, "ready_idle")

    const html = MeshApi.parseProbe("<!doctype html><html><body>hello</body></html>")
    assert.equal(html.ok, false)
    assert.equal(html.foreign, true)
    assert.equal(html.error, "foreign")

    const array = MeshApi.parseProbe("[]")
    assert.equal(array.ok, false)
    assert.equal(array.error, "shape")

    const junk = MeshApi.parseProbe("not json at all")
    assert.equal(junk.ok, false)
    assert.equal(junk.error, "parse")

    const empty = MeshApi.parseProbe("")
    assert.equal(empty.ok, false)
    assert.equal(empty.error, "empty")
})

test("probe failures classify from curl exit codes", () => {
    assert.equal(MeshApi.classifyProbeFailure(0), "none")
    assert.equal(MeshApi.classifyProbeFailure(7), "refused")
    assert.equal(MeshApi.classifyProbeFailure(28), "timeout")
    assert.equal(MeshApi.classifyProbeFailure(22), "foreign")
    assert.equal(MeshApi.classifyProbeFailure(6), "resolve")
    assert.equal(MeshApi.classifyProbeFailure(1), "unreachable")
})

test("readRuntime extracts daemon_state and capability booleans safely", () => {
    // Shape per the real v0.78.1 capture: booleans nested under
    // runtime.capabilities.*, not flat on runtime (docs/fixtures/…).
    const info = MeshApi.readRuntime({
        runtime: {
            daemon_state: "ready_serving",
            capabilities: {
                worker_capable: true, local_serving: true,
                proxying: false, plugin_ingress: false,
                accepting_local: true, accepting_remote: true,
                runtime_events: { version: 1, endpoint: "/api/runtime/events/v1" }
            }
        }
    })
    assert.equal(info.daemonState, "ready_serving")
    assert.deepEqual(info.capabilities, {
        workerCapable: true, localServing: true, proxying: false,
        pluginIngress: false, acceptingLocal: true, acceptingRemote: true
    })
    assert.equal(info.runtimeEvents.endpoint, "/api/runtime/events/v1")

    // Old-plan flat shape must NOT be read as truth (booleans stay false).
    const flat = MeshApi.readRuntime({
        runtime: { daemon_state: "ready_idle",
            accepting_local: true, worker_capable: true }
    })
    assert.equal(flat.capabilities.acceptingLocal, false)
    assert.equal(flat.capabilities.workerCapable, false)
    assert.equal(flat.runtimeEvents, null)

    const broken = MeshApi.readRuntime(null)
    assert.equal(broken.daemonState, "")
    assert.equal(broken.capabilities.localServing, false)
    // Not booleans-as-missing: explicitly read booleans stay false, never truthy.
    assert.equal(broken.capabilities.acceptingRemote, false)
})

test("mergedSettings: manifest defaults < schema defaultValue < inline value", () => {
    const meta = {
        defaults: {
            enabled: false,
            contributionPct: 50,
            hostedModels: [],
            meshMode: "public",
            agentEndpoint: true,
            pauseOnActivity: true
        },
        schema: [
            { key: "enabled", type: "boolean", defaultValue: false },
            { key: "contributionPct", type: "integer", min: 10, max: 100, step: 10, defaultValue: 50 }
        ]
    }
    const merged = Settings.mergedSettings({ enabled: true, contributionPct: 30 }, meta)
    assert.equal(merged.enabled, true)
    assert.equal(merged.contributionPct, 30)
    assert.equal(merged.meshMode, "public")
    assert.equal(merged.agentEndpoint, true)
    assert.equal(merged.pauseOnActivity, true)
    assert.deepEqual(merged.hostedModels, [])

    // Inline entry never carries `id` into the merged settings.
    const withId = Settings.mergedSettings({ id: "ewweberlin.omacelium" }, meta)
    assert.equal(withId.enabled, false)
    assert.ok(!("id" in withId))

    // Nothing merged when no metadata exists.
    assert.deepEqual(Settings.mergedSettings(null, null), {})
})

test("checkedInteger clamps to schema min/max and snaps to step", () => {
    const schema = {
        key: "contributionPct",
        schema: [{ key: "contributionPct", type: "integer", min: 10, max: 100, step: 10, defaultValue: 50 }]
    }
    assert.deepEqual(Settings.checkedInteger(schema, 37),
        { ok: true, value: 40, error: "" })
    assert.deepEqual(Settings.checkedInteger(schema, 5),
        { ok: true, value: 10, error: "" })
    assert.deepEqual(Settings.checkedInteger(schema, 150),
        { ok: true, value: 100, error: "" })
    assert.equal(Settings.checkedInteger({ key: "contributionPct", schema: [] }, 50).ok, false)
    assert.equal(Settings.checkedInteger({ key: "nonsense", schema: [] }, 50).error,
        "unknown-key")
    assert.deepEqual(Settings.checkedInteger(schema, "oops-bad"),
        { ok: false, value: 50, error: "invalid" })
})

test("service entry keys stay stable for stateless persistence", () => {
    assert.deepEqual(Settings.serviceEntryKeys(), [
        "enabled", "contributionPct", "hostedModels", "meshMode",
        "agentEndpoint", "pauseOnActivity"
    ])
})
