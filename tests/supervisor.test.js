const test = require("node:test")
const assert = require("node:assert/strict")
const { loadModule } = require("./load-lib.js")

const Sup = loadModule("Supervisor.js")

test("backoff follows 2/5/15/60 then manual", () => {
    assert.equal(Sup.respawnDelaySecs(0), 0)
    assert.equal(Sup.respawnDelaySecs(1), 2)
    assert.equal(Sup.respawnDelaySecs(2), 5)
    assert.equal(Sup.respawnDelaySecs(3), 15)
    assert.equal(Sup.respawnDelaySecs(4), 60)
    assert.equal(Sup.respawnDelaySecs(5), null)
    assert.equal(Sup.respawnDelaySecs(99), null)
    assert.equal(Sup.respawnDelaySecs("garbage"), 0)
})

test("preflightDecision: pristine machine spawns, absent blocks", () => {
    assert.deepEqual(
        Sup.preflightDecision({
            binary: "/usr/bin/mesh-llm", version: "0.78.1",
            pin: { ok: true, warn: false, reason: "exact-or-same-minor" },
            ports: { console: "free", api: "free" }
        }),
        { action: "spawn", reason: "ports-free" })

    assert.deepEqual(
        Sup.preflightDecision({ binary: null, pin: { ok: false }, ports: { console: "free", api: "free" } }),
        { action: "block-absent", reason: "no-binary" })
    assert.deepEqual(Sup.preflightDecision(null), { action: "retry", reason: "no-preflight" })
})

test("preflightDecision: unmanaged node survives, foreign blocks", () => {
    // mesh-llm on the wire, pidfile unset → never kill blindly (plan §3 r3).
    assert.deepEqual(
        Sup.preflightDecision({
            binary: "/usr/bin/mesh-llm", pin: { ok: true },
            ports: { console: "ours", api: "ours" }
        }),
        { action: "surface-unmanaged", reason: "ports-ours" })
    // Mixed weirdness (console ours, api foreign) still surfaces, not spawns.
    assert.deepEqual(
        Sup.preflightDecision({
            binary: "/usr/bin/mesh-llm", pin: { ok: true },
            ports: { console: "ours", api: "foreign" }
        }),
        { action: "surface-unmanaged", reason: "ports-ours" })

    assert.deepEqual(
        Sup.preflightDecision({
            binary: "/usr/bin/mesh-llm", pin: { ok: true },
            ports: { console: "foreign", api: "foreign" }
        }),
        { action: "surface-foreign", reason: "ports-foreign" })
    assert.deepEqual(
        Sup.preflightDecision({
            binary: "/usr/bin/mesh-llm", pin: { ok: true },
            ports: { console: "free", api: "foreign" }
        }),
        { action: "surface-foreign", reason: "ports-foreign" })
})

test("preflightDecision: version pin blocks different major, warns same major", () => {
    assert.deepEqual(
        Sup.preflightDecision({
            binary: "/x", version: "1.2.0", pin: { ok: false, warn: false, reason: "different-major" },
            ports: { console: "free", api: "free" }
        }),
        { action: "block-version", reason: "different-major" })
    // Same-major drift just warns (supervisor still proceeds on machine fit).
    const warnPf = {
        binary: "/x", version: "0.79.1", pin: { ok: true, warn: true, reason: "same-major-drift" },
        ports: { console: "free", api: "free" }
    }
    assert.equal(Sup.preflightDecision(warnPf).action, "spawn")
})

test("collision reasons map to honest panel strings", () => {
    assert.equal(Sup.reasonText("no-binary"), "mesh-llm not found")
    assert.equal(Sup.reasonText("ports-foreign"), "Ports 3131/9337 taken by another service")
    assert.equal(Sup.reasonText("ports-ours"), "mesh-llm is already running (started outside the plugin)")
    assert.equal(Sup.reasonText("spawned"), "")
})

test("stop events resolve to detached/occupied/busy states", () => {
    assert.equal(Sup.stopResultToState("stopped"), "detached")
    assert.equal(Sup.stopResultToState("not-running"), "detached")
    assert.equal(Sup.stopResultToState("was-dead"), "detached")
    assert.equal(Sup.stopResultToState("killed"), "detached")
    assert.equal(Sup.stopResultToState("forced-stop"), "detached")
    assert.equal(Sup.stopResultToState("occupied"), "occupied")
    assert.equal(Sup.stopResultToState("busy"), "busy")
    assert.equal(Sup.stopResultToState("mystery"), "unknown")
})

test("crash eligibility only when wished and attached/starting", () => {
    assert.equal(Sup.isCrashEligible(true, "attached"), true)
    assert.equal(Sup.isCrashEligible(true, "starting"), true)
    assert.equal(Sup.isCrashEligible(true, "detached"), false)
    assert.equal(Sup.isCrashEligible(false, "attached"), false)
    assert.equal(Sup.isCrashEligible(undefined, "attached"), false)
})
