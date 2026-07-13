---
id: SPEC-FCM-001
title: "FCM 푸시 알림 채널 통합 — 수락 기준"
version: "0.1.0"
status: draft
created: 2026-07-11
updated: 2026-07-12
author: manager-spec
tier: L
---

# SPEC-FCM-001 Acceptance — 수락 기준

> 본 문서는 `spec.md` §C 요구사항(REQ-FCM-001..018)에 대한 관측 가능한 수락 기준을 Given-When-Then 시나리오로 정의한다. 모든 AC는 기계적으로 검증 가능해야 한다.

## §A. 심각도 분류

- **P0 (Must)**: 회귀 차단, 보안, E2EE. 실패 시 SPEC 미충족.
- **P1 (Should)**: 핵심 기능. 실패 시 심각한 기능 결손.
- **P2 (Nice)**: 품질 강화. 실패 시 추적 항목.

## §B. 추적성 매트릭스

| AC ID | 매핑 REQ | 시나리오 | 심각도 | 마일스톤 |
|-------|----------|----------|--------|----------|
| AC-FCM-001 | REQ-FCM-015 | WS 포어그라운드 회귀 없음 | P0 | M7 |
| AC-FCM-002a | REQ-FCM-002 | WS 구독자 없을 때 FCM 전송 | P0 | M4 |
| AC-FCM-002b | REQ-FCM-003 | WS 구독자 있을 때 FCM 미전송 | P0 | M4 |
| AC-FCM-003 | REQ-FCM-004, 005, 007, 019 | 영속 FCM 키 암호화 payload 왕복 | P0 | M2, M5 |
| AC-FCM-004a | REQ-FCM-008, 009 | 토큰 등록 RPC + DeviceEntry 저장 | P0 | M1 |
| AC-FCM-004b | REQ-FCM-010 | 토큰 갱신 재등록 | P1 | M1 |
| AC-FCM-005 | REQ-FCM-013 | 단일 notificationId 중복제거 | P0 | M5 |
| AC-FCM-006a | REQ-FCM-016 | Android FCM 직접 전달 | P0 | M6 |
| AC-FCM-006b | REQ-FCM-016 | iOS APNs via FCM 전달 | P0 | M6 |
| AC-FCM-007a | REQ-FCM-011 | OAuth2 mint + messages:send | P0 | M3 |
| AC-FCM-007b | REQ-FCM-012 | service-account safeStorage 암호화 | P0 | M3 |
| AC-FCM-007c | REQ-FCM-014 | FCM HTTP 에러 redact/비블로킹 | P1 | M3 |
| AC-FCM-008 | REQ-FCM-006 | 4KB 초과 시 graceful degrade | P1 | M2 |
| AC-FCM-009 | REQ-FCM-017, 018 | 권한/토글 게이트 | P1 | M5 |

> **REQ-FCM-001 (framing requirement) 추적성**: REQ-FCM-001 은 단일 AC 가 아닌 하위 REQ-002/003/015 의 AC 들로 분해 검증된다 — framing 속성(보조 채널 도입, WS 포어그라운드 유지, FCM 백그라운드 보조)은 AC-FCM-001 (WS 회귀 없음), AC-FCM-002a (WS 부재 시 FCM 전송), AC-FCM-002b (WS 있을 시 FCM 미전송) 가 집합적으로 검증한다. 별도 단일 AC 행은 추가하지 않는다 (D3 결함 — framing 분해 방식으로 해결).

## §C. 품질 게이트 (Definition of Done)

- 모든 P0 AC PASS (관측 가능한 증거: 테스트 출력, grep sentinel, 로그)
- TRUST 5: 테스트 커버리지 85%+ (변경 패키지), 린트 clean, 타입 체크 clean
- 보안: service-account JSON grep sentinel (로그/커밋 부재)
- 크로스 플랫폼: Android + iOS 양단 E2E 전달 확인

## §D. 수락 시나리오 (Given-When-Then)

### AC-FCM-001 — WS 포어그라운드 회귀 없음 (P0)

**Given** 모바일 앱이 WS(`notifications.subscribe`)에 활성 구독자로 연결되어 있다.
**When** 데스크톱이 `dispatchMobileNotification({ source: 'agent-task-complete', notificationId: 'n1', ... })` 호출한다.
**Then** 기존 WS 스트리밍 경로(`src/main/runtime/rpc/methods/notifications.ts`)를 통해 모바일이 이벤트를 수신하고, 동작이 SPEC-FCM-001 도입 전과 동일하다 (전경 로컬 노티 표시, 지연/손실 없음).

**검증**: 회귀 테스트 — `notifications.subscribe` 통합 테스트 통과, 도입 전 baseline 과 byte-identical 이벤트 수신.

### AC-FCM-002a — WS 구독자 없을 때 FCM 전송 (P0)

**Given** 호스트의 `getMobileNotificationListenerCount()` 가 `0` 이고, 페어링된 장치 중 `fcmToken` 이 등록된 장치가 존재한다.
**When** 데스크톱이 `dispatchMobileNotification({ notificationId: 'n2', ... })` 호출한다.
**Then** 각 FCM-등록 장치에 대해 암호화된 payload 가 FCM `messages:send` 로 전송된다 (HTTP POST 관측).

**검증**: 단위 테스트 — `getMobileNotificationListenerCount` mock = 0 일 때 `fcm-sender.send` 호출 확인.

### AC-FCM-002b — WS 구독자 있을 때 FCM 미전송 (P0)

**Given** 호스트의 `getMobileNotificationListenerCount()` 가 `1` 이상이다.
**When** 데스크톱이 `dispatchMobileNotification(...)` 호출한다.
**Then** `fcm-sender.send` 는 호출되지 않는다 (FCM 전송 0건). WS 로만 전달.

**검증**: 단위 테스트 — listener count ≥ 1 일 때 `fcm-sender.send` 미호출 assertion.

### AC-FCM-003 — 영속 FCM 키 암호화 payload 왕복 (P0)

**Given** 페어링 시 모바일 영속 공개 키가 `DeviceEntry.mobilePublicKeyB64` 에 등록되어 있고, 데스크톱이 자신의 영속 키페어(`e2ee-keypair.ts`) 비밀키 × 모바일 영속 공개 키에서 영속 FCM-공유 키를 도출할 수 있다 (REQ-FCM-019). 이 키는 WS 연결 여부와 무관하게 재도출 가능하다.
**When** 데스크톱이 notification payload 를 영속 FCM-공유 키로 암호화하여 FCM data 에 실어 보내고, 모바일이 수신한다.
**Then**
1. 데스크톱: `encryptBytes` 재사용, base64 payload, nonce 24바이트 랜덤 (매 메시지 상이)
2. 모바일: 동일 영속 FCM-공유 키(모바일 영속 비밀키 × 데스크톱 영속 공개키)로 복호화 성공 → 원본 payload 와 byte-identical
3. 모바일: WS 라운드트립 없이 로컬 노티 표시 (WS 연결 해제 상태에서도 왕복 성공 — WS 세션 키와 독립)
4. FCM data 필드 외에 평문 알림 내용 누출 부재 (네트워크 캡처 검증)
5. 영속 FCM-공유 키 도출의 재현성: 동일 키페어 쌍에서 매번 동일 32바이트 키 도출 (WS 연결 상태 무관)

**검증**: 단위 테스트(영속 키 도출 재현성 + 암호화/복호화 왕복), 통합 테스트(WS 연결 해제 상태에서 FCM data payload 복호화), nonce uniqueness 테스트(N회 전송 시 N개 상이 nonce), WS 세션 키 ≠ 영속 FCM 키 분리 검증.

### AC-FCM-004a — 토큰 등록 RPC + DeviceEntry 저장 (P0)

**Given** 모바일이 E2EE 페어링을 완료(`e2ee_authenticated`)하고 `getDevicePushTokenAsync()` 로 토큰을 획득했다.
**When** 모바일이 `notifications.registerPushToken({ token: 'abc', platform: 'android' })` RPC 호출한다.
**Then**
1. 데스크톱이 `DeviceRegistry` 의 해당 `DeviceEntry` 에 `fcmToken='abc'`, `pushPlatform='android'` 갱신
2. `orca-devices.json` 에 갱신 반영 (권한 강화 유지)
3. 레거시 레지스트리(신규 필드 부재) 로드 시 `undefined` 처리 호환

**검증**: 단위 테스트 — RPC 호출 후 레지스트리 상태 확인, 레거시 파일 호환 로드.

### AC-FCM-004b — 토큰 갱신 재등록 (P1)

**Given** 장치가 이미 `fcmToken='old'` 로 등록되어 있다.
**When** `expo-notifications` 가 갱신된 토큰 `'new'` 를 emit 하고 모바일이 재등록 RPC 호출한다.
**Then** `DeviceEntry.fcmToken` 이 `'new'` 로 교체됨 (멱등 — 중복 갱신 시에도 단일 최신 토큰).

**검증**: 단위 테스트 — 갱신 시 덮어쓰기, 동일 토큰 재전송 시 no-op.

### AC-FCM-005 — 단일 notificationId 중복제거 (P0)

**Given** 동일 `notificationId='n3'` 가 WS 와 FCM 양채널로 모바일에 도달할 수 있는 상황 (예: WS 구독자 접속과 FCM 전송 경쟁).
**When** 모바일이 동일 `notificationId` 의 이벤트를 두 경로로 수신한다.
**Then** 기존 중복제거 맵(`scheduledNotificationsByHostAndNotificationId`, 키 `${hostId}:n3`)이 첫 도착만 로컬 노티로 표시하고 두 번째는 억제한다.

**검증**: 통합 테스트 — 동일 notificationId 두 경로 수신 시 로컬 노티 1건만 표시.

### AC-FCM-006a — Android FCM 직접 전달 (P0)

**Given** `DeviceEntry.pushPlatform='android'` 인 장치.
**When** 데스크톱이 FCM 메시지 전송 시 `message.android` 필드 구성.
**Then** Android 기기가 백그라운드 상태 (포어그라운드 종료/force-quit 제외, best-effort) 에서 FCM data 메시지 수신 → 로컬 복호화 → `orca-desktop` 채널 로컬 노티 표시.

**검증**: E2E — Android 기기(또는 에뮬레이터) 백그라운드 시 알림 수신. force-quit/killed 상태 전달은 주장하지 않음 (best-effort, 백그라운드만). 수신부는 `isHeadless` 게이트로 백그라운드 data push 시 React root 마운트/RPC effect를 억제해야 한다.

### AC-FCM-006b — iOS APNs via FCM 전달 (P0)

**Given** `DeviceEntry.pushPlatform='ios'` 인 장치.
**When** 데스크톱이 FCM 메시지 전송 시 `message.apns` 필드 구성 (APNs brokered via FCM).
**Then** iOS 기기가 백그라운드 상태 (포어그라운드 종료/force-quit 제외, best-effort) 에서 FCM/APNs data 메시지 수신 → 로컬 복호화 → 로컬 노티 표시.

**검증**: E2E — iOS 기기 백그라운드 시 알림 수신. force-quit/killed 상태 전달은 주장하지 않음 (best-effort, 백그라운드만). NSE 기반 force-quit wake는 평문 노출로 §A.3.1 E2EE 불변조를 위반하므로 범위 밖.

### AC-FCM-007a — OAuth2 mint + messages:send (P0)

**Given** `safeStorage` 에 암호화 저장된 service-account JSON 이 존재한다.
**When** 데스크톱이 FCM 전송을 시도한다.
**Then**
1. service-account JSON 에서 RS256 JWT 생성 → Google OAuth2 토큰 엔드포인트 → 액세스 토큰 획득
2. 액세스 토큰 캐싱 (만료 전까지 재사용)
3. `POST https://fcm.googleapis.com/v1/projects/{project}/messages:send` 2xx 응답

**검증**: 단위 테스트 — mint 캐싱, HTTP 요청 형식, 2xx 응답 처리.

### AC-FCM-007b — service-account safeStorage 암호화 (P0)

**Given** 사용자가 FCM service-account JSON 을 온보딩한다.
**When** persistence Store 에 저장한다.
**Then**
1. 디스크에는 `safeStorage.encryptString` 로 암호화된 형태만 존재 (평문 부재)
2. 로그/콘솔에 service-account 내용(Private Key 등) 출력 부재
3. 버전 컨트롤에 service-account 파일 커밋 부재

**검증**: grep sentinel — `grep -rn "private_key\|service-account\|BEGIN PRIVATE" src/` 가 비밀 출력 매칭 0건 (테스트 fixture 제외); `.gitignore` 확인.

### AC-FCM-007c — FCM HTTP 에러 redact/비블로킹 (P1)

**Given** FCM 엔드포인트가 5xx 또는 네트워크 에러를 반환한다.
**When** 데스크톱이 FCM 전송을 시도한다.
**Then**
1. 인증 헤더/토큰이 로그에 노출되지 않는다 (redact)
2. dispatch 루프가 블로킹되지 않는다 (알림 소실 없이 다음 dispatch 계속)
3. redact 된 진단 메시지 로그 출력

**검증**: 단위 테스트 — 5xx mock 시 non-block + 로그 redact assertion.

### AC-FCM-008 — 4KB 초과 시 graceful degrade (P1)

**Given** 암호화된 payload 가 FCM data 4KB 한계를 초과한다.
**When** 데스크톱이 전송을 시도한다.
**Then**
1. 우선순위 기반 필드 절단 후 재시도 (본문/제목 우선, 메타데이터 후순위) 또는
2. 전송 drop (WS 전달은 보존)
3. malformed FCM 메시지 미발생

**검증**: 단위 테스트 — 4KB 경계 payload(정확히 4096, 4097, 5000바이트) 동작.

### AC-FCM-009 — 권한/토글 게이트 (P1)

**Given** 사용자가 아직 알림 권한을 부여하지 않았거나 `loadPushNotificationsEnabled()` 가 `false` 다.
**When** 모바일이 FCM 토큰을 획득/등록 시도한다.
**Then**
1. 권한 미부여 시 `ensureNotificationPermissions()` 로 권한 요청
2. `loadPushNotificationsEnabled() === false` 시 토큰 등록 RPC 미호출, FCM 수신 노티 미표시

**검증**: 단위 테스트 — 권한/토글 상태 매트릭스.

## §E. 엣지 케이스

1. **동시 다발 알림**: 동시 다수 dispatch 시 nonce 충돌 없음 (24바이트 랜덤 충분), FCM 순서 보장 없음 — `notificationId`로 멱등.
2. **네트워크 단절 중 FCM 전송 실패**: 재시도 정책 (한정적), 로그 후 다음 dispatch 계속. 큐잉은 future work.
3. **페어링 직후/해제 경쟁**: 페어링 해제 직전 FCM 전송 → Google 404 (토큰 무효) → redact 로그(AC-FCM-007c).
4. **다수 장치 동시 백그라운드**: 모든 FCM-등록 장치로 팬아웃 — 할당량 선형 증가 (listener-count 게이트가 WS 우선이므로 완화).
5. **iOS 저전력 모드**: APNs 우선순위 낮춤 — 즉시 전달 보장 안 됨 (APNs 특성).
6. **E2EE 키 회전(미래)**: 공유 키 회전 시 FCM payload 키 호환성 — 본 범위 밖, future work 표기.
7. **레거시 `orca-devices.json`**: 신규 필드 부재 → `undefined` 처리 (하위 호환).
8. **FCM data payload 만료/손실**: FCM 저장 큐 한계 — 즉시 전달 권장, 보존 보장 없음.

## §F. Forward-looking checks (future work 명시)

- FCM 전송 큐잉/재시도 정책 (현재 fire-and-log-error)
- 리치 미디어 payload (이미지/사운드)
- 알림 소스 확장 시 FCM 자동 연동 (현재 기존 소스만)
- E2EE 키 회전 시 FCM 키 호환성
- FCM 할당량 모니터링/알림

---

_모든 AC는 run-phase에 manager-develop가 구현하고 증거를 `progress.md` §E.2 에 기록한다._
