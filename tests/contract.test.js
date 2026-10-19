const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { loadModule } = require("./load-lib.js")

const MeshApi = loadModule("MeshApi.js")
const State = loadModule("State.js")

// Docs/fixtures/api-status-v0.78.1-client.json is a sanitized live capture
// (invite token + node identity redacted) taken from a real 0.78.1 node run on
// this machine: `mesh-llm serve --client --headless --no-default-plugins`,
// ports 3131/9337, defaults per upstream.
const fixturePath = path.join(__dirname, "..", "docs", "fixtures",
    "api-status-v0.78.1-client.json")
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"))

test("probe parse accepts the real v0.78.1 capture verbatim", () => {
    const raw = fs.readFileSync(fixturePath, "utf8")
    const parsed = MeshApi.parseProbe(raw)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.status.version, "0.78.1")
})

test("contract: runtime.daemon_state exists with a documented value", () => {
    assert.equal(fixture.runtime.daemon_state, "ready_idle")
    const caps = fixture.runtime.capabilities
    for (const key of ["worker_capable", "local_serving", "proxying",
        "plugin_ingress", "accepting_local", "accepting_remote"])
        assert.equal(typeof caps[key], "boolean", key)
})

test("readRuntime reads capability booleans from the real shape", () => {
    const info = MeshApi.readRuntime(fixture)
    assert.equal(info.daemonState, "ready_idle")
    // A --client node: API-only, nothing served, not remotely loaded.
    assert.deepEqual(info.capabilities, {
        workerCapable: false, localServing: false, proxying: false,
        pluginIngress: false, acceptingLocal: true, acceptingRemote: true
    })
})

test("uiState maps the captured client node the way §3 prescribes", () => {
    const mapped = State.uiState(fixture, true)
    assert.deepEqual(mapped, { state: "joined", reason: "ready_idle" })
})

test("capture-decorated fields the later milestones build on exist", () => {
    // M2 GPU row and vram mapping read these; present + shaped in 0.78.1.
    assert.ok(Array.isArray(fixture.gpus))
    assert.equal(typeof fixture.my_hostname, "string")
    assert.equal(fixture.node_state, "client")
    assert.equal(fixture.is_client, true)
    assert.ok(fixture.my_memory && typeof fixture.my_memory.total_bytes === "number")
})
