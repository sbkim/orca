# FCM Independent Development Environment

This guide explains how a developer can check out Orca's `dev` branch and build
an independent Firebase Cloud Messaging environment using their own Firebase
project and Apple Developer team.

It covers:

- Apple Developer identifiers, capabilities, keys, devices, certificates, and
  provisioning
- Firebase Android and Apple app registration
- FCM HTTP v1 sender credentials
- Firebase App Distribution credentials and tester groups
- Orca source configuration that must change for an independent Apple team
- local Android, iOS, desktop, pairing, and push-delivery validation
- optional GitHub Actions configuration

Never commit service-account JSON, APNs `.p8` keys, signing certificates,
provisioning profiles, or machine-local environment files.

## Choose The Environment Model First

There are two supported ways to prepare a developer environment.

| Area | Shared Orca organization | Independent developer environment |
| --- | --- | --- |
| Firebase project | Use the existing project with granted access | Create a separate Firebase project |
| Apple Developer team | Join the existing team | Use the developer's own paid team |
| Bundle and package identifiers | Keep the existing values | Replace them with globally unique values |
| APNs authentication | Use a team-managed key | Create and upload a new APNs key |
| Google service accounts | Receive or create scoped accounts | Create accounts in the new project |
| Source changes | Usually unnecessary | Required for team, bundle, package, and keychain identifiers |

This guide assumes the independent model. Firebase recommends a separate
Firebase project for each development environment so development traffic and
credentials cannot affect production resources. See
[General best practices for setting up Firebase projects](https://firebase.google.com/docs/projects/dev-workflows/general-best-practices).

Before creating resources, choose these values and record them in a secure
setup note:

```text
APPLE_TEAM_ID=<10-character Apple Team ID>
IOS_BUNDLE_ID=com.<developer-or-organization>.orca.mobile
ANDROID_PACKAGE=com.<developer-or-organization>.orca.mobile
IOS_EXTENSION_BUNDLE_ID=com.<developer-or-organization>.orca.mobile.notification-service
KEYCHAIN_ACCESS_GROUP=<APPLE_TEAM_ID>.com.<developer-or-organization>.orca.mobile.push
```

Apple and Firebase identifiers are difficult or impossible to rename after
registration. Decide them before creating either platform's resources.

## Required Access

### Apple

A paid Apple Developer Program membership is strongly recommended. A free
Personal Team has short-lived App IDs, devices, and provisioning profiles and
is not suitable for a stable push-notification or tester-distribution
environment. See
[Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/).

The following actions normally require the Apple Account Holder or an Admin:

- registering or editing explicit App IDs in the Developer portal
- enabling capabilities in the Developer portal
- creating an APNs private key
- manually registering devices or managing provisioning profiles
- creating team-level App Store Connect API keys

A team member with development access can sign in to Xcode, create their own
Apple Development certificate, and use Xcode-managed signing when the team's
policies allow it.

### Firebase And Google Cloud

The developer needs enough access to:

- create or administer a Firebase project
- register Android and Apple apps
- enable the Firebase Cloud Messaging HTTP v1 API
- create Google Cloud service accounts and assign IAM roles
- configure App Distribution testers and groups
- upload the Apple APNs key to Firebase

Assign the narrowest role that permits each operation. Keep the runtime FCM
sender account separate from the App Distribution uploader account.

## Apple Developer Configuration

### 1. Connect The Apple Account To Xcode

On the development Mac:

1. Open **Xcode > Settings > Accounts**.
2. Add the Apple Account that belongs to the intended team.
3. Select the correct team.
4. Open **Manage Certificates**.
5. Create an **Apple Development** certificate if one is not already available
   with its private key on this Mac.

Apple Development certificates are used to run the application on registered
devices. Apple Distribution certificates are used for registered-device
distribution and App Store Connect uploads. See
[Certificates overview](https://developer.apple.com/help/account/create-certificates/certificates-overview).

### 2. Register The Main App ID

In **Apple Developer > Certificates, Identifiers & Profiles > Identifiers**,
register an explicit App ID matching `IOS_BUNDLE_ID`.

Enable these capabilities:

- **Push Notifications**
- **Keychain Sharing**

The main app receives the APNs notification and writes the persistent
notification decryption key into the shared keychain group.

### 3. Register The Notification Service Extension App ID

Register a second explicit App ID matching `IOS_EXTENSION_BUNDLE_ID`.

Enable:

- **Keychain Sharing**

The extension does not initialize the Firebase SDK, so it does not need a
separate Firebase Apple app or `GoogleService-Info.plist`. It is nevertheless a
separate Apple signing target and needs its own explicit App ID and matching
provisioning profile.

The main app and the extension must both include the exact same
`KEYCHAIN_ACCESS_GROUP`. Apple documents this entitlement under
[Keychain Access Groups](https://developer.apple.com/documentation/bundleresources/entitlements/keychain-access-groups).

Enabling or changing an Apple capability can invalidate existing provisioning
profiles. Regenerate affected profiles after capability changes. See
[Enable app capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/).

### 4. Create An APNs Authentication Key

In **Apple Developer > Certificates, Identifiers & Profiles > Keys**:

1. Add a key with a descriptive name such as `Orca Dev Firebase APNs`.
2. Enable **Apple Push Notification service**.
3. Configure a team-scoped key, or a topic-specific key that includes the main
   app's topic.
4. Select the appropriate environment configuration.
5. Confirm the key.
6. Download the `.p8` file.
7. Record its Key ID and the Apple Team ID.

The `.p8` file can only be downloaded once. Store it in a credential vault and
revoke it if it is exposed. APNs authentication keys can work with development
and production environments. See
[Create a private key](https://developer.apple.com/help/account/keys/create-a-private-key/)
and
[Communicate with APNs using authentication tokens](https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/).

### 5. Register Physical Test Devices

The repository's `fastlane ios firebase` lane exports a **development-signed**
IPA. Every iPhone or iPad that installs that IPA must belong to the Apple team
and be included in the applicable provisioning profile.

For each test device:

1. Connect the device to a Mac and trust the computer.
2. Read the device UDID in Finder or Xcode.
3. Register the device in the Apple Developer portal, or let Xcode automatic
   signing register the connected device.
4. Refresh the development profiles for both the main app and the extension.
5. Rebuild the IPA.

See [Register a single device](https://developer.apple.com/help/account/devices/register-a-single-device)
and
[Distributing to registered devices](https://developer.apple.com/documentation/Xcode/distributing-your-app-to-registered-devices).

Firebase App Distribution can collect tester UDIDs, but adding a new iOS device
still requires registering it with Apple, updating the profile, and rebuilding
the IPA. See
[Register additional iOS devices](https://firebase.google.com/docs/app-distribution/register-additional-devices).

### 6. Optional TestFlight And App Store Connect Setup

FCM development and the repository's Firebase App Distribution development IPA
do not require an App Store Connect API key. The `fastlane ios release` lane and
the iOS release workflow do require additional distribution assets:

- an App Store Connect app record for `IOS_BUNDLE_ID`
- an Apple Distribution certificate and its private key exported as `.p12`
- App Store provisioning profiles for the main app and extension
- an App Store Connect team API key
- the API Key ID, Issuer ID, and one-time-download `.p8` content

Team API keys are broad team credentials and must be stored as CI secrets. See
[App Store Connect API](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api).

## Firebase Project Configuration

### 1. Create A Development Project

Create a developer-owned Firebase project, for example:

```text
orca-<developer>-dev
```

Google Analytics is not required for Orca's FCM path.

### 2. Register The Android App

Add an Android app using `ANDROID_PACKAGE` as the package name. It must exactly
match `expo.android.package` in `mobile/app.json`.

Download the generated `google-services.json`. Do not edit the file manually.

### 3. Register The Apple App

Add an Apple app using `IOS_BUNDLE_ID`. Bundle IDs are case-sensitive and
cannot be changed after registration for that Firebase app.

Download the generated `GoogleService-Info.plist`. See
[Add Firebase to an Apple project](https://firebase.google.com/docs/ios/setup).

### 4. Enable FCM HTTP v1

Enable **Firebase Cloud Messaging API (V1)** for the Firebase/Google Cloud
project. Orca's desktop sender obtains an OAuth 2.0 access token and sends to:

```text
https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send
```

### 5. Upload The APNs Key To Firebase

Open **Firebase Console > Project Settings > Cloud Messaging > Apple app
configuration** and upload:

- the APNs `.p8` file
- the APNs Key ID
- the Apple Team ID

Without this mapping, iOS FCM token acquisition or FCM-to-APNs delivery can
fail. See
[Get started with FCM on Apple platforms](https://firebase.google.com/docs/cloud-messaging/ios/get-started).

### 6. Create The Desktop Sender Service Account

Create a Google Cloud service account such as:

```text
orca-desktop-fcm-sender
```

Grant it:

```text
Firebase Cloud Messaging API Admin
```

Generate a JSON private key and store it outside the repository. Orca parses
the full service-account JSON, requests the
`https://www.googleapis.com/auth/firebase.messaging` scope, and calls the FCM
HTTP v1 API. See
[Authorize FCM HTTP v1 requests](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

Protect the downloaded key on Unix-like systems:

```bash
chmod 600 "$HOME/secure/orca-desktop-fcm-sender.json"
```

### 7. Create The App Distribution Service Account

Create a second Google Cloud service account such as:

```text
orca-app-distribution
```

Grant it:

```text
Firebase App Distribution Admin
```

Generate a JSON private key for Fastlane. See
[Authenticate App Distribution with a service account](https://firebase.google.com/docs/app-distribution/authenticate-service-account.md?platform=android).

Using separate service accounts prevents a leaked test-distribution credential
from also becoming the desktop's push-sending identity.

### 8. Create Tester Groups

In **Firebase Console > App Distribution > Testers & Groups**, create Android
and iOS groups, for example:

```text
android-dev
ios-dev
```

Record each group's alias. Fastlane expects the alias, not necessarily the
display label.

## Update Orca For An Independent Apple Team

The current source contains the existing Apple Team ID, bundle ID, Android
package, and keychain access group in several places. An independent setup
must update every source-of-truth occurrence before regenerating native
projects.

### App Configuration

Update `mobile/app.json`:

- `expo.ios.appleTeamId` to `APPLE_TEAM_ID`
- `expo.ios.bundleIdentifier` to `IOS_BUNDLE_ID`
- `expo.ios.entitlements.keychain-access-groups` to
  `KEYCHAIN_ACCESS_GROUP`
- `expo.android.package` to `ANDROID_PACKAGE`

Keep these Firebase config declarations:

```json
{
  "ios": {
    "googleServicesFile": "./GoogleService-Info.plist"
  },
  "android": {
    "googleServicesFile": "./google-services.json"
  }
}
```

### Shared iOS Notification Key

Replace the existing keychain group with `KEYCHAIN_ACCESS_GROUP` in all of:

- `mobile/src/notifications/ios-notification-key-store.ts`
- `mobile/targets/orca-notification-service/NotificationService.swift`
- `mobile/targets/orca-notification-service/expo-target.config.js`
- `mobile/targets/orca-notification-service/generated.entitlements`

All four values must match. If they drift, the mobile app can register for FCM
but the notification service extension cannot read the decryption key, causing
generic or undecrypted iOS notifications.

### Fastlane Bundle ID

Update:

- `BUNDLE_ID` in `mobile/fastlane/Fastfile`
- the default `app_identifier` in `mobile/fastlane/Appfile`

The Fastfile derives `IOS_EXTENSION_BUNDLE_ID` by appending
`.notification-service` to the main bundle ID.

### Regenerate Native Projects

After changing identifiers and placing the Firebase files, regenerate the
ignored native projects rather than hand-editing generated Xcode or Gradle
files:

```bash
cd mobile
pnpm exec expo prebuild --clean --no-install
npx pod-install ios
```

## Local Toolchain

Install and verify:

- Node.js 24
- pnpm 10.24.x
- Xcode 26.x
- CocoaPods
- JDK 17
- Android Studio and Android SDK
- Ruby 3.1 or later
- Bundler 4.0.11
- a physical iOS device for complete APNs validation

```bash
node --version
pnpm --version
xcodebuild -version
java -version
ruby --version
bundle --version
```

Expo Go is insufficient for end-to-end FCM validation because Orca uses native
React Native Firebase modules and a native notification service extension.

## Install Dependencies

At the repository root:

```bash
pnpm install --frozen-lockfile
```

In the mobile project:

```bash
cd mobile
pnpm install --frozen-lockfile
PATH=/opt/homebrew/opt/ruby/bin:$PATH bundle _4.0.11_ install
```

The checked-in `firebase:*` package scripts assume the Apple Silicon Homebrew
Ruby path `/opt/homebrew/opt/ruby/bin`. On Intel Macs or machines using another
Ruby manager, invoke the pinned bundle directly with the correct Ruby on
`PATH`, or adjust the local command without committing machine-specific paths.

## Place Machine-Local Firebase Files

Copy the downloaded files to:

```text
mobile/google-services.json
mobile/GoogleService-Info.plist
```

Both paths are ignored by Git. Firebase describes client configuration files
as containing non-secret project and app identifiers, but this repository
intentionally excludes them so each developer can point the same branch at an
independent project. Service-account JSON remains a secret regardless.

## Configure Fastlane App Distribution

Create the ignored environment file:

```bash
cd mobile
cp fastlane/.env.example fastlane/.env
```

Fill it with the developer's own values:

```dotenv
FIREBASE_SERVICE_CREDENTIALS_FILE=/absolute/path/orca-app-distribution.json

FIREBASE_ANDROID_APP_ID=<Firebase Android App ID>
FIREBASE_IOS_APP_ID=<Firebase Apple App ID>

FIREBASE_ANDROID_GROUPS=android-dev
FIREBASE_IOS_GROUPS=ios-dev

APPLE_TEAM_ID=<Apple Team ID>
```

Read App IDs from **Firebase Console > Project Settings > General**. Do not
copy the example IDs. At the time this guide was written,
`mobile/fastlane/.env.example` contained an iOS App ID that did not match the
repository owner's active `GoogleService-Info.plist`.

## Configure The Android SDK

When Android Studio has not exported an SDK path for the shell:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

## Configure The Desktop FCM Sender

Start the development desktop app from the repository root:

```bash
pnpm dev-stable-name
```

In Orca, open:

```text
Settings > Notifications > FCM Push (Mobile)
```

Paste the complete `orca-desktop-fcm-sender` service-account JSON and save it.
This is separate from `FIREBASE_SERVICE_CREDENTIALS_FILE`, which authenticates
Fastlane App Distribution.

The desktop stores the credential encrypted with Electron `safeStorage` and
only exposes configured state and the non-secret project ID back to the
renderer.

## Build Native Mobile Apps

### Android

```bash
cd mobile
pnpm exec expo prebuild --clean --platform android --no-install
pnpm android
```

### iOS

```bash
cd mobile
pnpm exec expo prebuild --clean --platform ios --no-install
npx pod-install ios
pnpm ios
```

For an iOS device build, verify in Xcode that:

- the intended Apple team is selected
- automatic signing is enabled for local development
- the main app and `OrcaNotificationService` both sign successfully
- the main app has Push Notifications capability
- both targets have the same Keychain Access Group
- the physical device belongs to the selected team

## Distribute Test Builds Through Firebase

### Android Debug APK

The default lane builds and uploads a debug-signed APK:

```bash
cd mobile
pnpm run firebase:android
```

For the lane's release variant:

```bash
cd mobile
PATH=/opt/homebrew/opt/ruby/bin:$PATH \
  bundle _4.0.11_ exec fastlane android firebase release:true
```

The current release variant is still signed with the Android debug keystore.
Do not treat it as a production Play Store signing setup.

### iOS Development IPA

```bash
cd mobile
pnpm run firebase:ios
```

The current lane uses:

- Release Xcode configuration
- `development` export method
- Xcode automatic signing
- `APPLE_TEAM_ID` from `fastlane/.env`

It does not require App Store Connect API credentials, but the resulting IPA
can only be installed on devices included in the development provisioning
profile.

Increment Android `versionCode` and iOS `buildNumber` deliberately when
publishing subsequent test builds that need to be distinguishable.

## Pair The Mobile App And Register Its Push Token

1. Install a native mobile build containing the new Firebase configuration.
2. Allow notification permission on the device.
3. Enable the mobile app's Push Notifications preference.
4. Open **Settings > Mobile** in the matching Orca desktop instance.
5. Generate a pairing QR code.
6. Scan the QR code from the mobile app.
7. Wait for encrypted pairing to finish.
8. Reconnect once if the push token was not yet available during the first
   permission flow.

After the encrypted WebSocket connection succeeds, the mobile app registers:

- its FCM registration token
- `android` or `ios` platform
- its persistent mobile public key

The desktop stores those fields in its per-device registry. The token is
refreshed idempotently on later connections.

## Understand The FCM Delivery Gate

FCM is a supplemental path, not a duplicate of foreground WebSocket delivery.

- When at least one mobile notification WebSocket listener is active, Orca
  delivers through WebSocket and skips normal FCM fan-out.
- When there are no WebSocket listeners, Orca encrypts the notification and
  sends it through FCM.
- The iOS payload is delivered by FCM through APNs and decrypted in the
  notification service extension.

To validate FCM rather than WebSocket delivery, background or fully close the
mobile app before generating a task-complete or terminal-bell notification.

## Validate Configuration Consistency

### Android Firebase File

```bash
jq -r '.project_info.project_id,
       .client[0].client_info.mobilesdk_app_id,
       .client[0].client_info.android_client_info.package_name' \
  mobile/google-services.json
```

### Apple Firebase File

```bash
/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' \
  mobile/GoogleService-Info.plist
/usr/libexec/PlistBuddy -c 'Print :GOOGLE_APP_ID' \
  mobile/GoogleService-Info.plist
/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' \
  mobile/GoogleService-Info.plist
```

Confirm all of the following:

- the Android and Apple files use the same Firebase project ID
- the Android package matches `mobile/app.json`
- the Apple bundle ID matches `mobile/app.json`
- `FIREBASE_ANDROID_APP_ID` matches the Android config file
- `FIREBASE_IOS_APP_ID` matches the Apple config file
- the desktop service account's `project_id` matches the mobile Firebase
  project

## Validate Device Registration Without Exposing Tokens

For `pnpm dev-stable-name`, inspect the development registry with a projection
that does not print secrets:

```bash
jq 'map({
  name,
  scope,
  pairedAt,
  lastSeenAt,
  pushPlatform,
  hasFcmToken: (.fcmToken != null),
  hasMobilePublicKey: (.mobilePublicKeyB64 != null)
})' \
"$HOME/Library/Application Support/orca-dev/orca-devices.json"
```

A push-capable entry should have:

```text
scope = mobile
lastSeenAt != 0
pushPlatform = android or ios
hasFcmToken = true
hasMobilePublicKey = true
```

## Inspect FCM Logs

Development app:

```bash
tail -f \
  "$HOME/Library/Application Support/orca-dev/logs/fcm-push.log"
```

Packaged app:

```bash
tail -f \
  "$HOME/Library/Application Support/orca/logs/fcm-push.log"
```

The successful flow is:

```text
fcm.fanout-start
fcm.send-attempt
fcm.sent
```

The log path can be overridden for diagnostics with
`ORCA_FCM_PUSH_LOG_PATH`. Never direct it into a tracked repository path.

## Troubleshooting

| Symptom | Check first |
| --- | --- |
| `fcm.mint-failed` | Full service-account JSON, private key validity, and FCM API Admin role |
| FCM 401 or 403 | HTTP v1 API enabled and service-account project/role alignment |
| `credentials-unavailable` | Desktop **Settings > Notifications > FCM Push** status |
| `no-capable-devices` | Notification permission, mobile preference, re-pairing, and token registration |
| iOS reports `apns not registered` | APNs key upload, Push capability, provisioning, and a physical device |
| iOS IPA will not install | Device UDID, Team ID, development profile, and bundle IDs |
| iOS displays generic or encrypted content | Shared keychain group and extension signing |
| Android Google Services build error | Missing `google-services.json` or package mismatch |
| No FCM log while mobile is open | Expected when WebSocket owns foreground delivery |
| Token exists but no delivery | Compare Firebase project IDs across client config and sender account |

## Optional GitHub Actions Setup

Machine-local ignored files are not available in a clean GitHub Actions
checkout. CI must restore them from repository or environment secrets before
`expo prebuild`.

### Existing iOS Release Workflow

`.github/workflows/mobile-ios-release.yml` expects:

```text
GOOGLE_SERVICE_INFO_PLIST_BASE64
APPLE_TEAM_ID
ASC_KEY_ID
ASC_ISSUER_ID
ASC_API_KEY_P8
IOS_DIST_CERT_P12
IOS_DIST_CERT_PASSWORD
```

The App Store Connect and distribution-certificate values belong to the
TestFlight lane. They are not required for local FCM or the development-signed
Firebase App Distribution lane.

### Android Firebase Config Gap

The existing Android release workflow does not restore
`mobile/google-services.json` before `expo prebuild`. An independent CI setup
needs a secret such as:

```text
GOOGLE_SERVICES_JSON_BASE64
```

and a step before prebuild:

```bash
printf '%s' "$GOOGLE_SERVICES_JSON_BASE64" \
  | base64 --decode > google-services.json
```

### App Distribution CI Gap

The repository contains Fastlane App Distribution lanes, but the checked-in
GitHub Actions workflows do not invoke them. A future App Distribution workflow
would need at least:

```text
FIREBASE_SERVICE_CREDENTIALS_JSON_BASE64
FIREBASE_ANDROID_APP_ID
FIREBASE_IOS_APP_ID
FIREBASE_ANDROID_GROUPS
FIREBASE_IOS_GROUPS
APPLE_TEAM_ID
```

Restore the service-account key only into the runner's temporary directory,
point `FIREBASE_SERVICE_CREDENTIALS_FILE` at it, and delete it after use. Do not
store the JSON body directly in a committed `.env` file.

## Known Repository Constraints

The following are current constraints, not generic Firebase requirements:

1. The Apple Team ID and keychain access group are hardcoded in multiple source
   files.
2. An independent Apple environment cannot be selected through `.env` alone.
3. `mobile/fastlane/.env.example` contains an iOS App ID that may be stale.
4. The Android release workflow does not restore `google-services.json`.
5. The Firebase App Distribution lanes are not connected to GitHub Actions.
6. The package scripts assume the Apple Silicon Homebrew Ruby path.
7. The iOS Firebase lane uses development signing rather than ad hoc signing.
8. Every iOS tester device must be registered with Apple before installation.
9. Expo Go cannot exercise Orca's complete native FCM path.

Treat these constraints as explicit setup steps until the project gains a
first-class environment configuration layer.

## Completion Checklist

### Apple Developer

- [ ] The developer belongs to a paid Apple Developer team.
- [ ] Xcode is signed in to the intended team.
- [ ] An Apple Development certificate with its private key exists locally.
- [ ] The main explicit App ID matches `IOS_BUNDLE_ID`.
- [ ] The extension explicit App ID matches `IOS_EXTENSION_BUNDLE_ID`.
- [ ] Push Notifications is enabled for the main App ID.
- [ ] Keychain Sharing is enabled and aligned for both targets.
- [ ] The APNs `.p8`, Key ID, and Team ID are stored securely.
- [ ] Every physical test device is registered with Apple.
- [ ] Development profiles include the app, extension, certificates, devices,
  and current capabilities.

### Firebase And Google Cloud

- [ ] A non-production Firebase project exists for the developer environment.
- [ ] The Android app is registered with `ANDROID_PACKAGE`.
- [ ] The Apple app is registered with `IOS_BUNDLE_ID`.
- [ ] `google-services.json` and `GoogleService-Info.plist` were downloaded from
  that project.
- [ ] Firebase Cloud Messaging API (V1) is enabled.
- [ ] The APNs key is uploaded to the Firebase Apple app configuration.
- [ ] The desktop sender service account has Firebase Cloud Messaging API
  Admin.
- [ ] The App Distribution service account has Firebase App Distribution
  Admin.
- [ ] Android and iOS App Distribution tester group aliases exist.

### Local Orca Configuration

- [ ] All Team ID, bundle ID, package, and keychain group occurrences were
  updated for an independent environment.
- [ ] The two Firebase client configuration files are present and ignored.
- [ ] `fastlane/.env` points to the developer's App Distribution account and
  Firebase App IDs.
- [ ] `expo prebuild --clean` completed after identifier changes.
- [ ] CocoaPods completed for iOS.
- [ ] Android and iOS native builds both succeed.
- [ ] The desktop sender service-account JSON shows **Configured** in Orca.
- [ ] A native mobile build pairs with the matching desktop instance.
- [ ] The device registry shows a platform, FCM token, and mobile public key.
- [ ] A background or terminated-app test produces `fcm.sent`.
- [ ] Android displays the decrypted notification.
- [ ] iOS runs the notification service extension and displays the decrypted
  notification.

### CI, If Enabled

- [ ] The Apple Firebase plist is restored before iOS prebuild.
- [ ] The Android Firebase JSON is restored before Android prebuild.
- [ ] Signing and API credentials exist only as encrypted CI secrets.
- [ ] Service-account files are written only to an ephemeral runner path.
- [ ] The chosen workflow invokes the intended TestFlight or App Distribution
  lane rather than assuming they are interchangeable.
