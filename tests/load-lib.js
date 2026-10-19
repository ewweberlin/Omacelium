// Node test runner for lib/*.js.
//
// QML shared-lib files use `.pragma library` and implicit exports (every
// top-level declaration is visible to the importer). Plain node runs need
// two adaptations here:
//   1. strip the `.pragma` line — the only syntax node rejects,
//   2. pin the top-level declarations to module.exports.
// Convention this relies on: in lib/*.js all top-level declarations start at
// column 0 (function name / var name). Nested declarations are indented, so
// the column-0 regex inside loadModule only sees real exports.
const fs = require("node:fs")
const path = require("node:path")

const LIB = path.join(__dirname, "..", "lib")

function stripPragmas(source) {
    return source.replace(/^\.pragma .*$/m, "")
}

function loadModule(file) {
    let source = stripPragmas(fs.readFileSync(path.join(LIB, file), "utf8"))
    const names = []
    for (const m of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)) names.push(m[1])
    for (const m of source.matchAll(/^var ([A-Za-z_$][\w$]*)/gm)) names.push(m[1])
    if (names.length > 0)
        source += "\nmodule.exports = { " + names.join(", ") + " }"
    const module = { exports: {} }
    new Function("module", "exports", source)(module, module.exports)
    return module.exports
}

module.exports = { loadModule, stripPragmas }
