---
id: SPEC-FCM-001
title: "FCM 푸시 알림 채널 통합 — 진행 추적"
version: "0.1.0"
status: draft
created: 2026-07-11
updated: 2026-07-11
author: manager-spec
tier: L
---

# SPEC-FCM-001 Progress — 진행 추적

> `plan_complete_at` / `plan_status` 는 orchestrator가 annotation cycle + 최종 pass 완료 후 `audit-ready` 로 설정한다. 본 파일에서는 설정하지 않는다.

## §F.1 Plan-phase 상태

| 항목 | 상태 |
|------|------|
| research.md | 작성 완료 (2026-07-11; iteration 2 — D1/D7 교정, §6 해결됨 표기) |
| spec.md | 작성 완료 (2026-07-11; iteration 2 — GEARS 요구사항 19건, REQ-FCM-019 신규) |
| plan.md | 작성 완료 (2026-07-11; iteration 2 — 마일스톤 7건, open marker 0건, §E 해결된 결정 사항) |
| acceptance.md | 작성 완료 (2026-07-11; iteration 2 — AC 14건, REQ-019→AC-003 매핑, REQ-001 framing 분해) |
| design.md | 작성 완료 (2026-07-11; iteration 2 — §C.1/§E/§H 영속 키 설계로 교정) |
| SPEC ID self-check | PASS (`SPEC-FCM-001` 매칭 `^SPEC(-[A-Z][A-Z0-9]*)+-[0-9]{3}$`) |
| 파일 경로 검증 | 완료 (research.md §4 — `ws-transport.ts` → `rpc-client.ts` 교정 포함) |
| Out of Scope 섹션 | 포함 (spec.md §F, H3 `### Out of Scope —` 5건) |
| Frontmatter 12필드 | 충족 (spec.md) |
| MP-7 open-marker gate | 충족 (open clarification marker 0건 — 6개 + D1 모두 iteration 2 에서 해결) |

## Iteration 2 revision

> plan-auditor FAIL (score 0.77, threshold 0.85; report `.moai/reports/plan-audit/SPEC-FCM-001-review-1.md`) 에 따른 iteration 2 교정. 본 패스는 plan-phase 산출물 5종 + progress.md 만 수정했으며, 소스 코드 변경은 없다.

- **D1 (CRITICAL) — FCM 암호화 키 소스 비현실성**: WS 세션 키 재사용 설계를 **영속 키페어 설계**로 교체. 모바일 신규 영속 Curve25519 키페어 + `DeviceEntry.mobilePublicKeyB64` 신규 필드; 데스크톱은 기존 `e2ee-keypair.ts` 영속 키페어 재사용. `sharedFcmKey = nacl.box.before(mobilePersistentPublic, desktopPersistentSecret)`. WS forward secrecy 보존. REQ-FCM-004 재작성 + REQ-FCM-019(Ubiquitous) 신규 추가.
- **D4 (MAJOR) — design.md §C.1 사실관계 오류**: "WS 프레임 암호화에 이미 사용 중인 동일 키" 허위 기술 삭제, 영속 키 설계로 전면 교정 (design.md §C.1/§E.1/§E.3/§H.2).
- **D3 (MAJOR) — REQ-FCM-001 AC 부재**: REQ-001 을 framing requirement 로 재분류 — AC-001/002a/002b 가 집합적으로 검증 (단일 AC 행 추가 없이, acceptance.md §B 매트릭스 후주로 명시).
- **D5 (MINOR) — REQ-FCM-014 라벨**: "(Event-detected)" → "(Event-driven)" 교정.
- **D6 (MINOR) — AC count 동기화**: acceptance.md AC = 14 (REQ-019→AC-003 확장, 신규 AC 행 불가) 로 progress/spec/acceptance 일치.
- **D7 (MINOR) — #5 재분류**: `preferences.ts` 백엔드 = AsyncStorage 검증 완료 (연구 갭, 사용자 결정 아님).
- **D8 (MINOR) — REQ-018 토글 결정**: 단일 토글 재사용으로 확정, spec.md REQ-018 본문에 resolved 결정 반영.
- **D9 (MINOR) — spec.md §E 요약**: acceptance.md §B 매트릭스와 정확히 일치하도록 재작성.
- **D2 (CRITICAL) — MP-7 clarification gate**: 6개 + 1개(D1) open marker 모두 해결 → plan.md/spec.md/acceptance.md/design.md/research.md 전 파일 open marker 0건.

## §E.1 Plan-phase Audit-Ready Signal

- plan_complete_at: 2026-07-12T00:10:17Z
- plan_status: audit-ready
- audit: plan-auditor iter2 **PASS (0.92)**; iter1 FAIL(0.77) → 9/9 결함 해결; D10(spec.md §A.3 crypto 인자 순서) 교정 완료; open `[NEEDS CLARIFICATION]` 0건

## §E.2 Run-phase Evidence

### M1 — DeviceEntry 스키마 확장 + 토큰·영속 키페어 등록 RPC (2026-07-11)

**구현 파일 (TDD RED→GREEN)**:
- `src/main/runtime/device-registry.ts` — `DeviceEntry`에 `fcmToken?`/`pushPlatform?`/`mobilePublicKeyB64?` optional 필드 추가; `updateDevicePushToken(deviceId, patch)` 메서드; 레거시 round-trip(`...device` 스프레드로 신규 필드 부재 시 undefined)
- `src/main/runtime/rpc/core.ts` — `RpcContext`에 `deviceRegistry?: DeviceRegistry` 추가(type-only import)
- `src/main/runtime/rpc/dispatcher.ts` — `dispatchStreaming` options + 양 ctx 사이트에 `deviceRegistry` 전달
- `src/main/runtime/runtime-rpc.ts` — `MOBILE_RPC_METHOD_ALLOWLIST`에 `notifications.registerPushToken` 추가; ctx 빌드 지점(L1020 `clientId: token`)에 `deviceRegistry: this.deviceRegistry ?? undefined` 주입
- `src/main/runtime/rpc/methods/notifications.ts` — `notifications.registerPushToken` defineMethod 추가; caller 를 `ctx.clientId`(token) → `validateToken` → deviceId 로 해석; zod v4 API(`z.enum`, `.min(1, msg)`)
- `mobile/src/transport/push-keypair.ts` (신규) — 장기 생존 Curve25519 키페어(AsyncStorage 영속); `loadOrCreatePushKeypair()` 공개 키 반환. ephemeral(rpc-client.ts) 과 분리(REQ-FCM-019)
- `mobile/src/transport/e2ee.ts` — `bytesToBase64` export(private `uint8ToBase64` 폐기). 동작 변경 없음
- `mobile/src/notifications/push-token-registration.ts` (신규) — toggle→permission→token→pubkey→RPC 오케스트레이션; `loadPushNotificationsEnabled` 게이트(REQ-FCM-018), `ensureNotificationPermissions`(REQ-FCM-017)
- `mobile/src/notifications/use-push-token-registration.ts` (신규) — connect 시 발화 훅(index.tsx max-lines 분리)
- `mobile/app/index.tsx` — `usePushTokenRegistration(allClients)` 호출(페어링 완료 후 등록)

**AC 증거**:
- AC-FCM-004a (RPC + DeviceEntry 저장): `device-registry.test.ts` 6/6 PASS + `notifications.test.ts` 6/6 PASS — caller 해석(clientId→validateToken→deviceId) + orca-devices.json 디스크 반영 + 레거시 호환
- AC-FCM-004b (토큰 갱신 멱등): 갱신 시 최신 토큰 덮어쓰기 단위 테스트 PASS
- AC-FCM-003 (영속 키 도발 PORTION): `push-keypair.test.ts` 3/3 PASS(영속 키 재사용). 전체 암호화 왕복은 M2 → Gap

**검증 명령(verbatim exit)**:
- desktop typecheck: exit 0 (`pnpm typecheck`)
- mobile typecheck: exit 0 (`./node_modules/.bin/tsc --noEmit` in mobile/)
- desktop runtime tests: 91 files / 1786 passed | 2 skipped
- mobile tests: 192 files / 1411 passed | 2 skipped
- desktop oxlint(broad src/main/runtime): exit 0; mobile oxlint(affected): exit 0
- mobile-rpc-allowlist boundary test: PASS(신규 메서드 등록+허용목록 교차 검증)

### M2 — 데스크톱 FCM 푸시 페이로드 암호화 + 영속 키 도출 (2026-07-11)

**구현 파일 (TDD RED→GREEN, desktop-only)**:
- `src/main/runtime/push-payload-crypto.ts` (신규) — `deriveFcmSharedKey(desktopPersistentSecret, mobilePublicKeyB64)`: WS 세션 키와 무관한 영속 FCM-shared key 도출. `deriveSharedKey(secret, public)` 시그니처를 `rpc/e2ee-channel.ts:184` WS 경로와 동일하게 적용(인자 순서 `(secret, public)`). `encryptPushPayload(payload, sharedFcmKey, maxBytes=4096)`: 우선순위 기반 4KB graceful degrade — metadata 먼저 절단 → body 이진탐색 축소 → title 단독 초과 시 drop(REQ-FCM-006 malformed 미발생). `encryptBytes` 재사용(fresh 24-byte nonce per call → REQ-FCM-005).
- `src/main/runtime/push-payload-crypto.test.ts` (신규) — 17 단위 테스트.

**AC 증거 (5-섹션: Claim / Evidence / Baseline / Gaps / Residual-risk)**:

- **AC-FCM-003 (암호화 + 영속 키 도출 PORTION) — PASS**:
  - Claim: 데스크톱 encrypt 반쪽 + 영속 키 도출 PASS. 모바일 decrypt 반쪽은 M5.
  - Evidence: `pnpm exec vitest run src/main/runtime/push-payload-crypto.test.ts` → 17/17 passed. 왕복(encrypt→같은 키로 decrypt→byte-identical), ECDH 대칭성(데스크톱 도출 키 === 모바일 도출 키), 영속 키 재현성(32-byte, 호출마다 동일), WS 세션 키 독립성(REQ-FCM-019: 영속 FCM 키 ≠ ephemeral WS 세션 키), 잘못된 키 decrypt 실패 포함.
  - Baseline: M2 트리, 이번 실행.
  - Gaps: 모바일 decrypt 반쪽(M5) — 데스크톱 ciphertext 를 모바일이 소비하는 end-to-end 왕복은 M5 검증 대상. ECDH 대칭성 테스트가 모바일 도출 가능성을 간접 입증.
  - Residual-risk: tweetnacl `box.after` nonce 길이(24)는 외부 라이브러리 상수 의존.

- **AC-FCM-008 (4KB graceful degrade) — PASS**:
  - Claim: 4KB 초과 시 priority truncation 또는 drop, malformed FCM 미발생.
  - Evidence: 동일 17/17 — 4096 실제 경계 이진탐색(fits at N, truncates at N+1), metadata→body 절단 순서, title 단독 초과 시 drop, ~5KB body 축소, 모든 non-dropped outcome base64-decode+decrypt 정상.
  - Baseline/Gaps/Residual-risk: AC-FCM-003 과 동일.

**검증 명령(verbatim exit)**:
- desktop typecheck: `pnpm typecheck` → exit 0
- desktop 단위 테스트: `pnpm exec vitest run src/main/runtime/push-payload-crypto.test.ts` → Test Files 1 passed (1) / Tests 17 passed (17)
- oxlint(신규 파일 2개): exit 0
- B2 cross-SPEC pre-scan: no matches (clean — retired/superseded/deprecated 표식 없음)
- coverage toolchain: 프로젝트에 `@vitest/coverage-v8` 부재(M1 확인과 동일) → 커버리지 % 대신 test-count(17 passed) 증거 제시

**PRESERVE 무결성**: WS ephemeral path(`rpc/e2ee-channel.ts`, `rpc/e2ee-crypto.ts`), `e2ee-keypair.ts` 생성 로직, `shared/e2ee-crypto.ts` 원시함수, `device-registry.ts`, `mobile/` — 모두 미수정(`git status` 로 확인, M1 의 `mobile/pnpm-lock.yaml` modification 도 미포함).

### M3 — 데스크톱 FCM 송신자 + OAuth2 mint (2026-07-11, desktop-only)

**구현 파일 (TDD RED→GREEN, desktop-only)**:
- `src/main/runtime/fcm-sender.ts` (신규) — `createFcmSender(options)`: OAuth2 액세스 토큰 캐싱(per-projectId, 만료 임박 시 재-mint), FCM v1 `messages:send` POST (data-only body — `notification` 필드 부재, E2EE 보존), `redactAuthError(input, bearerToken?)` (Authorization 헤더 / bearer 토큰값 / PEM 블록 / credential JSON 키 필드 scrub), non-blocking `send()` (절대 throw 하지 않음 — fire-and-log-error). `createGoogleAuthMinter(scope)`: `google-auth-library` `GoogleAuth({ credentials, scopes })` → `getClient` → `getAccessToken()` 래핑 (실제 Google API 정확성 = residual risk, 단위 테스트는 주입 minter 사용).
- `src/main/runtime/fcm-sender.test.ts` (신규) — 12 단위 테스트 (주입 minter + 주입 fetch + 제어 clock). mint 캐싱, request shape, redact, non-block, data-only body 검증.
- `src/shared/types.ts` — `GlobalSettings.fcmServiceAccountJson?: string | null` 추가 (safeStorage encrypted secret — `opencodeSessionCookie` 동일 패턴).
- `src/main/persistence.ts` — load 시 `decryptOptionalSecret`, save 시 `encryptOptionalSecret` (디스크에는 암호문만); `Store.getFcmServiceAccountJson()` / `setFcmServiceAccountJson(value)` 접근자.
- `src/main/persistence.test.ts` — FCM credential safeStorage round-trip 3 테스트 (디스크 암호문 전용, reload 복호화, null 정규화).
- `package.json` + `pnpm-lock.yaml` (root) — `google-auth-library@^10.9.0` 추가 (publish 2026-06-24; `minimum-release-age=4320` ≈ 3일 준수 — 17일 경과).
- `.gitignore` — FCM/Firebase credential 파일 백스톱 (`*-fcm-credential*.json`, `google-services.json`, `GoogleService-Info.plist`, `*.p8`).

**AC 증거 (5-섹션: Claim / Evidence / Baseline / Gaps / Residual-risk)**:

- **AC-FCM-007a (OAuth2 mint + messages:send) — PASS**:
  - Claim: OAuth2 토큰 캐싱(mint 1회 → 만료 전 재사용 → 만료 임박 재-mint) + FCM v1 POST URL/bearer/data-only body 검증 PASS.
  - Evidence: `pnpm exec vitest run src/main/runtime/fcm-sender.test.ts` → 12/12 passed. 캐싱 테스트(t=0 mint TOKEN_1, t=8500 재사용 minter count=1, t=9500 재-mint TOKEN_2 count=2). request-shape 테스트(URL = `https://fcm.googleapis.com/v1/projects/{project}/messages:send`, `Authorization: Bearer`, data-only body — `message.notification` undefined assertion).
  - Baseline: M3 트리, 이번 실행.
  - Gaps: 실제 Google OAuth2 라운드트립은 주입 minter 로 대체 — `createGoogleAuthMinter` 의 live API 정확성은 단위 테스트 범위 아님.
  - Residual-risk: `google-auth-library@10.9.0` 의 `getAccessToken()` 반환형(`{ token, expiryDate }`)은 v10 docs 기반; 실제 credentials 없는 단위 테스트 불가.

- **AC-FCM-007b (service-account safeStorage 암호화) — PASS**:
  - Claim: 디스크에는 safeStorage 암호문만 존재; reload 시 평문 복원; grep sentinel(non-test src/main) 0 매칭.
  - Evidence: `pnpm exec vitest run src/main/persistence.test.ts -t "FCM credential"` → 3/3 passed (디스크 `encrypted:` base64 형태만, reload 평문 복원, null 정규화). sentinel `grep -rn "private_key\|BEGIN PRIVATE\|service-account" src/main/ --include="*.ts" | grep -v "\.test\.ts"` → 0 matches. `.gitignore` credential 커버리지 추가.
  - Baseline: M3 트리, 이번 실행.
  - Gaps: 없음 (온보딩 IPC 붙여넣기 UX는 M3 최소 범위 밖 — `setFcmServiceAccountJson` 접근자로 main-process 저장 가능 상태).
  - Residual-risk: Settings/renderer 붙여넣기 UX 연결은 후속(현재 main-process storage + 접근자만 제공).

- **AC-FCM-007c (FCM HTTP 에러 redact / 비블로킹) — PASS**:
  - Claim: 5xx / network error / mint 실패 시 redacted failed outcome 반환 (절대 throw 하지 않음); auth 헤더·토큰·credential 재질 scrub.
  - Evidence: 동일 12/12 — 5xx(503 응답 본문에 토큰 삽입 → 반환값에 토큰 부재, `503` 포함), network error(fetch reject + `Authorization: Bearer <token>` 에러 → `Bearer <redacted>`, 토큰 부재), mint 실패(`private_key` 값 포함 에러 → scrub) 모두 `{ status: 'failed' }` resolve (non-block).
  - Baseline: M3 트리, 이번 실행.
  - Gaps: M4 dispatch 루프 통합 전이므로 실제 `dispatchMobileNotification` 비블로킹 통합 검증은 M4.
  - Residual-risk: redact 함수는 알려진 패턴(헤더/PEM/JSON 필드)만 scrub — 알 수 없는 형태의 토큰 유출 경로는 잔여 위험.

**검증 명령(verbatim exit)**:
- desktop typecheck GATE: `pnpm typecheck` → exit 0 (3개 tsc 설정 모두 통과)
- M3 단위 테스트: `pnpm exec vitest run src/main/runtime/fcm-sender.test.ts src/main/persistence.test.ts` → Test Files 2 passed (2) / Tests 375 passed (375)
- oxlint(변경 파일 5개): exit 0; oxlint(`src/main/runtime/` broad): exit 0
- B2 cross-SPEC pre-scan(`fcm-sender.ts`, `persistence.ts`): no retired/superseded/deprecated markers
- secret-leak sentinel(non-test `src/main/`): 0 matches; `.gitignore` credential 커버리지 확인
- coverage toolchain: 프로젝트에 `@vitest/coverage-v8` 부재(M1/M2 확인과 동일) → 커버리지 % 대신 test-count(12 sender + 3 persistence FCM = 15 신규 M3 테스트, persistence 전체 363 passed 회귀 없음) 증거 제시
- `google-auth-library@10.9.0`: publish 2026-06-24 (17일 경과, `minimum-release-age=4320` 준수)

**PRESERVE 무결성**: `dispatchMobileNotification` 리스너 루프(`orca-runtime.ts` — M4 범위), M2 `push-payload-crypto.ts`(ciphertextB64 출력 재사용, 미수정), WS ephemeral E2EE 경로, `safeStorage`/`encryptString`/`decryptString` 원시함수(EXTEND only), `mobile/` — 모두 미수정.

### M4 — 전송 트리거 게이트 통합 (2026-07-11, desktop-only)

**구현 파일 (TDD RED→GREEN→REFACTOR, desktop-only)**:
- `src/main/runtime/fcm-fanout.ts` (신규, ~140줄) — `createFcmFanOut(deps): FcmFanOut`. 리스너 수 게이트가 열렸을 때의 per-device M1+M2+M3 체인 오케스트레이션: `getFcmCredentials()` / `getDesktopPersistentSecret()` / `listFcmDevices()` early-return (graceful degradation) → `selectFcmCapableDevices` (fcmToken + mobilePublicKeyB64 모두 있는 기기만) → per-device `deriveFcmSharedKey` (M2) → `encryptPushPayload` (M2, `dropped` 건너뜀) → `sender.send({ credentials, deviceFcmToken, ciphertextB64, notificationId })` (M3). `createSender` 를 팩토리 호출 1회로 캐싱(M3 OAuth 토큰 캐시 재사용). `Promise.all` + per-device try/catch 로 어떤 기기 실패도 다른 기기·dispatch 루프에 전파 안 함 (REQ-FCM-014 non-blocking). 의존성 전부 주입(레지스트리/credential/keypair/sender) → runtime 은 registry/sender 디테일에서 분리.
- `src/main/runtime/orca-runtime.ts` (최소 증분, ADDITIVE) — `private fcmFanOut: FcmFanOut | null` 필드 + `setFcmFanOut(hook)` 세터 + `dispatchMobileNotification` 내 **for-loop 이후** 신규 분기. 기존 WS 리스너 iteration 은 byte-identical (AC-FCM-001 P0). 분기 조건: `event.type === 'notification' && notificationListeners.size === 0 && fcmFanOut` → `void fanOut(...).catch(...)` (비블로킹, dismiss 이벤트는 제외). `orca-runtime.ts` 는 max-lines grandfathered 이므로 게이트 로직은 fcm-fanout.ts 로 추출하여 본 파일 증분은 ~15줄로 최소화.
- `src/main/index.ts` — 팬아웃 훅 단일 wiring 지점. `runtimeRpc = new OrcaRuntimeRpcServer(...)` 직후 `createFcmFanOut({...})` 로 훅 구성 → `runtime.setFcmFanOut(...)`. registry/keypair/credential 을 lazy accessor 로 주입 (`getDeviceRegistry()` / `getE2EEKeypair()` / `store.getFcmServiceAccountJson()` — projectId 는 service-account JSON 내 `project_id`에서 파싱, corrupt 시 no-op). `runtimeRpc` 는 `let ... | null` 이므로 `const rpcServer = runtimeRpc` 로 closure 내 non-null narrowing 유지. WS disabled 시 registry=null → 훅 no-op (graceful degradation).
- `src/main/runtime/fcm-fanout.test.ts` (신규) — 13 단위 테스트 (주입 mock sender + 실제 M2 crypto). AC-FCM-002a(팬아웃 레벨: 기기별 send 호출 + ciphertextB64 + notificationId), M2 round-trip(모바일 half 복호화 성공), 다중 기기, graceful degradation(credential/secret/기기 부재, dropped, 토큰·공개키 부재 기기 스킵), 비블로킹(send reject → resolve, 1 기기 실패해도 나머지 전송, createSender 1회 호출).
- `src/main/runtime/dispatch-fcm-gate.test.ts` (신규) — 6 게이트 테스트 (실 `OrcaRuntimeService` 구성, 최소 store mock). AC-FCM-002a(게이트: 리스너 0 → 훅 호출 + payload/notificationId), AC-FCM-002b(리스너 ≥1 → 훅 미호출 + WS 전달), AC-FCM-001 WS 회귀 특성화(게이트 유무와 무관하게 리스너 수신 이벤트 byte-identical; 3 subscribers 동일; dismiss 는 팬아웃 미발생), 비블로킹(rejecting 훅이 동기 dispatch 호출자에 throw 안 전파).

**AC 증거 (5-섹션: Claim / Evidence / Baseline / Gaps / Residual-risk)**:

- **AC-FCM-002a (리스너 0 → FCM 전송) — PASS**:
  - Claim: WS 리스너가 0개일 때 FCM 팬아웃 훅이 호출되며, per-device 로 M2 ciphertext + notificationId 가 M3 sender 에 전달된다.
  - Evidence: `pnpm exec vitest run src/main/runtime/fcm-fanout.test.ts src/main/runtime/dispatch-fcm-gate.test.ts` → Test Files 2 passed (2) / Tests 19 passed (19). 게이트 테스트("invokes the FCM fan-out hook ... when no WS listener is connected" — `fanOut` called with `{ payload: { title, body }, notificationId: 'notif-abc' }`, `getMobileNotificationListenerCount()===0`). 팬아웃 테스트("sends one FCM message per registered device" — `send` calledOnce with `{ credentials, deviceFcmToken: 'fcm-registration-token', notificationId: 'notif-abc', ciphertextB64(<string, non-empty>) }`; "notificationId is present" — `'dedupe-id-9'`).
  - Baseline: M4 트리(`f0c943722` M3 HEAD 위), 이번 실행.
  - Gaps: 실제 Google OAuth2/FCM 라운드트립은 주입 mock sender 로 대체 — live FCM 전달 정확성은 단위 테스트 범위 밖(M3 residual-risk 과 동일).
  - Residual-risk: `index.ts` wiring 의 lazy 접근자(`runtimeRpc.getDeviceRegistry()` 등)가 `start()` 이후에 채워지는 시점 의존 — dispatch 는 start 이후에만 발생하므로 안전하지만, start 전 dispatch 경로가 추가될 경우 재검증 필요.

- **AC-FCM-002b (리스너 ≥1 → FCM 미전송, WS-only) — PASS**:
  - Claim: WS 리스너가 1개 이상일 때 FCM 팬아웃은 호출되지 않고, WS 전달만 발생한다.
  - Evidence: 동일 19/19 — 게이트 테스트("does NOT invoke the fan-out hook when a WS listener is connected" — `getMobileNotificationListenerCount()===1`, `received===[DISPATCH_EVENT]`, `fanOut not toHaveBeenCalled`).
  - Baseline: M4 트리, 이번 실행.
  - Gaps: 없음.
  - Residual-risk: 없음.

- **AC-FCM-001 (WS 회귀 — 게이트가 WS 전달에 간섭하지 않음, P0) — PASS (unit-level)**:
  - Claim: 게이트 분기는 ADDITIVE 이며 WS 리스너 iteration + 수신 이벤트는 게이트 유무와 무관하게 byte-identical 이다. for-loop 본문은 미수정.
  - Evidence: 동일 19/19 — 특성화 테스트 3건. (1) "delivers byte-identical events ... whether or not the FCM gate is armed" — armGate false vs true 수신 결과 `eventWithGatetoEqual(eventWithoutGate)`. (2) "iterates listeners in the same shape with 3 subscribers (gate armed)" — `deliveries===[[DISPATCH_EVENT],[DISPATCH_EVENT],[DISPATCH_EVENT]]`. (3) "does NOT invoke the fan-out for a dismiss event" — dismiss → 리스너 수신 `[{type:'dismiss',notificationId}]`, `fanOut not toHaveBeenCalled`.
  - Baseline: M4 트리, 이번 실행.
  - Gaps: 전체 WS 회귀 스위트(이벤트 emit, RPC subscribe-stream, mobile-subscribe-integration)는 M7 통합 검증에서 실행 — 본 AC 는 unit-level 특성화로 P0 회귀 방어.
  - Residual-risk: `orca-runtime.test.ts` 877 + `persistence.test.ts` 120 = 997 passed (기존 dispatch/mobile/presence 경로 회귀 없음 확인) 이외의 런타임 통합 경로는 M7 잔여.

- **AC-FCM-005 (notificationId 단일 네임스페이스 dedupe carrier) — PASS (전달 검증)**:
  - Claim: FCM data 경로에 notificationId 가 포함되어 M5 cross-channel dedupe 가 가능하다.
  - Evidence: 동일 19/19 — fcm-fanout 테스트 "notificationId is present in the FCM send input" (`notificationId === 'dedupe-id-9'`); 게이트 테스트에서 `fanOut` 이 `{ notificationId: 'notif-abc' }` 로 호출 → sender send input 에 그대로 전달(M3 sender 가 `data.notificationId` 로 carry). notificationId 미포함 dispatch 이벤트는 빈 문자열로 정규화.
  - Baseline: M4 트리, 이번 실행.
  - Gaps: 모바일 수신측 dedupe 실제 동작은 M5.
  - Residual-risk: 없음(M4 범위는 전달까지만).

**검증 명령(verbatim exit)**:
- desktop typecheck GATE: `pnpm typecheck` → exit 0 (3개 tsc 설정 모두 통과; baseline 도 exit 0 — 회귀 없음)
- M4 단위/게이트 테스트: `pnpm exec vitest run src/main/runtime/fcm-fanout.test.ts src/main/runtime/dispatch-fcm-gate.test.ts` → Test Files 2 passed (2) / Tests 19 passed (19)
- M1/M2/M3 + WS-presence 회귀: `pnpm exec vitest run src/main/runtime/{push-payload-crypto,fcm-sender,device-registry,mobile-presence-lock}.test.ts` → Test Files 4 passed (4) / Tests 66 passed (66) (M4 19 포함 85 passed 세트의 일부)
- 대규모 회귀: `pnpm exec vitest run src/main/runtime/orca-runtime.test.ts src/main/persistence.test.ts` → Test Files 2 passed (2) / Tests 997 passed (997)
- oxlint(변경 파일 5개): exit 0 (no findings)
- max-lines ratchet: `pnpm run check:max-lines-ratchet` → "max-lines ratchet OK — 355 grandfathered suppression(s), no new bypasses" (`orca-runtime.ts` grandfathered 한계 내 증분 최소화; max-lines disable/bump 추가 없음)
- B2 cross-SPEC pre-scan(`orca-runtime.ts`, `runtime-rpc.ts` integration sites): no retired/superseded/deprecated markers
- coverage toolchain: 프로젝트에 `@vitest/coverage-v8` 부재(M1/M2/M3 확인과 동일) → 커버리지 % 대신 test-count(M4 신규 19 = fcm-fanout 13 + dispatch-fcm-gate 6) + 기존 997 passed 회귀 없음 증거 제시

**PRESERVE 무결성 (M4)**: WS 리스너 iteration/emit 경로(byte-identical, ADDITIVE 분기), M2 `push-payload-crypto.ts`(재사용, 미수정), M3 `fcm-sender.ts`(재사용, 미수정), M1 `DeviceEntry` 필드 + RPC(재사용, 미수정), WS ephemeral E2EE 경로(`rpc/e2ee-channel.ts`), `e2ee-keypair.ts`(`secretKey` 읽기 전용), M2 per-message nonce — 모두 미수정/존중.

### M5 — 모바일 FCM 수신 + 로컬 복호화 (2026-07-11, mobile-only)

**산출 AC**: AC-FCM-003 (모바일 decrypt 반쪽 — 크로스 플랫폼 ECDH 왕복 완성), AC-FCM-005 (단일 notificationId cross-channel 중복제거), AC-FCM-009 (권한/토글 게이트).

**Crux 해결 (데스크톱 영속 공개키 소스)**: 모바일은 데스크톱 영속 공개키를 **이미** `host.publicKeyB64` 로 영속화 중 (페어링 QR / E2EE 핸드셰이크 → `host-store.ts` AsyncStorage `orca:hosts`, `StoredHostProfileSchema` 검증). M5 가 새 저장소를 추가할 필요 없음. 영속 FCM-공유 키 = `deriveMobileFcmSharedKey(mobilePersistentSecret, host.publicKeyB64)` = ECDH 대칭(M2 `deriveFcmSharedKey(desktopSecret, mobilePublic)` 와 동일 32바이트).

**FCM data schema (M3/M4 PRESERVED)**: `data: { payload: ciphertextB64, notificationId }` — hostId 미포함. 수신측은 per-host try-decrypt(첫 복호화 성공 host = 발신 host; 오답 키는 Poly1305 인증 실패로 깨끗이 fall through).

**신규/수정 파일 (mobile-only, desktop 미수정)**:
- `mobile/src/notifications/push-payload-decrypt.ts` (신규) — `deriveMobileFcmSharedKey` + `decryptPushPayload` (M2 base64 bundle nonce+ciphertext 소비, 변경 불가).
- `mobile/src/notifications/fcm-push-receiver.ts` (신규) — 수신 오케스트레이션: M1 push-keypair secret 읽기 전용 로드(`orca:push-keypair`, push-keypair.ts 미수정), per-host try-decrypt, 기존 `showLocalNotification` 경로 재사용(AC-FCM-005 dedupe + AC-FCM-009 게이트).
- `mobile/src/notifications/mobile-notifications.ts` (수정, 최소) — `showLocalNotification` + `NotificationEvent` export (FCM 수신측이 WS 경로 재사용).
- `mobile/src/notifications/notification-routing.ts` (수정, 최소) — `DesktopNotificationSource` 에 `'fcm-supplemental'` 추가 (M4 가 source 를 strip 하므로 전송 마커로 정확).
- `mobile/app/_layout.tsx` (수정) — `addNotificationReceivedListener` 등록, payload-bearing data message 를 receiver 로 라우팅 (self-loop 가드: 로컬 노티 data 에는 `payload` 키 없음).
- 테스트 4개 신규 (27 tests): `push-payload-decrypt.test.ts`(8), `fcm-payload-cross-platform.test.ts`(6, no-mock AC-FCM-003 증명), `fcm-push-receiver.test.ts`(8), `fcm-push-gate-dedupe.test.ts`(5, REAL showLocalNotification 로 AC-FCM-005/009).

**E1 AC 매트릭스**:
- AC-FCM-003 (모바일 decrypt 반쪽) — PASS. command: `mobile/node_modules/.bin/vitest run --root mobile src/notifications/fcm-payload-cross-platform.test.ts` → "Test Files 1 passed (1) / Tests 6 passed (6)" (desktop-derive ↔ mobile-derive byte-identical + M2 encrypt → 모바일 decrypt 원본 복원 + nonce uniqueness 32/32 + persistent ≠ ephemeral WS 키 분리). 추가 `push-payload-decrypt.test.ts` 8 passed (ECDH 대칭 + 왕복 + 변조/오답키/비JSON/필드누락 error).
- AC-FCM-005 (단일 notificationId 중복제거) — PASS. command: `mobile/node_modules/.bin/vitest run --root mobile src/notifications/fcm-push-gate-dedupe.test.ts -t "AC-FCM-005"` → WS-then-FCM 동일 notificationId 수신 시 `scheduleNotificationAsync` 1회 호출(pending 슬롯으로 FCM 도착 suppress), 상이 notificationId 시 2회.
- AC-FCM-009 (권한/토글 게이트) — PASS. command: `mobile/node_modules/.bin/vitest run --root mobile src/notifications/fcm-push-gate-dedupe.test.ts -t "AC-FCM-009"` → toggle ON+granted=1 schedule, toggle OFF=0 schedule, permission DENIED=0 schedule (FCM 경로가 WS 게이트를 재사용).

**E2 mobile type-check (GATE)**: `mobile/node_modules/.bin/tsc -p mobile/tsconfig.json --noEmit` → exit 0 (baseline 도 exit 0 — 회귀 없음). (참고: 본 체크아웃의 `pnpm -C mobile exec ...` esbuild `[ERR_PNPM_IGNORED_BUILDS]` 사전 이슈로 direct binary 사용 — M1–M4 와 동일 bypass.)

**검증 명령(verbatim exit)**:
- M5 테스트 4개: `mobile/node_modules/.bin/vitest run --root mobile src/notifications/push-payload-decrypt.test.ts src/notifications/fcm-payload-cross-platform.test.ts src/notifications/fcm-push-receiver.test.ts src/notifications/fcm-push-gate-dedupe.test.ts` → Test Files 4 passed (4) / Tests 27 passed (27)
- 회귀(notifications + push-keypair): `mobile/node_modules/.bin/vitest run --root mobile src/notifications/ src/transport/push-keypair.test.ts` → Test Files 8 passed (8) / Tests 47 passed (47) (기존 mobile-notifications/notification-routing/push-token-registration 회귀 + M5 신규)
- mobile typecheck GATE: exit 0
- oxlint(변경/신규 mobile 파일 9개): exit 0 (no findings)
- desktop 미수정 확인: `git diff --name-only HEAD -- src/main src/shared` → empty

**E3 coverage**: `@vitest/coverage-v8` 부재(M1–M4 와 동일) → test-count(M5 신규 27 = decrypt 8 + cross-platform 6 + receiver 8 + gate-dedupe 5) + 기존 47 passed 회귀 없음 증거.

**Gaps**: 기기 백그라운드/종료-state 실제 FCM 전달(E2E)은 M6 범위(native googleServicesFile config plugin + background task + Android/iOS 기기 검증). 본 M5 는 JS-side 수신 핸들러 등록 + 복호화/dedupe/게이트 로직.

**Residual-risk**: FCM data 가 hostId 미포함 → 다수 host 페어링 시 per-host try-decrypt 비용이 선형(일반적 1 host 로 O(1)). killed-state data-message 처리는 M6 native config 의존.

**PRESERVE 무결성 (M5)**: WS ephemeral E2EE 경로(`rpc-client.ts` ephemeral keypair, `e2ee-channel.ts` WS 세션키) 미수정, M1 `push-keypair.ts` 미수정(secret 읽기 전용), M2 `push-payload-crypto.ts`/M3 `fcm-sender.ts`/M4 `fcm-fanout.ts` + dispatch 게이트(desktop) 미수정, M2 bundle format(nonce+ciphertext) 동일 소비.

### M6 — 플랫폼 전달 (Android 직접 + iOS APNs via FCM) + Expo config (2026-07-11)

**구현 파일 (TDD RED→GREEN, cross-surface)**:
- `src/main/runtime/fcm-sender.ts` (수정, M3 sender) — `SendFcmMessageInput` 에 `pushPlatform: PushPlatform` 필드 추가(REQ-FCM-016). `send()` 본문에 platform branching: android → `message.android = { priority: 'HIGH' }` (FCM v1 `AndroidConfig.priority` enum 은 uppercase HIGH/NORMAL — lowercase 는 PRIORITY_UNSPECIFIED 로 silent fallback 위험); ios → `message.apns = { headers: { 'apns-priority': '10' }, payload: { aps: { 'content-available': 1 } } }` (FCM 이 data message 를 APNs 로 broker 하여 backgrounded/killed 앱 전달). data-only invariant 양단 유지(`notification` 필드 부재 → E2EE 보존).
- `src/main/runtime/fcm-fanout.ts` (수정, M4) — `sender.send` 호출에 `pushPlatform: device.pushPlatform ?? 'android'` 전달. legacy/partial DeviceEntry(플랫폼 미등록)는 android 직접 FCM 경로로 fallback(AC-FCM-004a 가 token+platform 을 함께 보내므로 정상 등록 기기는 항상 platform 보유).
- `mobile/app.json` (수정) — `android.googleServicesFile: "./google-services.json"`, `ios.googleServicesFile: "./GoogleService-Info.plist"` 추가. 두 파일 모두 사용자 Firebase 프로젝트 산출물이며 `.gitignore` 로 커밋 차단됨.
- `mobile/eas.json` (신규) — EAS build profiles scaffold(development/preview/production). `.p8` APNs auth key 와 service-account JSON 은 커밋되지 않음(사용자가 Firebase Console 또는 EAS credentials CLI 로 업로드).
- `src/main/runtime/fcm-sender.test.ts` (수정) — platform branching 단위 테스트 3개 신규(android HIGH + apns 부재, ios apns content-available=1/apns-priority=10 + android 부재, 양단 ciphertext opaque + alert/badge/sound 부재). 기존 13개 send 호출에 `pushPlatform` 추가.
- `src/main/runtime/fcm-fanout.test.ts` (수정) — `pushPlatform` passthrough 단위 테스트 2개 신규(android/ios device 토큰-플랫폼 페어링 교차 검증, undefined→android fallback).

**Expo config plugin 결정 (iteration-2 #2 해소)**: NO custom plugin. `expo-notifications ^55.0.22` 자체 config plugin 이 Android FCM native wiring(`com.google.gms.google-services` gradle plugin + `googleServicesFile` via app.json)과 iOS APNs registration 을 모두 처리. `app.json` `googleServicesFile` 만으로 FCM(Android data message)/APNs(iOS background data) 수신에 충분. `@react-native-firebase/app` 사용 안 함(iteration-2 확정 — Expo 철학 일치, 기존 `./plugins/` 선례). 기존 `./plugins/android-respect-rotation-lock.js` 는 본 SPEC 무관(rotation lock).

**E1 AC 매트릭스**:
- AC-FCM-006a (Android FCM 직접 전달) — **code-complete PASS / device-E2E = Gap**. command: `pnpm exec vitest run src/main/runtime/fcm-sender.test.ts -t "android:"` → `message.android = { priority: 'HIGH' }`, `message.apns` 부재, `message.notification` 부재, data payload intact. device-E2E(기기 백그라운드 알림 수신)는 사용자 기기에서 post-merge 검증(deferred per delegation scope).
- AC-FCM-006b (iOS APNs via FCM 전달) — **code-complete PASS / device-E2E = Gap**. command: `pnpm exec vitest run src/main/runtime/fcm-sender.test.ts -t "ios:"` → `message.apns = { headers: { 'apns-priority': '10' }, payload: { aps: { 'content-available': 1 } } }`, `message.android` 부재, `message.notification` 부재, data payload intact. device-E2E(iOS 기기 백그라운드 알림 수신)는 사용자 기기에서 post-merge 검증(deferred).

**E2 build (GATE)**: desktop `pnpm typecheck` → exit 0; mobile `mobile/node_modules/.bin/tsc -p mobile/tsconfig.json --noEmit` → exit 0 (양단 baseline 동일 exit 0 — 회귀 없음).

**검증 명령(verbatim exit)**:
- M6 FCM 단위 테스트: `pnpm exec vitest run src/main/runtime/fcm-sender.test.ts src/main/runtime/fcm-fanout.test.ts` → Test Files 2 passed (2) / Tests 29 passed (29) (sender 15 = 기존 10 + platform branching 3 + 토큰캐싱/에러 5; fan-out 14 = 기존 12 + passthrough 2)
- dispatch 게이트 회귀: `pnpm exec vitest run src/main/runtime/dispatch-fcm-gate.test.ts` → 7 passed (M4 게이트 미수정 확인)
- desktop typecheck GATE: exit 0
- mobile typecheck GATE: exit 0
- desktop oxlint(변경 파일 4): exit 0 (no findings); mobile oxlint(full): exit 0
- B2 cross-SPEC pre-scan: `grep -rn "Retired|superseded|deprecated" src/main/runtime/fcm-sender.ts src/main/runtime/fcm-fanout.ts mobile/app.json` → 0 matches (CLEAN)

**E3 coverage**: `@vitest/coverage-v8` 부재(M1–M5 와 동일) → test-count 증거(M6 신규 5 tests = sender platform branching 3 + fan-out passthrough 2) + 전체 FCM 36 passed 회귀 없음.

**E4 credential-leak sentinel**: `git ls-files | grep -E "google-services\.json|GoogleService-Info\.plist|\.p8$|service-account"` → 0 tracked (CLEAN). `.gitignore`(M3 설정) 가 `google-services.json`, `GoogleService-Info.plist`, `*.p8`, `*-fcm-credential*.json`, `*fcm-service-account*.json` 커버. `mobile/.gitignore` 도 `*.p8` 커버.

**Gaps**: AC-FCM-006a/006b device-E2E(Android/iOS 기기 백그라운드/종료-state 실제 FCM/APNs 수신)는 delegation scope 에서 명시적으로 DEFERRED 됨 — 본 M6 는 platform message shape + config code-complete 만 구현. 기기 검증은 사용자 기기에서 post-merge 수행. `.p8` APNs auth key / service-account JSON 업로드(Firebase Console / EAS credentials CLI)도 사용자 action.

**Residual-risk**: FCM v1 `AndroidConfig.priority` enum uppercase 값(`HIGH`)은 API 가 lowercase 를 PRIORITY_UNSPECIFIED 로 처리하는 동작에 의존. iOS `content-available` background push 는 APNs/os-version throttle 대상(저전력 모드·background budget). device-E2E 미검증 상태로 code-complete-only.

**PRESERVE 무결성 (M6)**: data-only invariant 양단 유지(`notification` 필드 부재 → E2EE). M2 `push-payload-crypto.ts`, M1 `DeviceEntry.pushPlatform`(읽기 전용), M4 dispatch GATE(`orca-runtime.ts` 게이트 분기 미수정 — fan-out passthrough 만 추가), WS ephemeral E2EE 경로, M5 mobile decrypt(data payload platform 무관 소비) 모두 미수정.

## §E.3 Run-phase Audit-Ready Signal

_<pending run-phase>_

## §E.4 Sync-phase Audit-Ready Signal

_<pending sync-phase>_

## §F Phase 0.95 Mode Selection

> run-phase 진입 시 orchestrator 자율 결정 (orchestration-mode-selection.md §D). Implementation Kickoff Approval은 선행 세션에서 승인됨.

**Input parameters**:
- tier: L
- scope: ~17 files (desktop `src/main` ~9, mobile `mobile/src` ~7, config ~5)
- domain count: ≥3 (데스크톱 runtime, 모바일 transport/notifications, E2EE crypto, OAuth/FCM, Expo config)
- language mix: TypeScript (Electron desktop + React Native mobile) + JSON config (Go 아님)
- concurrency benefit: LOW — 코딩 중심 신규 코드, 마일스톤 간 순차 의존 (M1→M2→M3→M4→M5→M6→M7)
- Agent Teams prereqs: 미충족 (`workflow.team.enabled` 기본 false, 환경변수 미설정)

**Mode evaluation**:

| Mode | selected | rationale |
|------|----------|-----------|
| 1 trivial | NO | Tier L · 7 마일스톤 · 신규 E2EE/OAuth 코드 |
| 2 background | NO | read-only 아님 (구현/쓰기 작업) |
| 3 agent-team | NO | prereqs 미충족 (team.enabled=false) |
| 4 parallel | NO | 코딩 중심 + 파일 간 의존 — Anthropic coding-task 병렬성 주의 → Mode 5 선호 |
| 5 sub-agent | **YES** | 코딩 중심 Tier L, 순차 의존 마일스톤 |
| 6 workflow | NO | 신규 코드/다중 규칙 — Mode 6은 균일 기계적 변환만 허용 |

**Decision: sub-agent** (Mode 5)

**Justification**: 코딩 중심 Tier L, 7개 마일스톤이 순차 의존(M1 DeviceEntry 스키마 → M2 암호화 → M3 송신자 → M4 게이트 → M5 모바일 수신 → M6 플랫폼 → M7 회귀). Anthropic coding-task 병렬성 주의(연구보다 진짜 병렬화 가능한 코딩 작업이 적음)에 따라 순차 sub-agent 경로가 안전한 기본값. Agent Teams(M3) prereqs 미충족. Workflow(M6) 부적용 — 신규 코드/다중 규칙, 균일 기계적 변환 아님.

**Route**: Route B PR (dev 베이스) — `feat/SPEC-FCM-001` @ `04a1ea50e` (사용자 확정 2026-07-11). M1~M7 manager-develop 순차 위임, 마일스톤 사이 검증 배치.

---

_본 progress.md 는 plan-phase 초기 skeleton이다. §E.2/§E.3/§E.4 는 각각 manager-develop(run), manager-docs(sync) 가 run-phase/sync-phase에 채운다._
