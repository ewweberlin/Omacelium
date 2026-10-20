import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/State.js" as StateJs
import "lib/MeshApi.js" as MeshApi
import "lib/Settings.js" as SettingsJs
import "lib/Supervisor.js" as Sup

// Omacelium node service: management-API probe loop, state mapping, settings
// facade, and the M1 process supervisor. FIXTURE-DRIVEN: lib/Supervisor.js +
// tests carry the policy; this file owns processes. The node itself is a
// detached grandchild (bin/mesh-node start), so shell restarts adopt instead
// of duplicate, and crash detection is poll-driven per plan §3 rule 4.
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

    // ---- supervisor (M1, plan §3) ----
    // Runtime wish: the widget/panel forward the CURRENT merged settings on
    // every settings change (the shell injects entry settings only into bar
    // slots, not services — see M1 notes).
    property var runtimeWish: ({ enabled: false, contributionPct: 50, meshMode: "public", agentEndpoint: true, pauseOnActivity: true })

    // detached | starting | attached | stopping | absent | occupied |
    // foreign | crashed(with respawns left) | error(manual restart needed)
    property string supState: "detached"
    property string supReason: ""          // Sup.reasonText() when blocked
    property int consecutiveCrashes: 0
    property bool meshNodeBusy: false      // launcher lock held (rare)
    property real spawnAt: 0               // ms timestamp of the last spawn
    property string supervisorQuery: "boot" // status context: boot | crashcheck

    // The service deliberately does NOT touch the node at boot: entry
    // settings are injected into bar slots, not services, so the runtime wish
    // is unknown until the first widget mount calls setWish(). Acting on the
    // default (false) would stop an adoptable node on every shell restart —
    // the opposite of the adoption rule in plan §3.
    readonly property bool wishEnabled: runtimeWish.enabled === true
    property bool lastWishEnabled: false

    function setWish(merged) {
        if (!merged || typeof merged !== "object") return
        runtimeWish = {
            enabled: merged.enabled === true,
            contributionPct: Number(merged.contributionPct) || 50,
            meshMode: String(merged.meshMode || "public"),
            agentEndpoint: merged.agentEndpoint === true,
            pauseOnActivity: merged.pauseOnActivity === true
        }
        if (runtimeWish.enabled !== lastWishEnabled) {
            lastWishEnabled = runtimeWish.enabled
            reconcileNode()
        }
    }

    Timer {
        // Respawn delay after an observed crash (2/5/15/60, then manual).
        id: respawnTimer
        interval: 0
        repeat: false
        onTriggered: root.reconcileNode()
    }

    readonly property string launcherPath:
        Qt.resolvedUrl("bin/mesh-node").toString().replace(/^file:\/\//, "")
    readonly property string preflightPath:
        Qt.resolvedUrl("bin/mesh-preflight").toString().replace(/^file:\/\//, "")

    function reconcileNode() {
        if (reconcileInFlight) return
        reconcileInFlight = true
        console.log("[omacelium] preflight in", preflightPath, "wish:", wishEnabled)
        meshNode.activeOp = "reconcile"
        meshNode.command = [preflightPath, "--skip-gpu"]
        meshNode.running = true
    }

    property bool reconcileInFlight: false

    function absorbReconcile(exitCode, out) {
        var pf = null
        try { pf = JSON.parse(String(out || "").trim()) } catch (e) { pf = null }
        console.log("[omacelium] preflight done exit", exitCode, "raw:", String(out || "").trim().slice(0, 200))

        if (!root.wishEnabled) {
            // Disable wins even over a weird preflight: leave & clean.
            leaveNode()
            return
        }

        var decision = Sup.preflightDecision(pf)
        console.log("[omacelium] decision:", decision.action, decision.reason || "")
        switch (decision.action) {
        case "spawn": {
            root.spawnAt = Date.now()
            meshNode.activeOp = "start"
            meshNode.command = [launcherPath, "start", "--mode", "client"]
            meshNode.running = true
            return
        }
        case "surface-unmanaged":
            supState = "occupied"
            supReason = ""
            // Our fingerprinted node might be the one answering; adopt it.
            // Otherwise this is an unmanaged serve → occupied (plan §3 r3).
            supervisorQuery = "boot"
            checkLauncherState()
            return
        case "surface-foreign":
            supState = "foreign"
            supReason = Sup.reasonText(decision.reason)
            return
        case "block-absent":
            supState = "absent"
            supReason = Sup.reasonText(decision.reason)
            return
        case "block-version":
            supState = "error"
            supReason = Sup.reasonText(decision.reason)
            return
        default:
            supState = "error"
            supReason = Sup.reasonText(decision.reason)
            return
        }
    }

    function leaveNode() {
        meshNode.activeOp = "stop"
        meshNode.command = [launcherPath, "stop", "--drain", "10"]
        meshNode.running = true
        supState = "stopping"
    }

    // One launcher call before spawn/leaving, to tell "ours on the wire with
    // a healthy pidfile" (adopts) from "unmanaged" (surfaces).
    function checkLauncherState() {
        meshNode.activeOp = "status"
        meshNode.command = [launcherPath, "status"]
        meshNode.running = true
    }

    Process {
        id: meshNode

        property string activeOp: ""   // reconcile | start | stop | status
        property string collected: ""
        command: []
        stdout: StdioCollector {
            waitForEnd: true
            onStreamFinished: meshNode.collected = text
        }
        onExited: function (exitCode) {
            var body = String(meshNode.collected || "").trim()
            meshNode.collected = ""
            var op = meshNode.activeOp
            meshNode.activeOp = ""
            root.absorbSupervisor(op, exitCode, body)
        }
    }

    function absorbSupervisor(op, exitCode, out) {
        var event = ""
        try {
            var parsed = JSON.parse(out)
            if (parsed && typeof parsed === "object") event = String(parsed.event || "")
        } catch (e) { event = "" }
        console.log("[omacelium] supervisor op", op, "exit", exitCode, "event:", event || out.slice(0, 80))

        switch (op) {
        case "reconcile":
            reconcileInFlight = false
            absorbReconcile(exitCode, out)
            return
        case "start":
            root.supState = "starting"
            root.supReason = ""
            return
        case "stop":
            var mapped = Sup.stopResultToState(event)
            if (mapped === "detached" || exitCode === 0) {
                root.supState = "detached"
                root.supReason = ""
                root.consecutiveCrashes = 0
            } else if (mapped === "occupied") {
                root.supState = "occupied"
                root.supReason = Sup.reasonText("ports-ours")
            } else if (mapped === "busy") {
                root.meshNodeBusy = true
            } else {
                root.supState = root.supState
            }
            return
        case "status":
            root.attachDecision(event, exitCode, out)
            return
        default:
            return
        }
    }

    // status result → adopt at boot, or crash verdict from the poll loop.
    function attachDecision(event, exitCode, out) {
        var running = false
        try {
            var parsed = JSON.parse(out)
            if (parsed && typeof parsed === "object") running = parsed.running === "1" || parsed.running === true
        } catch (e2) { running = false }

        if (supervisorQuery === "crashcheck") {
            supervisorQuery = "boot"
            maybeApplyCrashVerdict(running)
            return
        }

        if (running && wishEnabled) {
            supState = "attached"
            supReason = ""
        }
    }

    // Poll said the console is gone while the node should be serving. The
    // launcher's pidfile either confirms the death (crash → backoff) or the
    // node is alive and the probe failure was transient.
    function maybeApplyCrashVerdict(pidAlive) {
        if (pidAlive) {
            // Alive but not answering: leave running; the next polls decide.
            return
        }
        consecutiveCrashes += 1
        var delaySecs = Sup.respawnDelaySecs(consecutiveCrashes)
        if (delaySecs === null) {
            supState = "error"
            supReason = "mesh node died repeatedly; restart needed"
            console.warn("[omacelium] giving up after", consecutiveCrashes, "crashes")
            return
        }
        supState = "starting"
        supReason = ""
        console.log("[omacelium] crash detected; respawn in", delaySecs, "s (attempt", consecutiveCrashes + ")")
        respawnTimer.interval = delaySecs * 1000
        respawnTimer.restart()
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
            maybeDetectCrash()
            return
        }

        var parsed = MeshApi.parseProbe(text)
        if (!parsed.ok) {
            reachable = true   // something answered on the port
            status = null
            lastError = parsed.foreign ? "foreign" : parsed.error
            consecutiveFailures += 1
            refreshState()
            maybeDetectCrash()
            return
        }

        reachable = true
        lastError = ""
        consecutiveFailures = 0
        status = parsed.status
        if (supState === "starting") supState = "attached"
        refreshState()
    }

    // Detached node ≠ direct child, so its death arrives via the poll loop.
    // Confirm with the launcher's pidfile/fingerprint before counting a crash,
    // and never inside the post-spawn grace window: a fresh daemon needs a few
    // seconds to bind (observed ~5 s), which would count as a false crash.
    readonly property real crashGraceMs: 12000

    function maybeDetectCrash() {
        if (!Sup.isCrashEligible(wishEnabled, supState)) return
        if (spawnAt > 0 && (Date.now() - spawnAt) < crashGraceMs) return
        supervisorQuery = "crashcheck"
        checkLauncherState()
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
