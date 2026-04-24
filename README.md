# Aegis: Advanced Women Safety Application

**Aegis** is a life-critical, high-reliability emergency response application built with **React Native (Expo SDK 54)**. Designed as an "invisible shield," Aegis utilizes background orchestration and AI-driven voice triggers to ensure that help is summoned and evidence is captured even when a user cannot physically reach their device.

---

## Key Features

### AI-Driven Voice SOS (Groq Whisper v3)
- **Continuous Monitoring**: A highly optimized audio loop continuously monitors for distress keywords in the background.
- **AI Transcription**: Leverages **Groq's Whisper-large-v3** for near-instant, high-accuracy transcription of English, Hindi, and Hinglish.
- **Keyword Detection**: Automatically triggers a full SOS sequence upon detecting phrases like "Help," "Save me," or custom user-defined triggers.

### Multi-Modal SOS Orchestration
- **Evidence Gathering**: Simultaneously captures **15s of High-Quality Video** and **Audio** evidence during an emergency.
- **Direct Cloudinary Integration**: Evidence is uploaded instantly to Cloudinary via optimized FormData, bypassing backend bottlenecks for maximum speed.
- **Real-Time Location Tracking**: Captures precise GPS coordinates and generates live Google Maps tracking links for emergency contacts.

### Native Silent SMS (Android)
- **Zero-Interaction Dispatch**: A custom native Kotlin module (`expo-silent-sms`) sends SMS alerts directly through the Android Telephony Subsystem — **no user tap required**.
- **Multipart Message Support**: Automatically fragments messages >160 characters (e.g., SOS payloads with multiple URLs) using `SmsManager.divideMessage()`.
- **Dual-SIM Support**: Detects all active SIM subscriptions and allows specifying a preferred SIM via `subscriptionId`.
- **Retry Logic**: Configurable `retryCount` option for mission-critical delivery resilience.
- **OEM AutoStart Detection**: Identifies devices (Xiaomi, Oppo, OnePlus, etc.) that require manual AutoStart permission and surfaces a warning to the user.

### Safety Restriction & Cooldown System
- **Intelligent Gating**: Prevents accidental triggers through a robust "Pause & Cooldown" system via `useSOSRestriction`.
- **Safety Timer**: Provides a warning sequence with a loud siren (customizable) to deter threats before deep tracking initiates.

### Twilio Cloud SMS Fallback
- **Fault-Tolerant Chain**: If Native Silent SMS fails or is denied, the system automatically falls back to **Twilio Cloud API** for guaranteed delivery.
- **Phone Number Normalization**: Auto-formats Indian numbers to E.164 (`+91XXXXXXXXXX`) before dispatch.
- **Personalized Alerts**: Injects the user's real name and live evidence links directly into the SOS message.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | React Native, Expo SDK **54.0.33** (Bare Workflow) |
| Navigation | Expo Router **6.0.23** (File-based) |
| AI Engine | Groq Whisper-large-v3 |
| Media Pipeline | Cloudinary (Direct Device-to-Cloud) |
| Native SMS | Custom `expo-silent-sms` Kotlin module (Android `SmsManager`) |
| Cloud SMS Fallback | Twilio (via backend) |
| Orchestration | Custom hook-driven state machine (`useSOSOrchestrator`) |
| Animations | Moti, Reanimated |
| Storage | AsyncStorage (Persistent safety tokens & profile cache) |
| Build System | EAS Build (production profile) |

---

## Project Structure

```text
├── app/                        # Expo Router file-based navigation (Tabs, Profile, Login)
├── app/features/               # Core feature logic: VideoSOS, VoiceSOS
├── components/                 # Premium UI components & Motion wrappers
├── constants/                  # Global Configs, Cloudinary, API Endpoints
├── hooks/home/                 # SOS Orchestrator, Location Tracker, Audio Hook
├── modules/
│   └── expo-silent-sms/        # Custom Native Kotlin Module (Android SmsManager)
│       ├── android/            # Kotlin source & AndroidManifest
│       ├── index.ts            # TypeScript API layer (typed interface)
│       └── expo-module.config.json
├── services/                   # API Clients: SOS (Cloudinary), SMS, Contacts
└── assets/                     # Local media & default alarm sounds
```

---

## Setup & Deployment

**Prerequisites:** Node.js, EAS CLI (`npm i -g eas-cli`), and a Groq API Key.

### 1. Clone & Install
```bash
git clone https://github.com/saransh-rana-08/Ageis-Women_safety.git
cd Ageis-Women_safety
npm install
```

### 2. Environment Configuration
Create a `.env` file in the project root:
```env
EXPO_PUBLIC_GROQ_API_KEY=your_groq_api_key_here
```
- Update `constants/CloudinaryConfig.ts` with your **Cloud Name** and **Unsigned Upload Preset**.
- Default Backend: `https://aarambh-app-backend.onrender.com`

### 3. Development (Expo Go — Limited Features)
```bash
npx expo start
```
> **Note**: The `expo-silent-sms` native module and `SEND_SMS` permission require an EAS Development or Production Build. Native SMS will not function in Expo Go.

### 4. EAS Development Build (Full Native Features)
```bash
eas build --platform android --profile development
```

### 5. Production Build
```bash
eas build --platform android --profile production
```

### 6. Dependency Health Check
Run this before any EAS build submission to ensure all native module versions are aligned:
```bash
npx expo install --check
```

---

## Native Module: `expo-silent-sms`

This custom Expo Module interfaces directly with the Android Telephony Subsystem. It is the core mechanism enabling **zero-interaction SOS dispatch**.

### API

| Method | Description |
|---|---|
| `isAvailableAsync()` | Returns `true` if the device hardware supports SMS dispatch |
| `requestPermissionsAsync()` | Requests the `SEND_SMS` permission |
| `getSubscriptionInfoAsync()` | Lists all SIM subscriptions (Dual-SIM support) |
| `getOEMInfoAsync()` | Returns manufacturer name and AutoStart flag |
| `enableMockMode(enabled)` | Enables mock mode for safe testing (no real SMS sent) |
| `sendSMSAsync(phones, msg, opts?)` | Sends silent SMS to all recipients with multipart & retry support |

### `SmsOptions`
```typescript
{
  subscriptionId?: number;  // Target a specific SIM (Dual-SIM)
  retryCount?: number;      // Number of retries on failure
}
```

---

## Security & Privacy

- **Direct Uploads**: Media is uploaded securely via Unsigned Presets; no API secrets are stored on the device.
- **Local Privacy**: User profile data is cached locally to ensure SOS messages can be personalized even without immediate internet access.
- **Permission Gating**: Full compliance with Android privacy standards for `CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, and `SEND_SMS`.
- **Environment Variables**: API keys are injected at build time via EAS Secrets and never bundled in plain text.

---

## Known Limitations & Roadmap

- **iOS**: `expo-silent-sms` is Android-only. On iOS, the system falls back to Twilio. A CallKit-based alerting alternative is planned.
- **OEM Restrictions**: Devices from Xiaomi, Oppo, and OnePlus may silently block background SMS until the user grants AutoStart permission manually. Detected automatically via `getOEMInfoAsync()`.
- **Background Persistence**: Deep background survival under Android Doze Mode is actively being validated on the production APK build.
