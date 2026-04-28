# Aegis — System Architecture & Engineering Constitution (`brain.md`)

> **What this document is:**
> The authoritative technical reference for the Aegis system. Every engineer, AI agent, reviewer, and future maintainer should read this before touching any part of the codebase.
>
> **What this document defines:**
> - What Aegis is and what it is not
> - Non-negotiable product invariants
> - Full system architecture, state machine, and event timeline
> - Service and native module contracts
> - Failure handling and recovery semantics
> - Known risks, security model, and change safety rules

---

## Table of Contents

1. [System Identity](#1-system-identity)
2. [Mission-Critical Product Rules](#2-mission-critical-product-rules-system-constitution)
3. [System Architecture](#3-system-architecture)
4. [Directory Map](#4-directory-map)
5. [Runtime State Machine](#5-runtime-state-machine)
6. [SOS Event Timeline](#6-sos-event-timeline)
7. [Trigger Arbitration Rules](#7-trigger-arbitration-rules)
8. [Orchestrator Contract](#8-orchestrator-contract-usesosorchestratorhook)
9. [Service Contracts](#9-service-contracts)
10. [Native Module Contract](#10-native-module-contract-expo-silent-sms)
11. [Background Execution Matrix](#11-background-execution-matrix)
12. [Failure Matrix](#12-failure-matrix)
13. [Recovery Contract](#13-recovery-contract)
14. [Storage Contract](#14-storage-contract)
15. [Backend API Contract](#15-backend-api-contract)
16. [Observability](#16-observability)
17. [Known Unsafe Zones](#17-known-unsafe-zones)
18. [Security Model](#18-security-model)
19. [Performance Constraints](#19-performance-constraints)
20. [Deployment Reality](#20-deployment-reality)
21. [Change Safety Rules](#21-change-safety-rules)
22. [Refactor Priorities](#22-refactor-priorities)
23. [Engineering Mental Model](#23-engineering-mental-model)

---

## 1. System Identity

### 1.1 What Aegis Is

**Aegis** is a mission-critical women's safety system built in React Native (Expo). It covertly triggers emergency-response workflows during distress situations.

It is **not** a normal panic button app.

It is a **stealth emergency-response state machine** designed for situations where the user may be:
- under active surveillance by an attacker
- physically restrained or in struggle
- unable to safely unlock or visibly interact with their phone

The entire product is built around one constraint:

> **The phone may be visible to an attacker. Visible interaction may be fatal.**

Aegis solves this by:
1. Disguising itself as a working calculator
2. Accepting hands-free triggers (voice, motion)
3. Dispatching SMS through the native SIM subsystem (bypasses internet)
4. Collecting and uploading evidence without visible UI interaction

### 1.2 What Aegis Is Not

Aegis is **not**:
- a general chat or social safety app
- a wellness or self-defense content platform
- a foreground-only panic button
- a community platform for women

Do not add features that compromise covertness, increase visible footprint, or add non-critical UI complexity.

### 1.3 Design Priority Order

Every decision in Aegis must follow this hierarchy:

```
Safety > Alert Delivery > Evidence > Backend Sync > Analytics > UX
```

When in doubt, ask: *does this choice put delivery before safety?* If yes, reject it.

---

## 2. Mission-Critical Product Rules (System Constitution)

These rules are **non-negotiable invariants**. No future change, refactor, or feature addition may violate them.

| # | Rule |
|---|---|
| 1 | **Manual SOS must always work** — regardless of state, cooldown, or subsystem failure |
| 2 | **Initial distress SMS fires before** backend sync or any evidence upload |
| 3 | **Safety fails open** — missing config, storage errors, or null state must never block SOS dispatch |
| 4 | **Evidence is secondary to alert delivery** — alert SMS is sent first, always |
| 5 | **User can always cancel** an automated pre-SOS countdown |
| 6 | **Manual SOS bypasses cooldown** — rate limiting applies only to automated triggers |
| 7 | **Automated triggers are gated** against accidental or duplicate re-triggering |
| 8 | **Emergency contacts receive exactly one consolidated evidence SMS** |
| 9 | **Late evidence must not generate a duplicate evidence SMS** |
| 10 | **No non-critical subsystem may block emergency dispatch** |

---

## 3. System Architecture

### 3.1 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React Native — Expo SDK 54 |
| **Language** | TypeScript |
| **Navigation** | Expo Router (file-based) |
| **State** | React Hooks + AsyncStorage |
| **Animation** | Moti + Reanimated |
| **AI Transcription** | Groq `whisper-large-v3` |
| **Native SMS** | Custom Kotlin `expo-silent-sms` module |
| **Media Storage** | Cloudinary (direct client integration) |
| **SMS Fallback** | Twilio HTTP API |
| **Networking** | Axios |
| **Auth** | JWT |
| **Build System** | EAS Build |
| **Backend Runtime** | Node.js on Render |

### 3.2 Component Layers

```
┌─────────────────────────────────────┐
│           UI Layer                  │  Screens / Tabs / Calculator disguise
├─────────────────────────────────────┤
│           Hook Layer                │  Runtime logic / state orchestration
├─────────────────────────────────────┤
│           Service Layer             │  SMS / API / Media upload clients
├─────────────────────────────────────┤
│           Native Layer              │  Silent SMS Kotlin bridge
├─────────────────────────────────────┤
│           Persistence Layer         │  AsyncStorage
├─────────────────────────────────────┤
│           External Infra            │  Groq · Cloudinary · Twilio · Render
└─────────────────────────────────────┘
```

---

## 4. Directory Map

```
app/
├── auth-lock.tsx               # Calculator stealth screen + PIN unlock
├── login.tsx
├── register.tsx
├── (tabs)/
│   ├── index.tsx               # Home / SOS dashboard
│   └── profile.tsx
└── features/
    ├── voiceSOS/
    │   └── useVoiceSOS.ts      # Audio loop + Groq Whisper integration
    └── videoSOS/
        └── useVideoSOS.ts      # Camera capture + Cloudinary upload

hooks/
└── home/
    ├── useSOSOrchestrator.ts   # ★ Central SOS state machine
    ├── useSOSRestriction.ts    # Cooldown + rate limiting logic
    ├── useMotionDetection.ts   # Accelerometer-based trigger
    ├── useLocationTracker.ts   # GPS acquisition + polling
    ├── useAudioRecording.ts    # Audio evidence recording
    ├── useContacts.ts          # Emergency contact CRUD
    └── useSafeWords.ts         # Voice cancellation phrases

services/
├── sosService.ts               # Backend /trigger + /update-location
├── smsService.ts               # Native SMS + Twilio fallback
├── contactService.ts           # Contact schema + validation
└── apiClient.ts                # Axios instance + auth headers

modules/
└── expo-silent-sms/            # Native Android SMS bridge (Kotlin)
    ├── android/                # SmsManager, BroadcastReceiver, PendingIntent
    └── index.ts                # JS-side interface

constants/
├── Config.ts                   # Environment config + safety rules
├── CloudinaryConfig.ts
└── theme.ts
```

---

## 5. Runtime State Machine

### State Sequence

```
IDLE
 └─▶ LISTENING
      └─▶ TRIGGER_DETECTED
           └─▶ PRE_SOS          (alarm + cancellation window)
                └─▶ SOS_ACTIVE
                     ├─▶ RECORDING
                     │    └─▶ UPLOADING
                     │         └─▶ EVIDENCE_READY
                     │              └─▶ DISPATCHED
                     └─▶ COOLDOWN
                          └─▶ IDLE
```

### State Definitions

| State | Purpose | Key Actions |
|---|---|---|
| `IDLE` | System reset, awaiting next cycle | Clear refs, reset flags |
| `LISTENING` | Voice + motion detection active | Audio loop running, accelerometer on |
| `TRIGGER_DETECTED` | Automated trigger accepted, awaiting pre-SOS | Acquire lock |
| `PRE_SOS` | Alarm active, countdown visible, cancel available | Ring alarm, start countdown |
| `SOS_ACTIVE` | Emergency confirmed | Acquire GPS, fire initial SMS |
| `RECORDING` | Audio + video evidence capture | 30s recording, parallel GPS polling |
| `UPLOADING` | Media upload in progress | Cloudinary direct upload |
| `EVIDENCE_READY` | Upload complete, evidence URLs available | Prepare final SMS payload |
| `DISPATCHED` | Evidence SMS sent to all contacts | Log to backend, mark complete |
| `COOLDOWN` | Automated triggers blocked | Duration: 10 min default |

---

## 6. SOS Event Timeline

Precise timing for the `triggerAutoSOS` path:

| Time | Action |
|---|---|
| `t = 0ms` | Re-entry lock acquired (`isProcessingAutoSOS = true`) |
| `t = 5ms` | UI cleanup, alarm stopped |
| `t = 10ms` | Local cooldown flag set |
| `t = 15ms` | Location permission check |
| `t ≈ 200ms+` | GPS acquisition begins |
| `t ≈ 1500ms+` | **Initial alert SMS dispatched** ← critical milestone |
| `t = 1510ms` | Location tracking sequence starts |
| `t = 1520ms` | Voice loop stopped; recording starts |
| `t = 1550ms` | Periodic GPS polling starts (every 5s) |
| `t = 1600ms` | Backend sync (`/trigger`) initiated |
| `t ≈ 5000ms+` | Backend SOS ID returned |
| `t = 31520ms` | Recording hard timeout |
| `t = 45000ms` | Watchdog hard stop (full sequence cleanup) |
| `t ≈ 47000ms+` | Evidence SMS dispatched (if uploads complete) |

> The gap between `t=1500ms` (initial SMS) and `t=47000ms` (evidence SMS) is intentional. Contacts are alerted *before* evidence is ready — never after.

---

## 7. Trigger Arbitration Rules

1. **Manual has absolute priority** over all automated triggers
2. **Manual bypasses the restriction gate** (cooldown does not apply)
3. **First accepted automated trigger** acquires a lock; all others are dropped
4. **Re-entry is blocked** while any SOS processing is active
5. **Voice relinquishes the microphone** when recording begins
6. **Automated triggers during an active SOS cycle are silently ignored**

---

## 8. Orchestrator Contract (`useSOSOrchestrator` hook)

The orchestrator is the **single authority** for SOS lifecycle. No other component should independently trigger or manage the SOS sequence.

### Owned State

| Variable | Type | Purpose |
|---|---|---|
| `preSosActive` | `boolean` | Pre-SOS alarm/countdown active |
| `countdown` | `number` | Seconds remaining before auto-trigger |
| `cooldown` | `boolean` | Automated trigger gate |
| `lastSOS` | `SOSRecord \| null` | Most recent completed SOS record |

### Owned Refs

| Ref | Purpose |
|---|---|
| `countdownTimerRef` | Manages pre-SOS countdown interval |
| `recordingTimerRef` | Enforces 30s recording cap |
| `safetyTimerRef` | Watchdog — hard-kills sequence at 45s |
| `mediaUploadsRef` | Tracks upload completion for evidence gating |
| `isProcessingAutoSOS` | Re-entry lock for automated trigger path |

### Direct Responsibilities

- Alarm start/stop lifecycle
- Trigger coordination and arbitration
- Initial SMS dispatch
- Recording start/stop coordination
- Evidence synchronization (wait for uploads or timeout)
- Final evidence SMS dispatch
- Watchdog enforcement

### Delegates To

| Concern | Delegated To |
|---|---|
| GPS acquisition + polling | `useLocationTracker` |
| Audio capture | `useAudioRecording` |
| Rate limiting / cooldown | `useSOSRestriction` |

---

## 9. Service Contracts

### `smsService.ts`

**Owns:** Native SMS, Twilio HTTP fallback, recipient formatting, multipart splitting

**Guarantees:**
- Attempts native silent SMS first
- Falls back to Twilio if native fails
- Returns a structured send result (not a raw promise rejection)

**Does not guarantee:** Delivery confirmation. Native "success" = carrier accepted the send request, not that the recipient received it.

---

### `sosService.ts`

**Owns:** `/api/sos/trigger`, `/api/sos/update-location`, media metadata sync

**Does not own:** SMS dispatch (that is `smsService`)

---

### `contactService.ts`

**Owns:** Contact CRUD operations, schema validation

---

### `apiClient.ts`

**Owns:** Axios instance configuration, base URL resolution, auth header injection

---

## 10. Native Module Contract (`expo-silent-sms`)

### Responsibility Split

| Responsibility | Owner |
|---|---|
| `SmsManager` interaction | Native (Kotlin) |
| Multipart message splitting | Native |
| SIM card selection | Native |
| `PendingIntent` lifecycle | Native |
| `BroadcastReceiver` status codes | Native |
| Send policy (who, when, what) | JS layer |
| Recipient list | JS layer |
| Message content | JS layer |
| Fallback logic on failure | JS layer |

### Critical Contract Rule

> **Native SMS "success" does not mean delivery.**
>
> A success result means the Android carrier subsystem accepted the send request. Network conditions, recipient state, and carrier routing are outside the module's control. The JS layer must **never assume** an SMS was received based on a native success code.

---

## 11. Background Execution Matrix

| Condition | Voice Detection | Motion | SMS | GPS | Media Upload |
|---|---|---|---|---|---|
| Foreground (active) | Yes | Yes | Yes | Yes | Yes |
| Screen off | Partial | Yes | Yes | Yes | Yes |
| Background | Limited | Yes | Yes | Yes | Yes |
| Doze mode | No | No | Partial | Limited | Yes |
| App swiped away | No | No | No | No | No |

> **OEM Note:** Xiaomi, Oppo, and Vivo apply aggressive background kill policies on top of standard Android Doze. AutoStart permission and battery unrestricted mode are required on these devices. See [User Guide — Section 14](./Guide.md#14-important-android-settings-highly-recommended).

---

## 12. Failure Matrix

| Failure Condition | System Behavior |
|---|---|
| Location permission denied | Abort SOS |
| GPS slow / timeout | Send SMS with last known location or none |
| Backend unreachable | Continue with local SMS-only SOS |
| Native SMS fails | Attempt Twilio HTTP fallback |
| Twilio fails | Log error, continue (no crash) |
| Audio upload fails | Send evidence SMS with video link only |
| Video upload fails | Send evidence SMS with audio link only |
| Both uploads fail | Send plain fallback SMS (no media links) |
| TinyURL shortening fails | Use raw Cloudinary URL in SMS |
| App killed mid-SOS | Session ends; no recovery |

---

## 13. Recovery Contract

| Scenario | Behavior |
|---|---|
| App restart mid-SOS | No session recovery — SOS terminates |
| App restart mid-cooldown | Cooldown timer restored from AsyncStorage |
| Backend recovers after timeout | No replay of missed sync events |
| Media upload completes before evidence wait expires | Include in evidence SMS |
| Media upload completes after evidence SMS dispatched | Drop — no duplicate SMS |
| Late native SMS callback | Log only — no retry |

---

## 14. Storage Contract

| Key | Owner | Type | Purpose |
|---|---|---|---|
| `CALCULATOR_PIN` | `auth-lock` | String | Stealth PIN for calculator unlock |
| `emergency_contacts` | `contactService` | JSON array | SOS recipient list |
| `sos_restriction_pause_end_time` | `useSOSRestriction` | Timestamp | Manual pause end time |
| `sos_restriction_last_trigger_time` | `useSOSRestriction` | Timestamp | Last automated trigger (cooldown reference) |
| `custom_alarm_uri` | `useSOSOrchestrator` | URI string | Custom alarm sound URI |
| `safe_words` | `useSafeWords` | JSON array | Voice cancellation phrases |

> All values are currently stored in plaintext AsyncStorage. See [Section 18](#18-security-model) for required hardening.

---

## 15. Backend API Contract

### `POST /api/sos/trigger`

**Request:**
```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "contactNumber": "+919876543210",
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

**Response:**
```json
{
  "id": 42,
  "message": "SOS triggered successfully",
  "timestamp": "2025-01-01T12:00:00.123Z"
}
```

---

### `POST /api/sos/update-location`

**Request:**
```json
{
  "id": 42,
  "latitude": 28.6140,
  "longitude": 77.2091,
  "mediaUrl": "https://res.cloudinary.com/.../video.mp4",
  "audioUrl": "https://res.cloudinary.com/.../audio.m4a",
  "contactNumber": "+919876543210"
}
```

> `mediaUrl` and `audioUrl` are optional. If uploads failed, they are omitted.

---

## 16. Observability

### Current Sources of Truth

| Source | Scope |
|---|---|
| `console.log` / `console.error` | Development-time debugging only |
| `lastSOS` in-memory object | Current session state |
| Backend audit trail (`/trigger` response) | Persistent server-side record |
| Native SMS error codes | Low-level delivery diagnostics |

### Gaps (Dev-Grade, Not Production-Grade)

- No centralized log aggregation
- No real-time alerting on SOS failures
- No crash-to-SOS correlation
- No post-session replay capability

> See [Section 22](#22-refactor-priorities) — observability is a rated refactor priority.

---

## 17. Known Unsafe Zones

These are areas where race conditions, edge cases, or incomplete handling exist. Engineers must be aware of them before modifying adjacent code.

| # | Issue | Risk |
|---|---|---|
| 1 | Evidence upload timeout vs. slow network | Evidence may be dropped even if upload is 95% complete |
| 2 | Stale SOS ID during recording stop | `update-location` may fire with wrong or null SOS ID |
| 3 | Overlap window between manual + auto trigger | Brief window where both paths could activate |
| 4 | Background kill is terminal | No foreground service; app death ends all SOS activity |
| 5 | No session replay on restart | Mid-SOS restart silently fails — no user notification |
| 6 | Voice stops when recording starts | Hands-free re-trigger is impossible during active SOS |
| 7 | Limited post-crash forensics | No way to reconstruct what happened during a failed SOS |

---

## 18. Security Model

### Current Risks

| Risk | Severity | Description |
|---|---|---|
| Groq API key in client bundle | High | Key can be extracted from APK |
| PIN in plaintext AsyncStorage | High | Accessible via ADB on non-rooted devices |
| Cloudinary config in client | Medium | Unauthorized uploads possible |
| Render free-tier backend | Medium | Cold starts (30–60s), uptime limits |

### Required Hardening Actions

| Risk | Fix |
|---|---|
| Groq key | Proxy all Whisper requests through your backend |
| Calculator PIN | Migrate to Android Keystore via `expo-secure-store` |
| Cloudinary config | Move to server-side signed upload (backend issues upload tokens) |
| Backend reliability | Upgrade from Render free-tier to a paid plan or alternative |

### Privacy Guarantees

- Camera and microphone are **only active** during explicit listening and SOS phases
- Emergency contact data is stored locally and never transmitted except during active SOS
- No analytics, no advertising, no third-party data sharing

---

## 19. Performance Constraints

| Parameter | Value |
|---|---|
| Voice transcription chunk | 3 seconds |
| SOS recording duration | 30 seconds |
| GPS polling interval | 5 seconds |
| Watchdog timeout | 45 seconds |
| Upload wait window | 30 seconds |
| Default cooldown period | 10 minutes |
| Target initial SMS latency | < 2 seconds from trigger |

The system is **mobile-resource constrained and latency-sensitive**. Do not add synchronous blocking operations to the SOS path.

---

## 20. Deployment Reality

| Component | Current Setup | Known Risk |
|---|---|---|
| App runtime | Expo SDK 54, Android-first | OEM battery kill, Doze |
| APK distribution | EAS Build + GitHub Releases | No auto-update mechanism |
| Backend | Node.js on Render free-tier | Cold starts, limited uptime |
| Media storage | Cloudinary | Direct client upload (key exposure) |
| SMS fallback | Twilio HTTP | Requires active internet |
| SMS primary | Kotlin native SIM bridge | Works offline; no delivery receipt |

---

## 21. Change Safety Rules

Before merging any change, verify it does not violate the following:

| Check | Question |
|---|---|
| SMS timing | Does this delay the initial alert SMS beyond 2 seconds? |
| Manual SOS | Does this break or delay manual SOS in any code path? |
| Evidence deduplication | Does this risk sending duplicate evidence SMS? |
| Cooldown semantics | Does this incorrectly apply cooldown to manual SOS? |
| Re-entry safety | Does this introduce a new re-entry window in the orchestrator? |
| Cancel window | Does this prevent or delay the pre-SOS cancel action? |
| Native assumption | Does this assume native SMS success = delivery? |
| Background survival | Does this reduce background execution reliability? |
| Fail-open guarantee | Does this allow a non-critical error to block SOS? |

**If any answer is "yes," the change is unsafe until formally analyzed and approved.**

---

## 22. Refactor Priorities

Ordered by safety impact:

| Priority | Area | Goal |
|---|---|---|
| 1 | **Background survivability** | Implement Android Foreground Service via WorkManager |
| 2 | **PIN security** | Migrate to `expo-secure-store` / Android Keystore |
| 3 | **API key hardening** | Proxy Groq and Cloudinary through backend |
| 4 | **Session recovery** | Persist SOS state; recover from mid-SOS crash |
| 5 | **Observability** | Add structured logging + remote error reporting |
| 6 | **Hindi-first trigger expansion** | Add broader regional language keyword support |
| 7 | **State machine formalization** | Migrate to XState for explicit state + transition contracts |
| 8 | **iOS feasibility** | Research AVAudioSession + VOIP background modes |

---

## 23. Engineering Mental Model

Aegis is not a UI application.

It is a **covert emergency state machine running on hostile mobile infrastructure** — with aggressive power management, unpredictable OEM behavior, and a user who may be physically restrained.

Every engineering decision must be evaluated through this lens:

> *If the user is in genuine danger right now, does this change make them safer or less safe?*

The answer must always be: **safer**.

```
Safety > Delivery > Evidence > Sync > Analytics > UX
```