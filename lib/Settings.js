// Plugin settings: manifest-declared schema + inline bar-entry values.
// Pure and node-testable. `updateEntryInline` on the shell replaces the whole
// entry settings object, so callers merge here first.

.pragma library

// Merge a settings source against the manifest's barWidget schema and
// defaults. Precedence: inline value > schema defaultValue > manifest defaults.
function mergedSettings(inline, barWidgetMeta) {
    var merged = {}
    var meta = barWidgetMeta || {}

    if (meta.defaults && typeof meta.defaults === "object")
        for (var defKey in meta.defaults) merged[defKey] = meta.defaults[defKey]

    if (Array.isArray(meta.schema)) {
        for (var i = 0; i < meta.schema.length; i++) {
            var entry = meta.schema[i]
            if (!entry || typeof entry.key !== "string") continue
            if (entry.defaultValue !== undefined)
                merged[entry.key] = entry.defaultValue
        }
    }

    if (inline && typeof inline === "object")
        for (var key in inline) if (key !== "id") merged[key] = inline[key]

    return merged
}

// Clamp/normalize one integer setting against its schema entry. Returns
// { ok, value, error } and never throws.
function checkedInteger(meta, value) {
    var entry = null
    var schema = meta && Array.isArray(meta.schema) ? meta.schema : []
    for (var i = 0; i < schema.length; i++)
        if (schema[i] && schema[i].type === "integer" && schema[i].key === String(meta.key))
            entry = schema[i]
    if (!entry) return { ok: false, value: null, error: "unknown-key" }

    var number = Math.round(Number(value))
    if (!isFinite(number))
        return { ok: false, value: entry.defaultValue, error: "invalid" }

    var min = typeof entry.min === "number" ? entry.min : -Infinity
    var max = typeof entry.max === "number" ? entry.max : Infinity
    var step = typeof entry.step === "number" && entry.step > 0 ? entry.step : 1

    number = Math.max(min, Math.min(max, number))
    // Snap down to a step boundary relative to min.
    number = min + Math.round((number - min) / step) * step
    if (number < min) number = min

    return { ok: true, value: number, error: "" }
}

// Settings a service-only install persists under `plugins[]` when the widget
// is not mounted in the bar: same keys, so moving the widget in or out of the
// bar does not lose user choices.
function serviceEntryKeys() {
    return ["enabled", "contributionPct", "hostedModels", "meshMode",
        "agentEndpoint", "pauseOnActivity"]
}
