import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "lib/State.js" as StateJs

// Omacelium panel: state chip, contribution controls, model list placeholder
// and the agent endpoint row. M0 ships the shape and the contract-verified
// state text only; controls that depend on the real /api/status capture stay
// honest ("appears once mesh-llm is installed") instead of predicting values
// the plan says must be captured first.
Panel {
    id: root

    // Wired up by the declaring BarWidget.
    property string pluginId: "ewweberlin.omacelium"
    property QtObject bar: null
    property var service: null
    property Item anchorItem: null

    ipcTarget: "ewweberlin.omacelium"
    moduleName: "ewweberlin.omacelium"

    readonly property string uiState: service ? (service.uiState || "offline") : "offline"
    readonly property string uiStateReason:
        service ? (service.uiStateReason || "") : "unreachable"
    readonly property string daemonState:
        service ? (service.daemonState || "") : ""
    readonly property bool nodeReachable: service ? service.reachable === true : false

    // ---- settings (inline bar-entry values; the service applies writes) ----
    readonly property var activeSettings:
        service && typeof service.mergedSettings === "function"
            ? service.mergedSettings(root.settings) : ({})
    readonly property bool meshEnabled: activeSettings.enabled === true
    readonly property real contributionPct: Number(activeSettings.contributionPct || 0)
    readonly property bool agentEndpointAllowed: activeSettings.agentEndpoint === true

    function applySetting(key, value) {
        if (!service || typeof service.applySetting !== "function") return false
        return service.applySetting(key, value, root.settings) === true
    }

    KeyboardPanel {
        id: panel

        anchorItem: root.anchorItem
        owner: root
        bar: root.bar
        open: root.opened
        focusTarget: keyCatcher
        contentWidth: panel.fittedContentWidth(Style.space(360), Style.space(420))
        contentHeight: panel.fittedContentHeight(mainColumn.implicitHeight, Style.space(480))

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent

            onCloseRequested: root.close()

            Flickable {
                id: contentFlick
                anchors.fill: parent
                contentWidth: width
                contentHeight: mainColumn.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                flickableDirection: Flickable.VerticalFlick
                interactive: contentHeight > height
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

                Column {
                    id: mainColumn
                    width: contentFlick.width
                    spacing: Style.space(10)

                    // ----------------------------------------------- header
                    Row {
                        width: parent.width
                        spacing: Style.space(8)

                        Image {
                            width: 34
                            height: 34
                            sourceSize: Qt.size(width, height)
                            fillMode: Image.PreserveAspectFit
                            source: Qt.resolvedUrl("assets/hyphal-node.svg")
                        }

                        Column {
                            spacing: 2
                            Text {
                                text: "Omacelium"
                                textFormat: Text.PlainText
                                color: Color.popups.text
                                font.family: root.bar ? root.bar.fontFamily : ""
                                font.pixelSize: Style.font.heading
                                font.bold: true
                            }
                            Text {
                                text: root.nodeReachable
                                    ? "mesh-llm answered on port 3131"
                                    : (root.uiStateReason === "foreign"
                                        ? "port 3131 taken by another service"
                                        : "mesh-llm not reachable")
                                textFormat: Text.PlainText
                                color: Color.popups.text
                                opacity: 0.65
                                font.family: root.bar ? root.bar.fontFamily : ""
                                font.pixelSize: Style.font.bodySmall
                            }
                        }
                    }

                    // ------------------------------------------- state chip
                    Row {
                        spacing: Style.space(8)
                        Rectangle {
                            radius: height / 2
                            width: stateChipText.implicitWidth + Style.space(16)
                            height: stateChipText.implicitHeight + Style.space(6)
                            color: Color.accent
                            opacity: 0.16
                            Text {
                                id: stateChipText
                                anchors.centerIn: parent
                                text: StateJs.stateLabel(root.uiState)
                                textFormat: Text.PlainText
                                color: Color.popups.text
                                font.family: root.bar ? root.bar.fontFamily : ""
                                font.pixelSize: Style.font.bodySmall
                            }
                        }
                        Text {
                            visible: root.daemonState !== ""
                            anchors.verticalCenter: parent.verticalCenter
                            text: root.daemonState
                            textFormat: Text.PlainText
                            color: Color.popups.text
                            opacity: 0.45
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.bodySmall
                        }
                    }

                    // -------------------------------------------- controls
                    // M0: Join mesh only persists the wish; starting a process
                    // arrives with M1 (bin/mesh-node supervisor).
                    Toggle {
                        width: parent.width
                        label: "Join mesh"
                        description: root.meshEnabled
                            ? "Started once the node supervisor lands (M1)"
                            : "Persisted wish; the supervisor starts it in M1"
                        checked: root.meshEnabled
                        onClicked: root.applySetting("enabled", !root.meshEnabled)
                    }

                    Toggle {
                        width: parent.width
                        label: "Local endpoint"
                        description: "Serve http://127.0.0.1:9337/v1 to local agents"
                        checked: root.agentEndpointAllowed
                        onClicked: root.applySetting(
                            "agentEndpoint", !root.agentEndpointAllowed)
                    }

                    Column {
                        width: parent.width
                        spacing: 3

                        Row {
                            width: parent.width
                            spacing: Style.space(8)
                            Text {
                                text: "Contributed load"
                                textFormat: Text.PlainText
                                color: Color.popups.text
                                opacity: root.meshEnabled ? 1 : 0.6
                                font.family: root.bar ? root.bar.fontFamily : ""
                                font.pixelSize: Style.font.body
                            }
                            Text {
                                text: Math.round(root.contributionPct) + "%"
                                textFormat: Text.PlainText
                                color: Color.accent
                                font.family: root.bar ? root.bar.fontFamily : ""
                                font.pixelSize: Style.font.body
                                font.bold: true
                            }
                        }

                        PanelSlider {
                            id: contributeSlider
                            width: parent.width
                            bar: root.bar
                            enabled: root.meshEnabled
                            opacity: root.meshEnabled ? 1 : 0.55
                            minimum: 10
                            maximum: 100
                            step: 10
                            integer: true
                            tickCount: 0
                            value: root.contributionPct
                            onReleased: function (released) {
                                root.applySetting("contributionPct",
                                    Math.max(10, Math.min(100, Math.round(released))))
                            }
                        }

                        Text {
                            visible: root.meshEnabled
                            text: "Maps to --max-vram once the budget from the "
                                + "real GPU probe is captured (M2)."
                            textFormat: Text.PlainText
                            color: Color.popups.text
                            opacity: 0.55
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.bodySmall
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                            width: parent.width
                        }
                    }

                    // ----------------------------------------- models zone
                    Column {
                        width: parent.width
                        spacing: 2

                        Text {
                            text: "Hosted models"
                            textFormat: Text.PlainText
                            color: Color.popups.text
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.body
                            font.bold: true
                        }
                        Text {
                            text: root.meshEnabled
                                ? "Model catalog arrives once mesh-llm is installed (M3)."
                                : "Join the mesh to pick models."
                            textFormat: Text.PlainText
                            color: Color.popups.text
                            opacity: 0.55
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.bodySmall
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                            width: parent.width
                        }
                    }

                    // ------------------------------------------ agents zone
                    Column {
                        width: parent.width
                        spacing: 2

                        Text {
                            text: "Agent endpoint"
                            textFormat: Text.PlainText
                            color: Color.popups.text
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.body
                            font.bold: true
                        }
                        Text {
                            text: "http://127.0.0.1:9337/v1"
                            textFormat: Text.PlainText
                            color: Color.accent
                            opacity: 0.8
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.bodySmall
                        }
                        Text {
                            text: "Wire model: auto"
                            textFormat: Text.PlainText
                            color: Color.popups.text
                            opacity: 0.55
                            font.family: root.bar ? root.bar.fontFamily : ""
                            font.pixelSize: Style.font.bodySmall
                        }
                    }
                }
            }
        }
    }
}
