---
id: SPEC-FCM-001
title: "FCM 푸시 알림 채널 통합"
version: "0.1.0"
status: in-progress
created: 2026-07-11
updated: 2026-07-12
amendment_of: SPEC-FCM-001
author: manager-spec
priority: P1
phase: "v0.0.27 target"
module: "src/main/runtime, mobile/src"
lifecycle: spec-anchored
tier: L
tags: "fcm, push-notifications, mobile, e2ee, android, ios"
---

# SPEC-FCM-001 — FCM 푸시 알림 채널 통합

## §A. 개요

### A.1 목적

본 SPEC은 FCM(Firebase Cloud Messaging)을 기존 WebSocket RPC 알림 채널의 **보조 푸시 채널**로 통합하는 것을 규정한다. 전경/실시간 알림은 기존 WebSocket RPC(포트 6768, `notifications.subscribe`)를 유지하고, 모바일 앱이 백그라운드이거나 실행 중이지 않을 때의 전달을 FCM이 담당한다.

### A.2 배경

현재 알림 설계는 WS 영구 연결이 푸시를 겸한다(`src/main/runtime/rpc/methods/notifications.ts` 주석). 그러나 iOS/Android 가 백그라운드에서 JS 타이머를 suspend하고 소켓을 silent kill 하므로(`mobile/src/transport/connection-revival-triggers.ts`), 앱 백그라운드 시 알림 도달률이 보장되지 않는다. FCM은 이 도달률 갭을 메운다.

### A.3 핵심 설계 결정 (RESOLVED)

1. **FCM payload 는 영속 FCM-공유 키로 암호화 (persistent-keypair design)**: FCM `data` 필드에 `src/shared/e2ee-crypto.ts`의 XSalsa20-Poly1305 (`nacl.box.after`) 로 암호화된 ciphertext를 실어 보낸다. 모바일 앱은 로컬에서 복호화 후 WS 라운드트립 없이 로컬 노티를 표시한다. Google/Apple 은 ciphertext 만 본다 — Orca의 E2EE 속성이 보존된다. 암호화 키는 **WS 세션 키와 분리된 영속 키**다 (상세는 REQ-FCM-019 및 design.md §C.1):
   - **모바일**은 장기 생존(non-ephemeral) Curve25519 키페어를 생성해 자체 보안 저장소에 영속하고, 공개 키를 페어링 시 `DeviceEntry.mobilePublicKeyB64` 로 등록한다 (신규 필드).
   - **데스크톱**은 자신의 영속 키페어(`src/main/runtime/e2ee-keypair.ts`, `orca-e2ee-keypair.json` 에 영속, 공개 키는 이미 페어링 QR에 포함)의 비밀키 × 모바일 영속 공개 키에서 영속 FCM-공유 키를 도출한다: `sharedFcmKey = deriveSharedKey(desktopPersistentSecret, mobilePersistentPublic)` (wrapper — `src/shared/e2ee-crypto.ts`가 내부적으로 tweetnacl `(publicKey, secretKey)` 순서로 변환).
   - WS 세션은 여전히 모바일의 **ephemeral** 키페어를 사용한다(`rpc-client.ts:398-401`) — WS forward secrecy 보존.
2. **FCM 전송 트리거 = WS 구독자 수 게이트**: 데스크톱은 `getMobileNotificationListenerCount() === 0` (활성 `notifications.subscribe` WS 구독자 없음 = 앱 백그라운드/미실행) 일 때만 FCM으로 전송한다. WS 구독자가 연결되어 있으면 WS 로만 전달하여 교차 채널 중복을 설계적으로 원천 차단하고 FCM 할당량을 최소화한다.

## §B. 용어 정의

| 용어 | 정의 |
|------|------|
| WS 채널 | 기존 `notifications.subscribe` WebSocket RPC (포트 6768). 전경/실시간 전담. |
| FCM 채널 | Firebase Cloud Messaging data-only 메시지. 백그라운드/미실행 전달 보조. |
| listener-count 게이트 | `getMobileNotificationListenerCount()` 반환값 기반 FCM 전송 분기 |
| WS 세션 공유 키 | WS 연결마다 모바일의 **ephemeral** 키페어(`rpc-client.ts:398-401`)와 데스크톱 영속 비밀키(`e2ee-keypair.ts`)로 도출되는 32바이트 `nacl.box.before` 키. 연결 단위이며 disconnect 시 폐기(forward secrecy). |
| 영속 FCM-공유 키 | 모바일 **영속** 키페어의 비밀키 × 데스크톱 영속 공개키(`DeviceEntry.mobilePublicKeyB64`)로 도출되는 32바이트 `nacl.box.before` 키. WS 연결 무관하게 재도출 가능 — FCM payload 암호화에 사용. WS 세션 키와는 **별개**. |
| 단일 notificationId 네임스페이스 | WS/FCM 양 채널이 공유하는 중복제거 키 공간 |

## §C. GEARS 요구사항

> 본 요구사항은 GEARS 표기(`.claude/skills/moai-workflow-spec/SKILL.md` § GEARS Format)를 따른다. GEARS 키워드(`When`/`While`/`Where`/`The ... shall`)는 영문 verbatim, 설명은 한국어.

### C.1 채널 분기 및 게이트

**REQ-FCM-001** (Ubiquitous) — The system shall deliver mobile notifications via FCM as a complementary channel to the existing WebSocket RPC, where the WebSocket remains the primary foreground/realtime delivery path and FCM serves only background/app-not-running delivery.

**REQ-FCM-002** (State-driven) — **While** `getMobileNotificationListenerCount()` returns zero for the host, the desktop runtime shall dispatch each notification to every paired mobile device that has a registered FCM token via the FCM channel.

**REQ-FCM-003** (Unwanted) — **While** at least one active `notifications.subscribe` WebSocket subscriber is connected for the host, the desktop runtime **shall not** send the same notification via FCM.

**REQ-FCM-015** (Unwanted) — The integration of FCM **shall not** alter the existing WebSocket foreground notification delivery behavior for connected mobile clients (no regression to `src/main/runtime/rpc/methods/notifications.ts` streaming semantics).

### C.2 암호화된 푸시 payload

**REQ-FCM-004** (Ubiquitous) — The desktop FCM sender shall encrypt the notification payload with the persistent FCM-shared key derived per REQ-FCM-019 (XSalsa20-Poly1305 via `nacl.box.after`, reusing `src/shared/e2ee-crypto.ts`) before placing it in the FCM `data` field. This persistent FCM-shared key is distinct from the per-connection WS session key (forward secrecy of WS is preserved).

**REQ-FCM-005** (Ubiquitous) — The desktop FCM sender shall generate a fresh 24-byte random nonce per push message and prepend it to the ciphertext, matching the existing `encryptBytes` bundle format (`nonce(24B) ‖ ciphertext`, base64).

**REQ-FCM-006** (Event-driven) — **When** the encrypted payload would exceed the FCM `data` size ceiling, the desktop runtime shall gracefully degrade (truncate non-essential fields or drop the push while preserving WS delivery) and shall not produce a malformed FCM message.

**REQ-FCM-007** (Event-driven) — **When** an FCM data message arrives on the mobile device, the mobile app shall decrypt the `data` payload with the locally-stored persistent FCM-shared key (mobile persistent secret × desktop persistent public) and display a local notification via `expo-notifications`, without requiring a WebSocket round-trip.

**REQ-FCM-019** (Ubiquitous) — The system shall derive the persistent FCM-shared key from the desktop's long-lived E2EE keypair secret (`src/main/runtime/e2ee-keypair.ts`, persisted in `orca-e2ee-keypair.json`) and a long-lived mobile public key that the mobile app generates once, persists in its secure store, and registers with the desktop at pairing time as a new optional `mobilePublicKeyB64?: string` field on `DeviceEntry` (`src/main/runtime/device-registry.ts`). This FCM-shared key shall be computable at FCM dispatch time without a live WebSocket connection and shall be independent of the per-connection ephemeral WS session key so that WebSocket forward secrecy is preserved.

### C.3 장치 토큰 등록

**REQ-FCM-008** (Event-driven) — **When** a mobile device has completed E2EE pairing and obtained an FCM device token, the mobile app shall send the token to the desktop via a new `notifications.registerPushToken` RPC method (added to `MOBILE_RPC_METHOD_ALLOWLIST`).

**REQ-FCM-009** (Ubiquitous) — The device registry shall persist the per-device FCM token and push platform as new optional fields (`fcmToken?`, `pushPlatform?: 'android' | 'ios'`) on `DeviceEntry` (`src/main/runtime/device-registry.ts`), stored in `orca-devices.json` with the existing hardened file permissions.

**REQ-FCM-010** (Event-driven) — **When** `expo-notifications` emits a refreshed device push token, the mobile app shall re-register the new token with the desktop via `notifications.registerPushToken`.

### C.4 데스크톱 FCM 송신자 및 자격 증명

**REQ-FCM-011** (Ubiquitous) — The desktop FCM sender shall mint a Google OAuth2 access token from the stored FCM service-account JSON (RS256 JWT → Google OAuth2 token endpoint) and use it to authorize `POST https://fcm.googleapis.com/v1/projects/{project}/messages:send`.

**REQ-FCM-012** (Ubiquitous) — The desktop runtime shall encrypt the FCM service-account JSON at rest using Electron `safeStorage` (`src/main/persistence.ts` precedent) and shall neither log the service-account contents nor commit them to version control.

**REQ-FCM-014** (Event-driven) — **When** an FCM HTTP send fails (non-2xx response or network error), the desktop runtime shall log a redacted diagnostic (no credential leakage) and continue without crashing the notification dispatch loop.

### C.5 중복제거 및 플랫폼 지원

**REQ-FCM-013** (Ubiquitous) — The system shall use a single `notificationId` namespace across both WebSocket and FCM delivery channels so that the existing mobile dedup map (`scheduledNotificationsByHostAndNotificationId`, keyed `${hostId}:${notificationId}`) suppresses any cross-channel duplicate.

**REQ-FCM-016** (Capability gate) — **Where** the target device's `pushPlatform` is `android`, the desktop runtime shall send via FCM direct transport; **where** the target device's `pushPlatform` is `ios`, the desktop runtime shall send via APNs transport brokered through FCM (`message.android` / `message.apns` fields respectively).

### C.6 권한 UX

**REQ-FCM-017** (Event-driven) — **When** the user has not yet granted the platform notification permission, the mobile app shall request notification permission via the existing `expo-notifications` permission flow (`ensureNotificationPermissions`) before registering the FCM token with the desktop.

**REQ-FCM-018** (Capability gate) — **Where** the existing `loadPushNotificationsEnabled()` preference (`mobile/src/storage/preferences.ts`, backend = `@react-native-async-storage/async-storage`, key `orca:pushNotificationsEnabled`) returns `false`, the mobile app shall not register an FCM token with the desktop and shall not display FCM-delivered notifications. The existing single toggle governs FCM delivery too — no new separate control is introduced (resolved decision, see plan.md §E).

## §D. 제약사항 (Constraints)

### D.1 크로스 플랫폼 (AGENTS.md)

- Android (FCM 직접) + iOS (APNs via FCM) 양 플랫폼 지원. 플랫폼 의존 동작은 런타임 체크 뒤에 둘 것. 하드코딩 금지.
- 단일 `notificationId` 네임스페이스가 양 플랫폼에서 동일하게 동작해야 한다.

### D.2 SSH 사용 사례 (AGENTS.md)

- FCM 송신자는 Electron main 프로세스에서 동작한다. SSH-원격 시나리오에서도 데스크톱 main 프로세스는 로컬이므로 FCM 송신 경로는 그대로 유지된다. 영속 FCM-공유 키는 페어링 시 `DeviceEntry.mobilePublicKeyB64` 등록으로 확립되어 WS 라이브 연결 무관하게 재도출 가능하므로 SSH 경로와 무관하다.

### D.3 보안 (AGENTS.md, verification-claim-integrity)

- FCM service-account JSON은 비밀 — `safeStorage` 암호화 저장, 로그/커밋 금지, 입력 검증.
- E2EE 속성 보존 필수 — FCM payload 는 반드시 기존 공유 키로 암호화될 것. 평문 전송 금지.
- nonce 재사용 절대 금지 — push 메시지마다 24바이트 랜덤 nonce.

### D.4 호환성 (AGENTS.md)

- Git 2.25 / Git provider 호환성에 본 SPEC이 직접 영향을 주지는 않으나, 신규 git 가정을 도입하지 않는다.
- `expo-notifications ^55.0.22` 이미 의존성 존재 — 본 SPEC이 `expo-notifications` major bump를 요구하지 않는다.

### D.5 명명 (AGENTS.md)

- 신규 파일에 `helpers`/`utils`/`common`/`misc` 같은 모호한 이름 사용 금지. 구체적 도메인 개념 사용 (예: `fcm-sender.ts`, `push-payload-crypto.ts`, `push-token-registry.ts`).

### D.6 비기능 요구사항

- FCM 송신은 알림 dispatch 루프를 블로킹하지 않아야 한다 (비동기, fire-and-log-error).
- 4KB FCM data 한계 준수.
- FCM 할당량 최소화 — listener-count 게이트로 불필요한 전송 차단.

## §E. 수락 기준 요약

상세 시나리오와 추적성 매트릭스는 `acceptance.md` §B/§D 가 권위 있는 SSOT다. 본 요약은 `acceptance.md` §B와 정확히 일치해야 한다 (drift 방지).

- WS 회귀 없음: REQ-FCM-015 → AC-FCM-001
- listener-count 게이트: REQ-FCM-002 → AC-FCM-002a, REQ-FCM-003 → AC-FCM-002b
- 암호화 payload 왕복 + 영속 FCM 키 도출: REQ-FCM-004, 005, 007, 019 → AC-FCM-003
- 토큰 등록: REQ-FCM-008, 009 → AC-FCM-004a, REQ-FCM-010 → AC-FCM-004b
- 중복제거: REQ-FCM-013 → AC-FCM-005
- Android + iOS 전달: REQ-FCM-016 → AC-FCM-006a, AC-FCM-006b
- 자격 증명 안전 + 에러 처리: REQ-FCM-011 → AC-FCM-007a, REQ-FCM-012 → AC-FCM-007b, REQ-FCM-014 → AC-FCM-007c
- 4KB 한계: REQ-FCM-006 → AC-FCM-008
- 권한/토글 게이트: REQ-FCM-017, 018 → AC-FCM-009
- REQ-FCM-001 (framing): AC-FCM-001, AC-FCM-002a, AC-FCM-002b 가 분해된 보조채널 속성을 검증 (framing requirement — 본 요구사항은 단일 AC 가 아닌 하위 REQ-002/003/015 의 AC 들로 검증됨)

> **AC-FCM-006 범위 보정 (amendment #6)**: AC-FCM-006a/b는 **백그라운드(best-effort) 전달**만을 주장한다. iOS/Android 앱이 포어그라운드에서 사용자에 의해 종료(force-quit / killed)된 상태에서의 전달은 주장하지 않는다 — `content-available` 백그라운드 푸시는 force-quit 된 앱을 wake 시키지 않는다 (Apple APNs 계약). NSE(Notification Service Extension) 기반 force-quit wake는 본 범위 밖이다: NSE가 평문 payload에 접근하려면 OS가 ciphertext 대신 평문을 보게 되어 §A.3.1 data-only / E2EE 불변조를 위반한다. 추가로 모바일 수신부는 백그라운드 data push 수신 시 full React root를 마운트하거나 RPC/연결 effect를 발생시키지 않도록 `isHeadless` / headless 모드 게이트를 적용해야 한다 (불필요한 리소스 소비 및 사이드 이펙트 방지).

## §F. 범위 외 (Out of Scope)

### Out of Scope — 백엔드 송신 서버

- Orca 클라우드 백엔드/송신 서버를 새로 구축하지 않는다. FCM 송신자는 데스크톱 main 프로세스에 한정한다 (`src/relay/` 로컬 릴레이를 클라우드로 승격하지 않는다).

### Out of Scope — 기존 WS 포어그라운드 경로 변경

- `src/main/runtime/rpc/methods/notifications.ts`의 `notifications.subscribe` 스트리밍 의미론, `subscribeToDesktopNotifications` 모바일 수신 로직의 포어그라운드 동작을 변경하지 않는다. FCM은 보조 채널로만 추가된다.

### Out of Scope — 알림 소스 확장

- 새로운 알림 소스(`DesktopNotificationSource`)를 추가하지 않는다. 기존 `'agent-task-complete' | 'terminal-bell' | 'test'` 소스가 FCM 경로로도 동일하게 전달된다.

### Out of Scope — 데스크톱 미실행 시 알림

- 데스크톱 main 프로세스가 종료된 상태에서의 알림 생성/전달은 본 범위 밖이다. 알림 소스 자체가 데스크톱에서 발생하므로 데스크톱 종료 = 알림 없음은 논리적으로 일관된다.

### Out of Scope — 리치 미디어 payload

- FCM notification 메시지(제목/본문/이미지를 FCM이 렌더링)를 사용하지 않는다. data-only 메시지 + 모바일 로컬 렌더링에 한정한다 (E2EE 보존 조건). 이미지/사운드 커스터마이징은 future work.

## §G. 의존성

- `depends_on`: 없음 (신규 기능).
- `related_specs`: 없음 (`.moai/specs/` 최초 SPEC).

## §H. HISTORY

| 날짜 | 버전 | 변경 | 저자 |
|------|------|------|------|
| 2026-07-11 | 0.1.0 | 최초 draft 작성 (plan-phase) | manager-spec |
| 2026-07-11 | 0.1.1 | iteration 2 revision (plan-auditor FAIL 0.77 → 재심사 대상): D1/D4 영속 FCM-공유 키 설계로 교정(REQ-FCM-004 재작성 + REQ-FCM-019 신규), D3 REQ-FCM-001 추적성 framing 표기, D5 REQ-FCM-014 라벨 (Event-driven) 교정, D8 REQ-FCM-018 단일 토글로 확정, D9 §E 요약 동기화 | manager-spec |

### Amendments

#### Amendment #1 — post-merge sync-auditor remediation (2026-07-12)

- **prior status**: `implemented`
- **prior version**: `0.1.0`
- **prior_completed_sha**: `unknown` (SPEC artifacts are working-tree only; `.moai/` is untracked — not yet committed to git at amendment time)
- **amendment transition**: `implemented → in-progress` (in-place amendment per `.claude/rules/moai/development/spec-frontmatter-schema.md` § Status Transition Ownership Matrix `completed → in-progress (amendment)` row)
- **rationale**: post-merge sync-auditor / code review identified 9 defects + 1 cleanup item against the `implemented` SPEC body. The SPEC body is re-opened in-place to record the remediation scope and correct the AC-FCM-006 best-effort delivery scope. Code/CI remediation is tracked under a separate manager-develop delegation; this amendment covers ONLY the SPEC body (`spec.md` + `acceptance.md`).
- **scope** (9 defects + 1 cleanup):
  - **#1** FCM token registration timing — mark device as registered only on successful RPC ack; treat push-toggle-on as a registration trigger (not only pairing).
  - **#2** `onTokenRefresh` subscription → re-register the refreshed token (REQ-FCM-010 closure — the subscription was missing in the `implemented` build).
  - **#3** push-keypair secret migration AsyncStorage → `expo-secure-store` (iOS Keychain, background-accessible). Defect was implementation drift, NOT a REQ-FCM-019 defect — REQ-FCM-019 already says "secure store" and is correct; the drift is that the `implemented` build used AsyncStorage instead.
  - **#4** CI restore `GoogleService-Info.plist` from base64 secret before EAS prebuild.
  - **#5** bundle id unify to `com.omninetworks.orca.mobile` (Appfile default + Android package name).
  - **#6** AC-FCM-006 best-effort scope correction + `isHeadless` gate (THIS amendment — `spec.md` §E note + `acceptance.md` AC-FCM-006a/b wording). iOS/Android FCM delivery is best-effort for **backgrounded** apps, NOT force-quit/killed apps; NSE-based force-quit wake is explicitly out of scope (would require OS-visible plaintext, breaking the data-only / E2EE invariant in §A.3.1).
  - **#7** `mobile/app/index.tsx` max-lines extraction (no `max-lines` disable / per-file bump per AGENTS.md).
  - **#8** FCM 4KB budget measured against the **full final data map** (not ciphertext alone) — nonce + ciphertext + all keyed fields.
  - **#9** FCM notification tap → worktree deeplink (WS parity restoration — tapping an FCM-delivered local notification should route to the originating worktree, matching WS-channel tap behavior).
  - **cleanup** remove `fcm:testDispatch` test IPC (4 surfaces: main handler, preload exposure, renderer API type, settings UI button).
- **affected REQ IDs**: REQ-FCM-008, REQ-FCM-009, REQ-FCM-010, REQ-FCM-016, REQ-FCM-018, REQ-FCM-019 (REQ-FCM-019 wording unchanged — defect #3 was implementation drift, not a REQ defect). AC-FCM-006a, AC-FCM-006b wording corrected.
