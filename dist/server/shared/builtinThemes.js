function textBox(x, y, width, height, overrides) {
    const component = {
        kind: "text",
        x,
        y,
        width,
        height,
        zIndex: 1,
        visible: true,
        opacity: 1,
        backgroundColor: "#00000000",
        borderColor: "#00000000",
        borderWidth: 0,
        borderRadius: 0,
        padding: 16,
        shadow: "none",
        fontFamily: "Oswald",
        fontSize: 48,
        fontWeight: 700,
        color: "#ffffff",
        textAlign: "center",
        letterSpacing: 1.5,
        lineHeight: 1,
        ...overrides
    };
    return {
        ...component,
        backgroundImageAssetId: component.backgroundImageAssetId ?? null,
        backgroundImageFit: component.backgroundImageFit ?? "cover",
        backgroundImagePosition: component.backgroundImagePosition ?? "center",
        backgroundOverlayColor: component.backgroundOverlayColor ?? "#000000",
        backgroundOverlayOpacity: component.backgroundOverlayOpacity ?? 0
    };
}
function logoBox(overrides) {
    const component = {
        kind: "image",
        x: 900,
        y: 24,
        width: 120,
        height: 120,
        zIndex: 4,
        visible: false,
        opacity: 1,
        backgroundColor: "#00000000",
        borderColor: "#00000000",
        borderWidth: 0,
        borderRadius: 0,
        padding: 0,
        shadow: "none",
        assetId: null,
        ...overrides
    };
    return {
        ...component,
        backgroundImageAssetId: component.backgroundImageAssetId ?? null,
        backgroundImageFit: component.backgroundImageFit ?? "cover",
        backgroundImagePosition: component.backgroundImagePosition ?? "center",
        backgroundOverlayColor: component.backgroundOverlayColor ?? "#000000",
        backgroundOverlayOpacity: component.backgroundOverlayOpacity ?? 0
    };
}
function concedeState(overrides = {}) {
    const state = {
        enabled: true,
        text: "Conceded",
        position: "above",
        placementMode: "center-stamp",
        offsetX: 0,
        offsetY: -8,
        height: 44,
        padding: 12,
        backgroundColor: "#111111ee",
        backgroundImageAssetId: null,
        backgroundImageFit: "cover",
        backgroundImagePosition: "center",
        backgroundOverlayColor: "#000000",
        backgroundOverlayOpacity: 0,
        borderColor: "#ffffff",
        borderWidth: 2,
        borderRadius: 12,
        color: "#ffffff",
        fontFamily: "Oswald",
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: 1,
        textAlign: "center",
        shadow: "none",
        animationPreset: "slide-vertical",
        durationMs: 2000,
        ...overrides
    };
    return {
        ...state,
        placementMode: state.placementMode ?? "center-stamp",
        backgroundImageAssetId: state.backgroundImageAssetId ?? null,
        backgroundImageFit: state.backgroundImageFit ?? "cover",
        backgroundImagePosition: state.backgroundImagePosition ?? "center",
        backgroundOverlayColor: state.backgroundOverlayColor ?? "#000000",
        backgroundOverlayOpacity: state.backgroundOverlayOpacity ?? 0
    };
}
export const builtinThemes = [
    {
        id: "builtin-classic-chroma",
        name: "Broadcast Logos",
        description: "Reference-style broadcast bar with full-width team logo panels and compact stacked center timing.",
        builtin: true,
        canvas: {
            width: 1920,
            height: 1080,
            backgroundColor: "#00b140",
            transparentPreview: false,
            safeArea: true
        },
        components: {
            homeName: textBox(132, 98, 520, 38, {
                backgroundColor: "#2a2724f2",
                borderColor: "#6f5d49",
                borderWidth: 1,
                padding: 6,
                color: "#ffffff",
                textAlign: "center",
                fontFamily: "Bebas Neue",
                fontSize: 26,
                letterSpacing: 1.1
            }),
            homeTeamLogo: logoBox({
                x: 132,
                y: 30,
                width: 520,
                height: 68,
                zIndex: 2,
                visible: true,
                padding: 0,
                backgroundColor: "#2a2724f2",
                borderColor: "#6f5d49",
                borderWidth: 1
            }),
            homeScore: textBox(670, 30, 156, 106, {
                backgroundColor: "#f6f1e8",
                borderColor: "#2a2522",
                borderWidth: 2,
                padding: 0,
                color: "#111111",
                fontFamily: "Bebas Neue",
                fontSize: 96,
                letterSpacing: 0,
                lineHeight: 0.92
            }),
            gameTime: textBox(849, 47, 218, 42, {
                backgroundColor: "#111111f4",
                borderColor: "#2a2522",
                borderWidth: 2,
                padding: 4,
                color: "#ffffff",
                fontFamily: "Bebas Neue",
                fontSize: 44,
                letterSpacing: 0.8,
                lineHeight: 1
            }),
            breakTime: textBox(835, 89, 246, 47, {
                backgroundColor: "#111111f4",
                borderColor: "#2a2522",
                borderWidth: 2,
                padding: 2,
                color: "#21e25b",
                fontFamily: "Barlow Condensed",
                fontSize: 24,
                letterSpacing: 0.4
            }),
            awayScore: textBox(1090, 30, 156, 106, {
                backgroundColor: "#f6f1e8",
                borderColor: "#2a2522",
                borderWidth: 2,
                padding: 0,
                color: "#111111",
                fontFamily: "Bebas Neue",
                fontSize: 96,
                letterSpacing: 0,
                lineHeight: 0.92
            }),
            awayName: textBox(1264, 98, 520, 38, {
                backgroundColor: "#2a2724f2",
                borderColor: "#6f5d49",
                borderWidth: 1,
                padding: 6,
                color: "#ffffff",
                textAlign: "center",
                fontFamily: "Bebas Neue",
                fontSize: 26,
                letterSpacing: 1.1
            }),
            awayTeamLogo: logoBox({
                x: 1264,
                y: 30,
                width: 520,
                height: 68,
                zIndex: 2,
                visible: true,
                padding: 0,
                backgroundColor: "#2a2724f2",
                borderColor: "#6f5d49",
                borderWidth: 1
            }),
            eventLogo: logoBox({
                x: 905,
                y: 28,
                width: 106,
                height: 20,
                visible: true
            })
        },
        concedeState: concedeState({
            backgroundColor: "#171311dd",
            borderColor: "#f6f1e8",
            borderWidth: 2,
            fontFamily: "Bebas Neue",
            fontSize: 34,
            letterSpacing: 1.5,
            placementMode: "center-stamp",
            padding: 10,
            height: 56
        }),
        centerSecondary: {
            gameMode: "staticText",
            gameText: "MAJOR LEAGUE PAINTBALL",
            breakMode: "timer",
            breakText: "",
            timerStyle: {
                fontFamily: "Barlow Condensed",
                fontSize: 24,
                fontWeight: 700,
                color: "#21e25b"
            },
            staticStyle: {
                fontFamily: "Barlow Condensed",
                fontSize: 24,
                fontWeight: 700,
                color: "#21e25b"
            },
            transition: {
                animation: "fade",
                durationMs: 220
            }
        }
    },
    {
        id: "builtin-minimal-strip",
        name: "Broadcast Clean",
        description: "Reference-style broadcast bar without logo artwork, keeping the same geometry and center stack.",
        builtin: true,
        canvas: {
            width: 1920,
            height: 1080,
            backgroundColor: "#00b140",
            transparentPreview: false,
            safeArea: true
        },
        components: {
            homeName: textBox(132, 30, 520, 106, {
                backgroundColor: "#2a2724f2",
                borderColor: "#6f5d49",
                borderWidth: 1,
                color: "#ffffff",
                textAlign: "center",
                fontFamily: "Bebas Neue",
                fontSize: 54,
                letterSpacing: 1.2,
                padding: 10
            }),
            homeTeamLogo: logoBox({
                x: 132,
                y: 30,
                width: 520,
                height: 68,
                zIndex: 2,
                visible: false,
                padding: 0
            }),
            homeScore: textBox(670, 30, 156, 106, {
                backgroundColor: "#f6f1e8",
                borderColor: "#2a2522",
                borderWidth: 2,
                color: "#111111",
                fontFamily: "Bebas Neue",
                fontSize: 96,
                padding: 0
            }),
            gameTime: textBox(849, 47, 218, 42, {
                backgroundColor: "#111111f4",
                borderColor: "#2a2522",
                borderWidth: 2,
                color: "#ffffff",
                fontFamily: "Bebas Neue",
                fontSize: 44,
                letterSpacing: 0.8,
                padding: 4
            }),
            breakTime: textBox(835, 89, 246, 47, {
                backgroundColor: "#111111f4",
                borderColor: "#2a2522",
                borderWidth: 2,
                color: "#21e25b",
                fontFamily: "Barlow Condensed",
                fontSize: 24,
                letterSpacing: 0.4,
                padding: 2
            }),
            awayScore: textBox(1090, 30, 156, 106, {
                backgroundColor: "#f6f1e8",
                borderColor: "#2a2522",
                borderWidth: 2,
                color: "#111111",
                fontFamily: "Bebas Neue",
                fontSize: 96,
                padding: 0
            }),
            awayName: textBox(1264, 30, 520, 106, {
                backgroundColor: "#2a2724f2",
                borderColor: "#6f5d49",
                borderWidth: 1,
                color: "#ffffff",
                textAlign: "center",
                fontFamily: "Bebas Neue",
                fontSize: 54,
                letterSpacing: 1.2,
                padding: 10
            }),
            awayTeamLogo: logoBox({
                x: 1264,
                y: 30,
                width: 520,
                height: 68,
                zIndex: 2,
                visible: false,
                padding: 0
            }),
            eventLogo: logoBox({
                x: 905,
                y: 28,
                width: 106,
                height: 20,
                visible: true
            })
        },
        concedeState: concedeState({
            backgroundColor: "#f6f1e8",
            borderColor: "#111111",
            color: "#111111",
            fontFamily: "Bebas Neue",
            fontSize: 32,
            letterSpacing: 1.1,
            animationPreset: "slide-horizontal",
            placementMode: "top-ribbon"
        }),
        centerSecondary: {
            gameMode: "staticText",
            gameText: "MAJOR LEAGUE PAINTBALL",
            breakMode: "timer",
            breakText: "",
            timerStyle: {
                fontFamily: "Barlow Condensed",
                fontSize: 24,
                fontWeight: 700,
                color: "#21e25b"
            },
            staticStyle: {
                fontFamily: "Barlow Condensed",
                fontSize: 24,
                fontWeight: 700,
                color: "#21e25b"
            },
            transition: {
                animation: "fade",
                durationMs: 220
            }
        }
    }
];
