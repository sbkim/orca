# Changelog

All notable changes to Orca are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **FCM supplemental mobile push channel (SPEC-FCM-001).** Firebase Cloud
  Messaging now delivers mobile push notifications when no mobile WebSocket
  subscriber is connected, so a backgrounded phone still receives
  agent-completion notifications. The WebSocket channel remains the primary
  foreground transport; FCM fires only when the runtime reports zero mobile
  notification listeners (`getMobileNotificationListenerCount() === 0`), so
  foreground behavior and WS delivery are unchanged (AC-FCM-001, AC-FCM-002a/b).
  - **Backgrounded delivery + iOS killed-state via Notification Service
    Extension.** Android FCM delivery is best-effort for apps in the background;
    force-stop (user-initiated kill) is excluded at the OS level — FCM data
    cannot run when the app process is force-stopped. iOS now uses a Notification
    Service Extension that decrypts the AES-256-GCM ciphertext via a
    keychain-access-groups shared symmetric key (no plaintext exposure), so
    notifications are delivered even when the iOS app is in killed state while
    preserving the data-only/E2EE invariant. This updates amendment decision #6:
    an E2EE-preserving NSE was implemented rather than treating force-quit wake
    as out of scope. On-device verified 2026-07-13 (Galaxy A50 / iPhone 16e).
  - **iOS Notification Service Extension (E2EE-preserving mechanism).** The
    desktop encrypts iOS pushes with `encryptIosPushPayload` into an AES-256-GCM
    envelope (version byte + 12-byte nonce + ciphertext + 16-byte GCM tag, AAD
    `"orca-ios-push-v1"`); the per-desktop symmetric key is shared to the
    extension via a `keychain-access-groups` entitlement, and a non-secret
    `pushKeyId` (SHA-256 of the shared key) is sent in the payload so the
    extension selects the right key. APNs is pinned to a priority-10 alert with
    `mutable-content`, which invokes the extension to decrypt and re-render the
    visible notification without plaintext ever leaving the device
    (`mobile/targets/orca-notification-service/NotificationService.swift`,
    `mobile/src/notifications/ios-notification-key-store.ts`,
    `src/main/runtime/push-payload-crypto.ts` `encryptIosPushPayload`,
    `src/main/runtime/fcm-sender.ts`).
  - **End-to-end encryption preserved (REQ-FCM-019).** Each paired device
    registers a long-lived Curve25519 keypair (`mobile/src/transport/push-keypair.ts`)
    that is distinct from the per-connection ephemeral WebSocket session key.
    The desktop derives a persistent FCM-shared key from its own persistent
    E2EE secret and the mobile's persistent public key
    (`src/main/runtime/push-payload-crypto.ts`), so WebSocket forward secrecy is
    preserved. Messages are FCM v1 **data-only** (no `notification` field); the
    OS never sees plaintext and the mobile app decrypts and renders locally
    (`mobile/src/notifications/push-payload-decrypt.ts`,
    `mobile/src/notifications/fcm-push-receiver.ts`) (AC-FCM-003).
  - **Per-device token registration.** A `notifications.registerPushToken` RPC
    persists the FCM/APNs token, platform, and mobile persistent public key on
    the paired `DeviceEntry`
    (`src/main/runtime/rpc/methods/notifications.ts`,
    `src/main/runtime/device-registry.ts`). Token refresh is idempotent and
    does not clear the persistent public key (AC-FCM-004a/b).
  - **Platform-aware delivery.** Android receives FCM direct messages at HIGH
    priority for prompt background delivery; iOS is brokered through APNs via
    FCM (content-available background data, `apns-priority: 5` with `apns-push-type: background`) for
    best-effort backgrounded delivery (force-quit excluded). Both stay data-only
    (`src/main/runtime/fcm-sender.ts`) (AC-FCM-006a/b — code-complete and
    integration-verified; **on-device delivery verification is deferred to
    post-merge**).
  - **Post-merge remediation (unreleased cycle).** This same unreleased cycle
    includes a post-merge remediation addressing 9 defects + cleanup (recorded in
    the SPEC-FCM-001 in-place amendment commit c3ec2ec6e): desktop FCM tests
    51/51 passing, mobile TypeScript 0 errors, mobile lint 0, mobile tests 1530/2
    skip. Residual verification pending: real CI run of the new plist-restore
    step, new Apple cert/provisioning for `com.omninetworks.orca.mobile`, and
    iOS on-device E2E testing.
  - **OAuth2 + credential handling.** The desktop FCM sender mints OAuth2
    access tokens via `google-auth-library` for the `firebase.messaging` scope,
    caches them ahead of expiry, and posts to the FCM v1
    `projects/{project}/messages:send` endpoint
    (`src/main/runtime/fcm-sender.ts`). The service-account JSON is encrypted
    at rest with Electron `safeStorage`
    (`src/main/persistence.ts`, `fcmServiceAccountJson`); the credential
    markers are fragment-assembled in source so the repo's secret-leak
    sentinel stays clean (AC-FCM-007a/b). Every FCM send is fire-and-log: HTTP
    / network / mint errors are redacted (bearer tokens, Authorization header,
    PEM blocks, and credential JSON fields stripped) and never throw into the
    notification dispatch loop (AC-FCM-007c).
  - **4KB graceful degradation.** Payloads exceeding the FCM ~4KB `data` cap
    are shed in priority order — metadata dropped first, then body truncated,
    and the send is dropped rather than emitting a malformed message
    (`src/main/runtime/push-payload-crypto.ts`) (AC-FCM-008).
  - **Single push toggle + cross-channel dedupe.** FCM-delivered notifications
    route through the same local-notification path as the WebSocket
    subscriber, so the single `notificationId` dedupe map
    (`mobile/src/notifications/mobile-notifications.ts`) suppresses duplicates
    when a reconnecting WebSocket already delivered the same notification, and
    the existing permission/toggle gate applies identically (AC-FCM-005,
    AC-FCM-009).

[Unreleased]: https://github.com/stablyai/orca/compare/HEAD
