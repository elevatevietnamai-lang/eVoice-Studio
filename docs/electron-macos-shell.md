# macOS desktop shell

The navigation is always the icon rail: 64 px wide, with the app mark below the
traffic lights and its right divider beginning below the 72 px header region.

Notifications appear at the top right, with space reserved before the bell.
The notification menu opens downward and remains available while notification
data loads. Settings uses an icon in the macOS sidebar footer; Local device
sits beside it and opens the device and compute-target menu. The expanded
sidebar retains the Local device label.

Windows and Linux retain their existing notification and device placement.

The notification control follows workspace headers in document order so their
native drag regions cannot consume its mouse clicks. On macOS, run
`node tests/native-bell-repro.mjs` from `electron/` against the dev renderer
to verify a real system mouse click (requires Swift and Accessibility access).
Browser automation alone bypasses native titlebar hit testing.
