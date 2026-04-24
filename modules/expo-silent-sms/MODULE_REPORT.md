# Native Module Report: `expo-silent-sms`

## 1. The "Why" (Motivation)
In a life-critical application like **Aegis**, the standard `expo-sms` library presents a major limitation: it requires the user to manually click "Send" in the default SMS app. In an emergency (e.g., physical restraint or unconsciousness), a user cannot interact with the phone. 

**`expo-silent-sms`** was built to provide **Automated SOS Dispatching**, allowing the app to send background SMS alerts directly through the mobile carrier without any manual user intervention.

---

## 2. The "What" (Capabilities)
This is a custom **Expo Module** that interfaces directly with the Android **Telephony Subsystem**.

*   **Silent Dispatch**: Sends SMS in the background without opening the SMS app.
*   **Permission Gating**: Integrated permission requester for the sensitive `SEND_SMS` permission.
*   **Long Message Support**: Automatically fragments and sends multi-part messages (strings > 160 characters), essential for SOS alerts containing multiple URLs (Location, Audio, Video).
*   **Native Reliability**: Uses the Android `SmsManager` directly for high success rates across different Android versions (including API 31+).

---

## 3. The "How" (Technical Implementation)

### **Native Layer (Kotlin/Android)**
*   **Manager Acquisition**: Dynamically resolves the `SmsManager` using `context.getSystemService` for Android 12+ (API 31) and legacy `getDefault()` for older versions.
*   **Multipart Logic**: Employs `smsManager.divideMessage(message)` and `smsManager.sendMultipartTextMessage()` to handle data-heavy SOS payloads.
*   **Security**: Enforces strict `ContextCompat.checkSelfPermission` checks before execution to prevent runtime crashes.
*   **Manifest Integration**: Includes a local `AndroidManifest.xml` with `<uses-permission android:name="android.permission.SEND_SMS" />` to ensure seamless merging during EAS builds.

### **JavaScript Layer (TypeScript)**
*   **Type Safety**: Exports a strictly typed interface `ExpoSilentSmsModule` for `isAvailableAsync`, `requestPermissionsAsync`, and `sendSMSAsync`.
*   **Require Native**: Uses Expo's `requireNativeModule` to link the native Kotlin definition with the React Native bridge.

---

## 4. Current API Status
*   **`isAvailableAsync()`**: Returns `true` if the hardware supports SMS dispatch.
*   **`requestPermissionsAsync()`**: Prompts the user for `SEND_SMS` permission using the standard Expo permission dialog. Returns a boolean status.
*   **`sendSMSAsync(phoneNumber: string, message: string)`**: The core execution function. Returns `true` upon successful handover to the carrier's SMS service.

---

## 5. EAS & Production Requirements
To use this module in production, the app **must** be built using **EAS Build** (standard Expo Go does not support custom native modules or the `SEND_SMS` permission). 

**Critical Permission Declaration:**
The permission is declared in:
1. `app.json` (android.permissions)
2. `modules/expo-silent-sms/android/src/main/AndroidManifest.xml` (Module Level)

---

## 6. Performance & Reliability Notes
*   **Failure Modes**: The module will throw descriptive error codes (`ERR_PERMISSION`, `ERR_CONTEXT`, `ERR_SEND`) that can be caught in the JS layer to trigger fallbacks (like the Twilio Cloud API).
*   **Threading**: Native functions are called asynchronously to avoid blocking the JS thread during carrier interaction.
