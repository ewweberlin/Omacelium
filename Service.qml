import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/State.js" as StateJs
import "lib/MeshApi.js" as MeshApi
import "lib/Settings.js" as SettingsJs

// Omacelium node service. M0 scope (see IMPLEMENTATION_PLAN.md): load into the
// shell, probe the Mesh-LLM management API, map daemon_state to bar state, and
// capture one real /api/status response for the contract gate. Spawn, pidfiles
// and preflight arrive with M1 (bin/mesh-node).
Item {
    id: root

    // ---- injected by the shell host (ShellRoot.ensureService) ----
    property var shell: null
    property var manifest: null
    property QtObject barWidgetRegistry: null
    property var pluginRegistry: null
    property string omarchyPath: ""

    readonly property string pluginId:
        manifest && manifest.id ? String(manifest.id) : "ewweberlin.omacelium"

    // ---- settings (manifest schema + inline bar-entry values) ----
    // `barWidgetMeta` is the manifest's barWidget block; the host injects the
    // whole manifest into the service, so those defaults live here once.
    readonly property var barWidgetMeta: manifest && manifest.barWidget
        ? manifest.barWidget : null

    function mergedSettings(inlineSettings) {
        return SettingsJs.mergedSettings(inlineSettings || null, barWidgetMeta)
    }

    // Apply one key change and persist the FULL merged object: the shell's
    // updateEntryInline replaces the whole bar entry, so merging here keeps the
    // other keys. Integer keys pass through the manifest's min/max/step.
    function applySetting(key, value, inlineSettings) {
        var meta = { key: key, schema: barWidgetMeta ? barWidgetMeta.schema : [] }
        if (typeof value === "number" || typeof value === "string") {
            var checked = SettingsJs.checkedInteger(meta, value)
            if (checked.ok) value = checked.value
            else if (checked.error === "unknown-key") return false
        }
        var next = mergedSettings(inlineSettings)
        next[key] = value

        if (shell && typeof shell.updateEntryInline === "function")
            return shell.updateEntryInline(root.pluginId, next) === true
        return false
    }

    // ---- live node state (contract-verified fields only) ----
    property var status: null            // last parsed GET /api/status JSON
    property bool reachable: false
    property string lastError: ""        // none|refused|timeout|resolve|foreign|unreachable|empty|shape|parse
    property string uiState: "offline"
    property string uiStateReason: "unreachable"
    property string daemonState: ""      // /api/status.runtime.daemon_state
    property var capabilities: ({
        workerCapable: false, localServing: false, proxying: false,
        pluginIngress: false, acceptingLocal: false, acceptingRemote: false
    })

    // ---- polling ----
    // "panel" | "bar" | "idle"; surfaces raise or lower us.
    property string pollMode: "idle"
    property int consecutiveFailures: 0
    readonly property int pollIntervalMs:
        StateJs.pollIntervalMs(pollMode, consecutiveFailures)

    onPollIntervalMsChanged: {
        pollTimer.interval = pollIntervalMs
        if (pollTimer.running) pollTimer.restart()
        else pollTimer.start()
    }

    Timer {
        id: pollTimer
        interval: root.pollIntervalMs
        repeat: true
        onTriggered: root.probeStatus()
    }

    function probeStatus() {
        if (statusProbe.running) return
        statusProbe.command = MeshApi.curlArgs(MeshApi.ENDPOINTS.status, 2)
        statusProbe.running = true
    }

    // One real /api/status response, written straight to the state dir. The
    // M0 exit gate (IMPLEMENTATION_PLAN.md §7) is this file. The helper script
    // does the mkdir/umask/write itself so plugin QML never handles the bytes.
    function captureStatus() {
        if (statusCapture.running) return
        statusCapture.command = [binPath, "capture", "api-status", "--timeout", "5"]
        statusCapture.running = true
    }

    Process {
        id: statusCapture

        command: []
        stderr: StdioCollector {
            waitForEnd: true
            onStreamFinished: {
                if (text.trim())
                    console.warn("[omacelium] capture stderr:", text.trim())
            }
        }
    }

    readonly property string binPath:
        Qt.resolvedUrl("bin/omacelium-node").toString().replace(/^file:\/\//, "")

    Component.onCompleted: {
        console.log("[omacelium] service ready as", root.pluginId)
        probeStatus()
        pollTimer.start()
    }

    // The host assigns the scoped shell right after createObject, so the ready
    // log above cannot see it yet; this change records the real wiring.
    onShellChanged: {
        if (shell !== null) console.log("[omacelium] scoped shell attached:",
            typeof shell.serviceFor === "function" ? "service-capable" : "no serviceFor")
    }

    // --------------------------------------------------------------- probe

    Process {
        id: statusProbe

        property string collected: ""
        command: []
        stdout: StdioCollector {
            waitForEnd: true
            onStreamFinished: statusProbe.collected = text
        }
        onExited: function (exitCode) {
            var body = String(statusProbe.collected || "")
            statusProbe.collected = ""
            root.absorbProbe(exitCode, body)
        }
    }

    function absorbProbe(exitCode, text) {
        if (exitCode !== 0) {
            reachable = false
            status = null
            lastError = MeshApi.classifyProbeFailure(exitCode)
            consecutiveFailures += 1
            refreshState()
            return
        }

        var parsed = MeshApi.parseProbe(text)
        if (!parsed.ok) {
            reachable = true   // something answered on the port
            status = null
            lastError = parsed.foreign ? "foreign" : parsed.error
            consecutiveFailures += 1
            refreshState()
            return
        }

        reachable = true
        lastError = ""
        consecutiveFailures = 0
        status = parsed.status
        refreshState()
    }

    function refreshState() {
        var mapped = StateJs.uiState(status, reachable)
        uiState = mapped.state
        uiStateReason = mapped.reason

        var info = MeshApi.readRuntime(status)
        capabilities = info.capabilities
        daemonState = info.daemonState
    }
}
