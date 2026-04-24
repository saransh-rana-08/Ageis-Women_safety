# Aegis - Women Safety: Project Status & Handover Report

## 1. Project Overview
**Aegis** is a high-reliability women's safety application designed to provide immediate assistance through automated emergency triggers. Unlike standard safety apps, Aegis utilizes advanced AI for voice recognition and background orchestration to ensure evidence is captured and help is summoned even when the user cannot physically interact with their phone.

---

## 2. Core Architecture ("The How")
The app follows a **Modular Hook-Driven Architecture**:

*   **SOS Orchestrator (`useSOSOrchestrator.ts`)**: The "Brain" of the app. It coordinates between location tracking, audio recording, video capture, and SMS dispatch. It ensures that if one trigger fires, all safety systems synchronize.
*   **Voice SOS Feature (`useVoiceSOS.ts`)**: Uses a continuous loop to capture 3-second audio chunks. These are sent to **Groq Whisper v3** (AI) for near-instant transcription. If keywords like "Help" or "Save me" are detected, it triggers the SOS sequence.
*   **Safety Restriction System (`useSOSRestriction.ts`)**: Prevents "Alert Fatigue" and accidental triggers by managing cooldowns and user-defined pauses.
*   **Media Service (`sosService.ts`)**: Handles the reliable upload of evidence. It uses a **Direct-to-Cloudinary** architecture, bypassing the backend for binary uploads to ensure speed and reliability.
*   **Native Silent SMS (`modules/expo-silent-sms`)**: A custom Expo Native Module (Kotlin/Android) that sends background SMS directly through the Android Telephony Subsystem using `SmsManager`, bypassing the need for user interaction.

---

## 3. Current Status ("The What")
As of the latest update, the following components are fully implemented and stabilized:

*   **Voice SOS Hardening**: Fixed critical race conditions and hardware glitches. The microphone loop is now resilient, handles permissions gracefully, and includes auto-recovery if the mic is blocked.
*   **Network Reliability**: Configured for both local development and production (`aarambh-app-backend.onrender.com`).
*   **Media Pipeline**: Fully transitioned to Cloudinary. The app successfully captures 15s of video and audio evidence, uploads it, and generates secure URLs for emergency contacts.
*   **Permissions**: Implemented a robust permission-gating system for Microphone, Camera, and Location.
*   **Native Silent SMS Module (`expo-silent-sms`)**: **Fully implemented.** The custom Kotlin module is complete with:
    *   Automatic **multipart message splitting** via `smsManager.divideMessage()` for long SOS payloads (>160 chars).
    *   **Dual-SIM / Multi-subscription support** via `getSubscriptionInfoAsync()` with a `subscriptionId` option.
    *   **Retry logic** configurable via the `retryCount` option in `sendSMSAsync()`.
    *   **OEM detection** (`getOEMInfoAsync()`) to flag devices (e.g., Xiaomi, Oppo) that require manual AutoStart permission.
    *   **Mock Mode** (`enableMockMode()`) for safe testing without sending real SMS.
    *   Strict `ContextCompat.checkSelfPermission` enforcement before any execution.
*   **EAS Build Pipeline**: Production build configured and triggered via `eas build --platform android --profile production`.
*   **Dependency Sync**: All Expo SDK 54 packages updated to their compatible patch versions (`expo@54.0.33`, `expo-router@6.0.23`, etc.) via `npx expo install --check`.

---

## 4. Technical Stack
*   **Framework**: React Native (Expo SDK 54.0.33)
*   **Navigation**: Expo Router 6.0.23 (File-based)
*   **AI Transcription**: Groq Whisper API (Whisper-large-v3)
*   **Media Storage**: Cloudinary (Direct Device-to-Cloud)
*   **Backend Communication**: Axios with standardized `apiClient`
*   **Animations**: Moti & Reanimated (for a premium, high-stakes UI)
*   **Native SMS**: Custom `expo-silent-sms` Kotlin module (Android `SmsManager`)
*   **Build System**: EAS Build (production profile)

---

## 5. Native Module API Reference (`expo-silent-sms`)

| Method | Signature | Description |
|---|---|---|
| `isAvailableAsync()` | `() => Promise<boolean>` | Returns `true` if device hardware supports SMS dispatch |
| `requestPermissionsAsync()` | `() => Promise<PermissionResult>` | Prompts for `SEND_SMS` permission |
| `getSubscriptionInfoAsync()` | `() => Promise<SubscriptionInfo[]>` | Lists all available SIM subscriptions (Dual-SIM support) |
| `getOEMInfoAsync()` | `() => Promise<OEMInfo>` | Returns manufacturer info and AutoStart flag |
| `enableMockMode()` | `(enabled: boolean) => void` | Enables mock mode for safe testing |
| `sendSMSAsync()` | `(phones: string[], msg: string, opts?: SmsOptions) => Promise<SmsResult[]>` | Sends silent SMS to all recipients; handles multipart & retry |

---

## 6. EAS Build Status
*   **Production build is currently in progress** via `eas build --platform android --profile production`.
*   The build incorporates the `expo-silent-sms` native Kotlin module and all required Android permissions (`SEND_SMS`, `READ_PHONE_STATE`).
*   Post-build, the APK must be tested to confirm the `SEND_SMS` permission dialog and silent dispatch work on a physical device.

---

## 7. Critical Next Steps ("The Road Ahead")

### 1. Background Persistence Hardening
*   Verify that the `staysActiveInBackground` flags in the Audio and Orchestrator hooks remain active under strict Android battery optimization (Doze Mode) in the production APK.
*   Test on OEM devices flagged by `getOEMInfoAsync()` (Xiaomi, Oppo, OnePlus) which require manual AutoStart permission from the user.

### 2. SMS Fallback Chain Verification
*   Test the full fallback chain on the physical device: **Native Silent SMS → Twilio Cloud API** to confirm both layers function correctly end-to-end.

### 3. iOS Parity (Future)
*   The `expo-silent-sms` module is Android-only by design. The iOS layer gracefully returns `false` and falls back to Twilio. A CallKit-based alternative should be explored for iOS emergency alerting.

---

## 8. Developer Notes
*   **Environment Variables**: Ensure `EXPO_PUBLIC_GROQ_API_KEY` and Cloudinary credentials are set in the CI/CD pipeline (EAS Secrets).
*   **Trigger Phrases**: Can be customized in `useVoiceSOS.ts` to support more languages (currently supports English/Hindi/Hinglish).
*   **Permission Declaration**: `SEND_SMS` is declared in both `app.json → android.permissions` and `modules/expo-silent-sms/android/src/main/AndroidManifest.xml` to ensure correct manifest merging during EAS builds.
*   **Dependency Sync**: Run `npx expo install --check` before every EAS build submission to keep native module versions aligned.
