const test = require("node:test")
const assert = require("node:assert/strict")
const { loadModule } = require("./load-lib.js")

const Settings = loadModule("Settings.js")

const meta = {
    defaults: { enabled: false, contributionPct: 50 },
    schema: [
        { key: "enabled", type: "boolean", defaultValue: false },
        { key: "contributionPct", type: "integer", min: 10, max: 100, step: 10, defaultValue: 50 },
        { key: "meshMode", type: "enum", defaultValue: "public" },
        { key: "agentEndpoint", type: "boolean", defaultValue: true },
        { key: "pauseOnActivity", type: "boolean", defaultValue: true }
    ]
}

test("string booleans from `bar set` coerce per schema type", () => {
    var merged = Settings.mergedSettings({ enabled: "true", agentEndpoint: "false" }, meta)
    assert.equal(merged.enabled, true)
    assert.equal(merged.agentEndpoint, false)
    assert.equal(merged.pauseOnActivity, true)

    merged = Settings.mergedSettings({ enabled: "false", agentEndpoint: "0", pauseOnActivity: "1" }, meta)
    assert.equal(merged.enabled, false)
    assert.equal(merged.agentEndpoint, false)
    assert.equal(merged.pauseOnActivity, true)
})

test("string coercion never touches other types", () => {
    // meshMode is enum/string: a legitimate "true" value stays untouched,
    // integers keep their authored type.
    var merged = Settings.mergedSettings({ meshMode: "true" }, meta)
    assert.equal(merged.meshMode, "true")
    merged = Settings.mergedSettings({ contributionPct: 70 }, meta)
    assert.equal(merged.contributionPct, 70)
})

test("real booleans and absence pass through unchanged", () => {
    var merged = Settings.mergedSettings(null, meta)
    assert.equal(merged.enabled, false)
    assert.equal(merged.agentEndpoint, true)
    merged = Settings.mergedSettings({ enabled: true }, meta)
    assert.equal(merged.enabled, true)
})

test("no boolean schema → no coercion at all", () => {
    var stringOnly = { schema: [{ key: "note", type: "string", defaultValue: "" }] }
    var merged = Settings.mergedSettings({ note: "true" }, stringOnly)
    assert.equal(merged.note, "true")
})
