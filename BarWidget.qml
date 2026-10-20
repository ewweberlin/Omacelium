import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "lib/State.js" as StateJs

// Omacelium bar widget: one mark, a compact state label, and the mesh panel
// attached to it. The panel itself lives in Panel.qml; this root only reads
// service state and opens/closes it.
BarWidget {
    id: root

    moduleName: "ewweberlin.omacelium"

    // The live sibling service. The trusted bar hands its widgets a
    // service-capable scoped shell (Bar.qml pluginBarApiFor -> pluginShellForId),
    // so serviceFor(own id) is exactly the documented pattern for a
    // service+bar-widget plugin.
    readonly property var service: {
        var sh = root.bar && root.bar.shell
        if (!sh || typeof sh.serviceFor !== "function") return null
        return sh.serviceFor("ewweberlin.omacelium")
    }

    // Plan fallback if the current Omarchy build refuses the own-service
    // facade: the widget would supervise the node itself at runtime
    // (IMPLEMENTATION_PLAN.md §1, "Fallback ... feature-flagged"). M0 only
    // observes; nothing here spawns.
    readonly property bool serviceAvailable: service !== null

    readonly property string uiState:
        service ? (service.uiState || "offline") : "offline"
    readonly property string uiStateReason:
        service ? (service.uiStateReason || "") : "unreachable"
    readonly property bool nodeReachable:
        service ? service.reachable === true : false

    readonly property string label: StateJs.compactLabel(uiState)
    readonly property string tooltipText:
        StateJs.stateLabel(uiState)
        + (uiState === "offline" && uiStateReason === "foreign"
            ? " (port 3131 taken by another service)" : "")

    // Wish forwarding (M1): entry settings live on the bar slot — the shell
    // does not inject them into services — so the widget relays the CURRENT
    // merged settings on mount and on every settings change. The service
    // reconciles the node process against that wish (plan §3).
    onServiceChanged: syncWish()
    onSettingsChanged: syncWish()
    Component.onCompleted: syncWish()

    function syncWish() {
        if (!service || typeof service.setWish !== "function") return
        console.log("[omacelium] widget relays wish:", JSON.stringify(service.mergedSettings(root.settings)))
        service.setWish(service.mergedSettings(root.settings))
    }

    visible: true
    implicitWidth: buttonRow.implicitWidth
    implicitHeight: barSize

    Row {
        id: buttonRow
        anchors.centerIn: parent
        spacing: Style.space(6)

        BarIconButton {
            id: button
            bar: root.bar
            iconComponent: hyphalMark
            tooltipText: root.tooltipText
            labelVisible: false
            onPressed: function (buttonCode) {
                if (buttonCode === Qt.RightButton) {
                    root.togglePanel()
                } else {
                    root.togglePanel()
                }
            }
        }

        Text {
            visible: root.label !== "" && !root.vertical
            anchors.verticalCenter: parent.verticalCenter
            text: root.label
            textFormat: Text.PlainText
            color: root.bar ? root.bar.barForeground : Color.foreground
            font.family: root.bar ? root.bar.fontFamily : ""
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
        }
    }

    // The hyphal-node mark (assets/hyphal-node-mono.svg geometry), drawn with
    // Canvas so it follows the bar foreground of the active theme; Qt's SVG
    // renderer cannot resolve `currentColor` for tinting.
    Component {
        id: hyphalMark

        Canvas {
            id: mark

            readonly property color hyphaeColor:
                root.bar ? root.bar.barForeground : Color.foreground
            readonly property color nodeColor: Color.accent

            width: 24
            height: 24
            visible: width > 0 && height > 0

            onHyphaeColorChanged: mark.requestPaint()
            onNodeColorChanged: mark.requestPaint()
            onPaint: {
                var ctx = getContext("2d")
                ctx.reset()

                var scale = Math.min(width, height) / 24
                ctx.scale(scale, scale)
                ctx.lineWidth = 1.6
                ctx.lineCap = "round"
                ctx.lineJoin = "round"
                ctx.strokeStyle = mark.hyphaeColor
                ctx.fillStyle = mark.hyphaeColor

                function strokes() {
                    ctx.beginPath()
                    ctx.moveTo(12, 17)
                    ctx.lineTo(12, 12)
                    ctx.lineTo(8.5, 7.5)
                    ctx.lineTo(6, 4.5)
                    ctx.moveTo(12, 12)
                    ctx.lineTo(15.5, 7.5)
                    ctx.lineTo(18, 4.5)
                    ctx.moveTo(8.5, 7.5)
                    ctx.lineTo(6, 4.5)
                    ctx.moveTo(12, 17)
                    ctx.lineTo(7.5, 19)
                    ctx.moveTo(12, 17)
                    ctx.lineTo(16.5, 19)
                    ctx.stroke()
                }

                function spore(x, y, r) {
                    ctx.beginPath()
                    ctx.arc(x, y, r, 0, Math.PI * 2)
                    ctx.fill()
                }

                strokes()
                spore(6, 4.5, 1.5)
                spore(18, 4.5, 1.5)
                spore(7.5, 19, 1.5)
                spore(16.5, 19, 1.5)

                // Center node: the amber rounded square from the brand mark.
                ctx.fillStyle = mark.nodeColor
                var x = 10, y = 14.5, w = 4, h = 4, r = 1.2
                ctx.beginPath()
                ctx.moveTo(x + r, y)
                ctx.lineTo(x + w - r, y)
                ctx.arcTo(x + w, y, x + w, y + r, r)
                ctx.lineTo(x + w, y + h - r)
                ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
                ctx.lineTo(x + r, y + h)
                ctx.arcTo(x, y + h, x, y + h - r, r)
                ctx.lineTo(x, y + r)
                ctx.arcTo(x, y, x + r, y, r)
                ctx.closePath()
                ctx.fill()
            }
        }
    }

    function togglePanel() {
        if (panel.opened) panel.close()
        else panel.open()
    }

    function closePanel() {
        panel.close()
    }

    OmaceliumPanel {
        id: panel

        pluginId: root.moduleName
        bar: root.bar
        settings: root.settings
        service: root.service
        anchorItem: button
        // The widget's IPC target lives on the panel; widget instances across
        // monitors share one plugin id, so only the first registration wins.
        manageIpc: false
    }
}
