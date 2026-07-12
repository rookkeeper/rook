# Rook for Android (native Kotlin + Jetpack Compose)

A native Android client at feature parity with the iOS/Mac apps — the fourth
[Rook](../../README.md) client, speaking the same REST + ACP-over-WebSocket
contract. No server changes required. Ported from the Swift clients in
`clients/RookKit/` and `clients/iphone/`.

## Getting it running

The repo-level launcher target is currently being split/reworked. For the
moment `../../scripts/run-rook.sh android` is only a placeholder target, so use
the manual `adb reverse` + Gradle flow below for real Android bring-up.

```bash
./scripts/run-rook.sh android                    # placeholder target for now
./scripts/run-rook.sh stop                       # shut down server + launched app(s)
```

The manual equivalent, if you'd rather not use the script:

`RookApi` defaults to `http://127.0.0.1:3000` (`net/RookApi.kt`), matching the
iOS simulator's default. On an **emulator**, that alias doesn't reach the host
Mac; on a **physical device**, `127.0.0.1` just points back at the phone
itself.

The fix works the same way for both: `adb reverse` forwards the
device's/emulator's `127.0.0.1:3000` to the Mac's `127.0.0.1:3000` over the
USB/adb connection, so the app's unmodified default `baseUrl` reaches the dev
server with no code changes or recompiling:

```bash
# 1. Start the Rook server (skip if already running)
npm run dev   # from the repo root; verify: curl http://127.0.0.1:3000/api/health

# 2. Forward the device's localhost:3000 to the Mac's localhost:3000
adb reverse tcp:3000 tcp:3000

# 3. Build and install
./gradlew :app:installDebug
adb shell am start -n com.rookery.rook/.MainActivity
```

`adb reverse` isn't persistent — it's tied to the current adb connection, so
re-run step 2 after unplugging/reconnecting the device or restarting the
emulator.

## Demoing

[`scrcpy`](https://github.com/Genymobile/scrcpy) mirrors (and controls) a
connected device's screen in a resizable desktop window — useful for
screen-recording a physical-device demo instead of juggling `adb screencap`:

```bash
brew install scrcpy
scrcpy   # mirrors whichever device `adb devices` sees
```
