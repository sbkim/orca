# Orca Dev Branch Guide

This document covers only the features and build workflow maintained on the `dev` branch. For general Orca installation and product information, see [README.md](README.md).

The `dev` branch currently adds:

- A **Run Script** menu for running `package.json` scripts from Orca
- Encrypted mobile push notifications using Firebase Cloud Messaging (FCM)
- Android and iOS native mobile build and distribution support for the FCM-enabled companion app

> The desktop and mobile applications should always be built from the same rebased `dev` commit.

## Dev Branch Features

### Run Package Scripts From Orca

The focused worktree displays a **Run Script** button when runnable `package.json` scripts are available.

The menu:

- Detects scripts in the workspace root and nested packages
- Organizes nested packages in a script tree
- Detects the package manager from the `packageManager` field or lockfile
- Falls back to npm when no package manager can be detected
- Opens the selected command in a new terminal tab
- Supports local, SSH, and other remote worktrees
- Reloads scripts when the menu is opened

To use it:

1. Open or focus a worktree.
2. Select **Run Script** in the tab bar.
3. Search for or browse to a package script.
4. Select the script.
5. Orca opens a terminal tab and runs `<package-manager> run <script>`.

The button is hidden when the worktree has no runnable scripts.

### Encrypted Mobile Push Notifications

The `dev` branch supports encrypted background push notifications through FCM.

The delivery flow is:

1. The mobile app registers its FCM token and mobile encryption public key with the paired desktop.
2. Orca encrypts the notification payload for the target mobile device.
3. Foreground notifications use the active WebSocket connection.
4. When no mobile WebSocket listener is active, Orca sends the encrypted payload through FCM.
5. The mobile app decrypts and displays the notification.
6. Disabling push notifications in the mobile app deactivates FCM delivery for that device.

FCM is a supplemental background delivery path. It does not duplicate notifications while the mobile WebSocket listener is active.

## Prerequisites

### Common Toolchain

- Git
- Node.js 24
- pnpm 10.24.x

Verify the versions:

```bash
node --version
pnpm --version
git --version
```

### Android

- Android Studio
- Android SDK
- JDK 17
- An Android emulator or physical Android device

### iOS

- macOS
- Xcode
- CocoaPods
- Ruby 3.1 or later
- Bundler 4.0.11
- An Apple Developer account
- A physical iOS device for complete APNs testing

Expo Go cannot test the complete FCM implementation because Orca uses native React Native Firebase modules and an iOS notification service extension.

## Keep The Dev Branch Current

Rebase `dev` onto the latest upstream `main` before producing desktop or mobile builds.

### Rebase Strategy

Use one maintainer to perform and publish each shared rebase. Because a rebase rewrites commit history, other developers should finish or preserve their work before updating to the rebased branch.

Start with a clean working tree:

```bash
git switch dev
git status --short
```

Commit or safely stash any local changes before continuing.

Fetch the latest upstream state and rebase:

```bash
git fetch origin
git rebase origin/main
```

If conflicts occur:

```bash
git status
# Resolve the files.
git add <resolved-files>
git rebase --continue
```

To cancel the rebase and return to the previous state:

```bash
git rebase --abort
```

After a successful rebase, review the branch-only commits:

```bash
git log --oneline origin/main..dev
git diff --stat origin/main...dev
```

If the shared `dev` branch is hosted on the `fork` remote, publish the rewritten history safely:

```bash
git push --force-with-lease fork dev
```

Never use an unguarded `--force` push for the shared branch.

### Refresh Dependencies After Every Rebase

Install the exact desktop dependencies from the rebased lockfile:

```bash
pnpm install --frozen-lockfile
```

Then install the exact mobile dependencies:

```bash
cd mobile
pnpm install --frozen-lockfile
cd ..
```

Rebuilding after the rebase is required even when the rebase appears documentation-only. Upstream changes can affect Electron, native modules, Expo configuration, lockfiles, or the desktop-mobile protocol.

## Build And Run Desktop Orca

### Development Mode

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev-stable-name
```

`dev-stable-name` keeps development application data under the stable development profile, including paired mobile devices and FCM configuration.

Restart Orca after changing Electron main-process code.

### Packaged Desktop Builds

Build for the current platform:

```bash
# macOS
pnpm build:mac

# Windows
pnpm build:win

# Linux
pnpm build:linux
```

Use the platform command on its corresponding operating system. Release signing and publication require additional platform-specific credentials.

### Automated Fork Dev Releases

Every push to `dev` in `sbkim/orca` runs the **Dev Desktop Release** GitHub Actions workflow. It builds unsigned macOS, Windows, and Linux packages from the same commit and publishes them together as a GitHub prerelease after every platform succeeds.

Dev releases use an immutable version and tag derived from the workflow run and commit SHA. Auto-update is disabled in these packages so they cannot replace themselves from Orca's official signed release channel.

Because these artifacts are not Apple-notarized or Windows code-signed, macOS Gatekeeper and Windows SmartScreen warnings are expected.

## Configure FCM

Each independent development environment should use its own Firebase project.

Follow the complete setup guide:

[FCM Independent Development Environment](docs/reference/fcm-independent-development-environment.md)

The required machine-local Firebase files are:

```text
mobile/google-services.json
mobile/GoogleService-Info.plist
```

These files are ignored by Git.

Start desktop Orca:

```bash
pnpm dev-stable-name
```

Then open:

```text
Settings > Notifications > FCM Push (Mobile)
```

Paste the complete Google service-account JSON for the Firebase project and save it.

The desktop sender service account must belong to the same Firebase project as the Android and iOS configuration files.

> Never commit Firebase service-account JSON, private keys, provisioning credentials, or `mobile/fastlane/.env`.

## Build And Run Orca Mobile

Install dependencies:

```bash
cd mobile
pnpm install --frozen-lockfile
```

### Android Native Build

If necessary, configure the Android SDK:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

Generate the Android project and run it:

```bash
pnpm exec expo prebuild --clean --platform android --no-install
pnpm android
```

After installing the native development client, start Metro with:

```bash
pnpm start --dev-client
```

### iOS Native Build

Place `GoogleService-Info.plist` in `mobile/`, then run:

```bash
pnpm exec expo prebuild --clean --platform ios --no-install
npx pod-install ios
pnpm ios
```

For a physical device, confirm that:

- The intended Apple team is selected
- The main Orca app and `OrcaNotificationService` both sign successfully
- Push Notifications capability is enabled
- Both targets use the matching Keychain Access Group
- The device is registered with the selected Apple team

After installing the native development client, run:

```bash
pnpm start --dev-client
```

## Pair Mobile With Desktop Orca

1. Start desktop Orca from the same rebased `dev` commit.
2. Open **Settings > Mobile** in desktop Orca.
3. Open the pairing screen in Orca Mobile.
4. Scan the desktop pairing QR code.
5. Confirm the pairing request.

For a physical device, the desktop and phone must be able to reach each other over the network.

Example endpoints:

```text
Physical device:  ws://<desktop-lan-ip>:6768
Android emulator: ws://10.0.2.2:6768
```

If an old pairing points to a stale host, remove it from the mobile app and pair again.

## Enable And Test Push Notifications

1. Install a native mobile build containing the Firebase configuration.
2. Allow notification permission on the device.
3. Enable **Push Notifications** in Orca Mobile.
4. Pair the mobile app with the matching desktop build.
5. Configure the desktop FCM sender credentials.
6. Background or fully close the mobile app.
7. Generate a task-complete or terminal-bell notification.

Backgrounding the app is important because an active WebSocket listener intentionally takes priority over FCM.

## Optional Firebase Test Distribution

Create the ignored Fastlane environment file:

```bash
cd mobile
cp fastlane/.env.example fastlane/.env
```

Fill in the Firebase application IDs, distribution credentials, tester groups, and Apple team information.

Build and upload an Android test APK:

```bash
pnpm run firebase:android
```

Build and upload an iOS development IPA:

```bash
pnpm run firebase:ios
```

The iOS development IPA can only be installed on devices included in the development provisioning profile.

## Validation Before Sharing A Build

Run desktop validation from the repository root:

```bash
pnpm typecheck
pnpm test
```

Run mobile validation:

```bash
cd mobile
pnpm typecheck
pnpm lint
pnpm test
cd ..
```

Then build the desktop and mobile applications from the same commit.

Record the commit used for the build:

```bash
git rev-parse HEAD
git status --short
```

Do not distribute a build when the working tree contains unreviewed source changes.

## Recommended Update And Build Sequence

Use this sequence whenever producing an updated `dev` build:

```bash
git switch dev
git fetch origin
git rebase origin/main

pnpm install --frozen-lockfile
pnpm typecheck
pnpm test

cd mobile
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
cd ..

git rev-parse HEAD
```

After validation:

1. Build desktop Orca for the target platform.
2. Regenerate the native mobile project.
3. Build Android and/or iOS.
4. Pair builds produced from the same commit.
5. Test foreground WebSocket notifications.
6. Test background FCM notifications.
7. Publish the rebased branch with `--force-with-lease` when appropriate.
8. Record the commit SHA with the distributed artifacts.

## Troubleshooting

### Run Script Is Not Visible

- Confirm the focused worktree contains a `package.json`.
- Confirm `package.json` has at least one script.
- Reopen the Run Script menu after editing the file.
- Confirm Orca can access the remote or SSH worktree.

### Mobile Cannot Connect

- Confirm desktop Orca is running.
- Confirm port `6768` is reachable.
- Confirm the phone and desktop are on the same accessible network.
- Use `10.0.2.2` instead of `localhost` from the Android emulator.
- Remove stale pairing information and pair again.

### Push Notification Is Not Delivered

- Confirm notifications are allowed by the operating system.
- Confirm Push Notifications are enabled in Orca Mobile.
- Confirm the device was paired again after installing the FCM-enabled build.
- Confirm the desktop service account and mobile Firebase files use the same project.
- Confirm the FCM HTTP v1 API is enabled.
- Background or close the mobile app before testing FCM.
- Check the detailed troubleshooting section in the FCM setup guide.

## Related Documentation

- [General Orca README](README.md)
- [Orca Mobile Development Guide](mobile/README.md)
- [FCM Independent Development Environment](docs/reference/fcm-independent-development-environment.md)
