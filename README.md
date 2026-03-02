# Ageis: Women Safety Application

Ageis is a life-critical emergency and women safety mobile application built with **React Native (Expo Bare Workflow)**. It is designed to act as an invisible shield, instantly reacting to emergencies by notifying trusted contacts with critical evidence and real-time location data.

## Key Features

- **Automated SOS Triggering**: Detects physical distress (like sudden shaking or drops) and automated voice commands to trigger SOS without touching the phone.
- **Real-Time Location Tracking**: Instantly captures precise GPS coordinates and forwards them to emergency contacts via SMS alongside a Google Maps tracking link.
- **Background Media Evidence**: Silently records audio (15s) and video (15s) evidence simultaneously during an emergency.
- **Direct Cloudinary Integration**: Evidence is instantly and securely uploaded to Cloudinary directly from the device (using optimized FormData), completely bypassing backend relay delays. 
- **Twilio & Native SMS Fallback**: Ensures SOS messages are reliably delivered. It fires a primary Twilio SMS and falls back on native on-device SMS payloads if the network is unstable.
- **Personalized SOS Payloads**: Fetches and caches the user's profile to inject their real name into the emergency texts (`"🚨 EMERGENCY! [Name] needs help."`).
- **Pre-SOS Automated Sequence & Siren**: A warning sequence featuring a loud alarm (with support for custom alarm sounds) that can deter potential threats before the deep SOS tracking engages.

## Technology Stack

- **Frontend**: React Native, Expo (SDK 54 - Bare Workflow), React Navigation v7
- **Media Uploads**: Cloudinary
- **Networking**: Axios, Fetch API (Multipart FormData)
- **Local Storage**: AsyncStorage
- **Sensors & Hardware**: Expo Camera, Expo AV (Audio), Expo Location, Expo Sensors (Accelerometer for shake detection)
- **SMS Delivery**: Expo SMS (Native), Twilio (via backend)

## Project Structure

```text
├── app/                  # Expo Router file-based navigation (Tabs, Profile, Login etc.)
├── components/           # Reusable UI components
├── constants/            # Global configs, Colors, CloudinaryConfig, API Endpoints
├── context/              # Context providers (if applicable)
├── hooks/home/           # Core SOS logic, Orchestrator, Audio/Video recording, Safe Words
├── services/             # API clients: sosService (Cloudinary), smsService, contactService
├── assets/               # Local static assets and default alarm sounds
└── ... 
```

## Setup & Installation

**Prerequisites:** Node.js, npm/bun/yarn, Android Studio (for Android emulation), and an Expo Go account.

1. **Clone the repository:**
   ```bash
   git clone <https://github.com/saransh-rana-08/Ageis-Women_safety.git>
   cd Ageis-Women_safety
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   *(Note: This project relies on Expo SDK 54 features.)*

3. **Configure Environment Variables:**
   - Create a `.env` file or export variables.
   - Set up your Cloudinary Unsigned Upload Preset and Cloud Name in `constants/CloudinaryConfig.ts`.
   - Update `constants/Config.ts` if your auth or Twilio backend URLs differ from the defaults.

4. **Start the development server:**
   ```bash
   npm start
   ```

## Security & Privacy Notes

- **Unsigned Uploads**: Cloudinary API keys and secrets are *never* bundled in the client code. Media is uploaded securely using Unsigned Presets.
- **Local Caching**: The user's Auth token is stored in AsyncStorage and verified on mount to cache the user's name for instant availability during an emergency.
- **Permissions Required**: The app requests Camera, Microphone, Foreground & Background Location, and SMS permissions to function properly.
