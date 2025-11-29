import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { Audio } from "expo-av";
import { CameraView } from "expo-camera";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import { Accelerometer } from "expo-sensors";
import * as SMS from "expo-sms";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useVideoSOS } from "../features/videoSOS/useVideoSOS";
import useVoiceSOS from "../features/voiceSOS/useVoiceSOS";

// Constants
// Constants
const BASE_URL = "http://10.10.181.126:8082";
const API_URL = `${BASE_URL}/api/sos/trigger`;
const CONTACTS_URL = `${BASE_URL}/api/contacts`;
const UPDATE_URL = `${BASE_URL}/api/sos/update-location`;

interface Contact {
  id: number;
  name: string;
  phoneNumber: string;
  primaryContact: boolean;
}

export default function HomeScreen() {
  const router = useRouter();
  const [data, setData] = useState({ x: 0, y: 0, z: 0 });
  const [cooldown, setCooldown] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [lastSOS, setLastSOS] = useState<{
    time: string | null;
    backendOk: boolean | null;
    smsOk: boolean | null;
  }>({
    time: null,
    backendOk: null,
    smsOk: null,
  });

  // 🔥 New states for tracking + recording
  const [tracking, setTracking] = useState(false);
  const [intervalId, setIntervalId] = useState<any>(null);
  const [sosId, setSosId] = useState<number | null>(null);
  const sosIdRef = useRef<number | null>(null); // 🟢 Ref to avoid stale state in callbacks
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null); // 🟢 Ref to avoid stale closure in timeout

  // 📦 Media Uploads Ref for coordinating SMS
  const mediaUploadsRef = useRef<{
    audio?: string;
    video?: string;
    timer?: any; // Use any to avoid NodeJS vs Browser/RN type conflicts
    sent?: boolean;
  }>({});

  const THRESHOLD = 2.3; // lower = more sensitive, higher = less

  // 🗣 Voice SOS Hook
  const { startListening, stopListening, isListening, isModelReady } = useVoiceSOS({
    onKeywordDetected: async (info: any) => {
      console.log("🗣 Voice SOS triggered:", info.keyword);
      // Stop listening immediately to release mic for SOS recording
      await stopListening();
      // Trigger Auto SOS
      triggerAutoSOS();
    },
    onAudioRecorded: (uri: string) => {
      // This is for the continuous listening chunks (optional to upload)
      // For now, we only upload the main SOS recording.
      // If you want to upload the trigger phrase audio, do it here.
      // uploadAudio(uri); 
    },
    onError: (err: any) => {
      console.log("🗣 Voice SOS Error:", err);
    }
  });

  // 📹 Video SOS Hook
  const {
    cameraRef,
    isRecording: isVideoRecording,
    startRecording: startVideoRecording,
    stopRecording: stopVideoRecording,
    permission: cameraPermission,
    requestPermission: requestCameraPermission
  } = useVideoSOS({
    onRecordingFinished: (uri) => {
      uploadVideo(uri);
    }
  });

  // Manage Voice Listener based on Tracking state and Screen Focus
  useFocusEffect(
    useCallback(() => {
      // Start listening only if focused AND not tracking
      if (!tracking) {
        startListening();
      }

      // Cleanup: Stop listening when unfocused or when tracking starts
      return () => {
        stopListening();
      };
    }, [tracking, startListening, stopListening])
  );

  const refreshContacts = async () => {
    try {
      const res = await axios.get(CONTACTS_URL);
      setContacts(res.data);
      console.log(
        "📇 Loaded contacts:",
        res.data.map((c: Contact) => c.phoneNumber)
      );
    } catch (err: any) {
      console.log("❌ Failed to load contacts:", err?.message || err);
    }
  };

  // 🔄 Keep track of latest handleMotion to avoid stale closures in listener
  const handleMotionRef = useRef((data: any) => { });

  useEffect(() => {
    handleMotionRef.current = handleMotion;
  });

  const handleMotion = (motionData: { x: number; y: number; z: number }) => {
    const { x, y, z } = motionData;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    if (magnitude > THRESHOLD && !cooldown && !tracking) {
      console.log("🚨 Sudden motion detected:", magnitude);
      triggerAutoSOS();
    }
  };

  useEffect(() => {
    console.log("📡 Starting accelerometer listener...");
    Accelerometer.setUpdateInterval(200);

    const subscription = Accelerometer.addListener((accelerometerData) => {
      setData(accelerometerData);
      // Call the REF to get the latest state (contacts, tracking, etc.)
      handleMotionRef.current(accelerometerData);
    });

    // load contacts from backend
    refreshContacts();

    return () => {
      console.log("📡 Stopping accelerometer listener...");
      subscription && subscription.remove();

      // stop tracking & clear interval if any
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [intervalId]);

  const sendSMSWithLocation = async (latitude: number, longitude: number) => {
    console.log("📩 Checking SMS availability...");
    const isAvailable = await SMS.isAvailableAsync();
    console.log("📩 SMS available:", isAvailable);

    const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
    const message = `🚨 EMERGENCY! I need help.\nMy Location:\n${mapsLink}`;

    const recipients =
      contacts.length > 0
        ? contacts.map((c) => c.phoneNumber)
        : ["+917906272840"]; // fallback to your number

    console.log("📇 Using recipients:", recipients);

    if (!isAvailable) {
      Alert.alert("SMS unavailable", "Cannot open SMS app on this device.");
      return false;
    }

    try {
      const result = await SMS.sendSMSAsync(recipients, message);
      console.log("📩 SMS result:", result);
      return true;
    } catch (e: any) {
      console.log("📩 SMS error:", e?.message || e);
      Alert.alert("SMS Error", "Could not open SMS app.");
      return false;
    }
  };

  // 🎙 Start audio recording (for SOS evidence)
  const startRecording = async () => {
    try {
      console.log("🎙 Requesting microphone permission...");
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission required", "Microphone access is needed.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      let recordingObject = null;
      for (let i = 0; i < 3; i++) {
        try {
          const { recording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          recordingObject = recording;
          break;
        } catch (e) {
          console.log(`🎙 Attempt ${i + 1} failed to start recording, retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms
        }
      }

      if (!recordingObject) {
        throw new Error("Failed to start recording after 3 attempts");
      }

      setRecording(recordingObject);
      recordingRef.current = recordingObject; // 🟢 Sync Ref
      console.log("🎙 Recording started");
      Alert.alert("Recording Started", "Audio is being recorded for safety.");
    } catch (err) {
      console.log("🎙 Recording error:", err);
    }
  };

  // 🎙 Stop audio recording
  const stopRecording = async () => {
    try {
      const rec = recordingRef.current; // 🟢 Use Ref
      if (!rec) return;
      console.log("🎙 Stopping recording...");
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      console.log("📁 Audio file saved at:", uri);
      setRecording(null);
      recordingRef.current = null; // 🟢 Clear Ref

      if (uri) {
        uploadAudio(uri); // 🟢 Upload immediately
      }

      Alert.alert("Recording Saved", "Audio evidence stored locally.");
    } catch (err) {
      console.log("🎙 Stop recording error:", err);
    }
  };

  const checkAndSendSMS = async () => {
    const { audio, video, sent } = mediaUploadsRef.current;

    // If already sent, stop
    if (sent) return;

    // If both are ready, send immediately
    if (audio && video) {
      if (mediaUploadsRef.current.timer) {
        clearTimeout(mediaUploadsRef.current.timer);
      }
      await sendConsolidatedSMS(audio, video);
      mediaUploadsRef.current.sent = true;
      return;
    }

    // If only one is ready, wait a bit for the other
    if (!mediaUploadsRef.current.timer) {
      console.log("⏳ Waiting for second media before sending SMS...");
      mediaUploadsRef.current.timer = setTimeout(async () => {
        const { audio: finalAudio, video: finalVideo, sent: finalSent } = mediaUploadsRef.current;
        if (!finalSent) {
          console.log("⏰ Timeout reached, sending available media SMS.");
          await sendConsolidatedSMS(finalAudio, finalVideo);
          mediaUploadsRef.current.sent = true;
        }
      }, 5000); // Wait 5 seconds max
    }
  };

  const sendConsolidatedSMS = async (audioUrl?: string, videoUrl?: string) => {
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) return;

    let message = `🚨 EMERGENCY EVIDENCE:\n`;
    if (audioUrl) message += `🎤 Audio: ${audioUrl}\n`;
    if (videoUrl) message += `📹 Video: ${videoUrl}\n`;

    // Fallback if nothing (shouldn't happen logic-wise but good for safety)
    if (!audioUrl && !videoUrl) message += "Media upload failed or timed out.";

    const recipients = contacts.length > 0 ? contacts.map((c) => c.phoneNumber) : ["+917906272840"];

    try {
      console.log("📲 Sending Consolidated SMS...");
      await SMS.sendSMSAsync(recipients, message);
    } catch (e) {
      console.log("❌ SMS Error:", e);
    }
  };

  // 📤 Upload Audio Evidence
  const uploadAudio = async (uri: string) => {
    const currentSosId = sosIdRef.current; // 🟢 Use Ref
    if (!currentSosId) {
      console.log("⚠️ No active SOS ID for audio upload.");
      return;
    }

    try {
      console.log("📤 Uploading audio evidence...", uri);
      const formData = new FormData();
      // @ts-ignore
      formData.append("file", {
        uri,
        name: `sos_audio_${Date.now()}.m4a`,
        type: "audio/m4a",
      });

      const uploadRes = await axios.post(`${BASE_URL}/api/media/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const audioUrl = uploadRes.data.url;
      console.log("✅ Audio uploaded:", audioUrl);

      // Update SOS with audio URL
      await axios.post(UPDATE_URL, {
        id: currentSosId,
        mediaUrl: audioUrl,
        timestamp: new Date().toISOString(),
      });

      // 🟢 Update Ref and Check SMS
      mediaUploadsRef.current.audio = audioUrl;
      checkAndSendSMS();

    } catch (err: any) {
      console.log("❌ Audio upload failed:", err?.message || err);
    }
  };

  // 📹 Upload Video
  const uploadVideo = async (uri: string) => {
    const currentSosId = sosIdRef.current; // 🟢 Use Ref
    if (!currentSosId) {
      console.log("⚠️ No active SOS ID for video upload.");
      return;
    }

    try {
      console.log("📤 Uploading video...", uri);
      const formData = new FormData();
      // @ts-ignore
      formData.append("file", {
        uri,
        name: `sos_video_${Date.now()}.mp4`,
        type: "video/mp4",
      });

      const uploadRes = await axios.post(`${BASE_URL}/api/media/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const videoUrl = uploadRes.data.url;
      console.log("✅ Video uploaded:", videoUrl);

      // Update SOS with video URL
      await axios.post(UPDATE_URL, {
        id: currentSosId,
        mediaUrl: videoUrl,
        timestamp: new Date().toISOString(),
      });

      // 🟢 Update Ref and Check SMS
      mediaUploadsRef.current.video = videoUrl;
      checkAndSendSMS();

      Alert.alert("Evidence Uploaded", "Video has been securely uploaded.");
    } catch (err: any) {
      console.log("❌ Video upload failed:", err?.message || err);
      Alert.alert("Upload Failed", "Could not upload video evidence.");
    }
  };

  // 🛰 Send updated location every 5 seconds
  const sendLocationUpdate = async () => {
    if (!tracking || !sosId) return;

    try {
      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;

      await axios.post(UPDATE_URL, {
        id: sosId,
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
        contactNumber: "+911234567890", // not used but for entity compatibility
      });

      console.log("📍 Continuous location update sent:", latitude, longitude);
    } catch (err: any) {
      console.log("❌ Failed to send update location:", err?.message || err);
    }
  };

  // 🚀 Start tracking (interval + audio)
  const startTracking = async (alertId: number) => {
    console.log("🔁 Starting SOS tracking for id:", alertId);

    // 🛑 STOP Voice Listener explicitly to release mic
    await stopListening();

    setTracking(true);
    setSosId(alertId);
    sosIdRef.current = alertId; // 🟢 Sync Ref

    // 🔄 Reset Media Uploads Ref
    mediaUploadsRef.current = {
      audio: undefined,
      video: undefined,
      timer: undefined,
      sent: false,
    };

    // Start audio recording
    await startRecording();
    // Start video recording
    if (cameraPermission?.granted) {
      startVideoRecording();
    } else {
      requestCameraPermission();
    }

    // Start interval
    const id = setInterval(() => {
      sendLocationUpdate();
    }, 5000); // 5 seconds

    setIntervalId(id);

    // 🛑 Safety Timeout: Stop tracking/recording after 20s (buffer for 15s video)
    // This ensures we don't record indefinitely if camera doesn't stop
    setTimeout(() => {
      console.log("⏰ Safety timeout reached. Stopping SOS tracking...");
      stopTracking();
    }, 20000);
  };

  // 🛑 Stop tracking (interval + audio)
  const stopTracking = async () => {
    console.log("🛑 Stopping SOS tracking...");

    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }

    await stopRecording();
    stopVideoRecording();

    // Delay clearing ID slightly to allow uploads to read it
    setTimeout(() => {
      setSosId(null);
      sosIdRef.current = null;
    }, 5000);

    setTracking(false);

    Alert.alert("SOS Stopped", "Tracking and recording have been stopped.");
  };

  const triggerAutoSOS = async () => {
    if (tracking) {
      Alert.alert(
        "SOS already active",
        "Stop current SOS before starting a new one."
      );
      return;
    }

    setCooldown(true);
    setTimeout(() => setCooldown(false), 5000); // 5s cooldown

    console.log("⚙️ Auto SOS started…");

    let latitude: number | null = null;
    let longitude: number | null = null;
    let backendOk = false;
    let smsOk = false;
    let createdSosId: number | null = null;

    try {
      // 1️⃣ LOCATION
      let { status } = await Location.requestForegroundPermissionsAsync();
      console.log("📍 Location permission status:", status);

      if (status !== "granted") {
        Alert.alert("Permission denied", "Location is required.");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      latitude = loc.coords.latitude;
      longitude = loc.coords.longitude;
      console.log("📍 Got location:", latitude, longitude);

      // 2️⃣ BACKEND
      try {
        const response = await axios.post(API_URL, {
          latitude,
          longitude,
          contactNumber: "+911234567890",
          timestamp: new Date().toISOString(),
        });
        console.log("✅ Auto SOS sent to backend:", response.data);
        backendOk = true;
        createdSosId = response.data.id;
      } catch (err: any) {
        console.log("❌ Backend error:", err?.message || err);
      }

      // 3️⃣ SMS to all contacts
      if (latitude !== null && longitude !== null) {
        smsOk = await sendSMSWithLocation(latitude, longitude);
      }

      // 4️⃣ Save status for UI
      setLastSOS({
        time: new Date().toLocaleTimeString(),
        backendOk,
        smsOk,
      });

      // 5️⃣ Start continuous tracking + recording only if backend succeeded
      if (backendOk && createdSosId !== null) {
        await startTracking(createdSosId);
      }

      // 6️⃣ Final combined alert
      let statusMsg = "";
      statusMsg += backendOk ? "Backend: OK" : "Backend: FAILED";
      statusMsg += "\n";
      statusMsg += smsOk ? "SMS: OK" : "SMS: FAILED";

      Alert.alert("SOS Status", statusMsg);
    } catch (error: any) {
      console.log("❌ Auto SOS Error (outer):", error?.message || error);
      Alert.alert("Error", "Failed to send SOS (unexpected error)");
    }
  };



  const magnitude = Math.sqrt(
    data.x * data.x + data.y * data.y + data.z * data.z
  ).toFixed(2);

  const renderStatusBadge = (label: string, value: boolean | null) => {
    let text = "PENDING";
    let style = styles.badgePending;

    if (value === true) {
      text = "OK";
      style = styles.badgeOk;
    } else if (value === false) {
      text = "FAILED";
      style = styles.badgeFailed;
    }

    return (
      <View style={styles.badgeRow}>
        <Text style={styles.badgeLabel}>{label}</Text>
        <View style={[styles.badge, style]}>
          <Text style={styles.badgeText}>{text}</Text>
        </View>
      </View>
    );
  };

  const handleAddContact = async () => {
    if (!contactName.trim() || !contactPhone.trim()) {
      Alert.alert("Missing info", "Please enter both name and phone number.");
      return;
    }

    try {
      await axios.post(CONTACTS_URL, {
        name: contactName.trim(),
        phoneNumber: contactPhone.trim(),
        primaryContact: false,
      });
      setContactName("");
      setContactPhone("");
      await refreshContacts();
      Alert.alert("Added", "Emergency contact added successfully.");
    } catch (err: any) {
      console.log("❌ Failed to add contact:", err?.message || err);
      Alert.alert("Error", "Failed to add contact.");
    }
  };

  const handleDeleteContact = async (id: number) => {
    Alert.alert(
      "Delete contact?",
      "Are you sure you want to remove this emergency contact?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              console.log("🗑 Deleting contact with id:", id);
              const url = `${CONTACTS_URL}/${id}`;
              console.log("🗑 DELETE URL:", url);
              const res = await axios.delete(url);
              console.log("🗑 Delete response status:", res.status);
              await refreshContacts();
            } catch (err: any) {
              console.log("❌ Failed to delete contact:", err?.message || err);
              Alert.alert("Error", "Failed to delete contact.");
            }
          },
        },
      ]
    );
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem("token");
      router.replace("/login");   // now router exists ✔
    } catch (error) {
      console.log("❌ Logout error:", error);
    }
  };

  return (
    <ScrollView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.appTitle}>Motion-based Auto SOS</Text>
        <Text style={styles.appSubtitle}>
          Detects sudden motion, logs SOS & shares live location to multiple
          contacts.
        </Text>
      </View>

      {/* Motion Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Live Motion</Text>
        <Text style={styles.motionValue}>{magnitude} g</Text>
        <Text style={styles.motionSub}>
          Threshold: {THRESHOLD.toFixed(1)} g
        </Text>
        <Text
          style={[
            styles.cooldownText,
            cooldown ? styles.cooldownActive : styles.cooldownReady,
          ]}
        >
          {cooldown ? "Cooldown active" : "Monitoring…"}
        </Text>
        <Text
          style={{
            color: tracking ? "#22c55e" : "#9ca3af",
            marginTop: 4,
            fontSize: 12,
          }}
        >
          {tracking ? "Tracking + recording active" : "Tracking inactive"}
        </Text>
      </View>

      {/* Last SOS Status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Last SOS Status</Text>
        <Text style={styles.lastTime}>
          {lastSOS.time ? `Triggered at ${lastSOS.time}` : "No SOS yet"}
        </Text>

        {renderStatusBadge("Backend", lastSOS.backendOk)}
        {renderStatusBadge("SMS", lastSOS.smsOk)}
      </View>

      {/* Emergency Contacts – View + Add + Delete */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Emergency Contacts</Text>
        <Text style={styles.contactsInfo}>
          Total contacts: {contacts.length}
        </Text>

        {/* List */}
        {contacts.length === 0 ? (
          <Text style={styles.noContacts}>
            No contacts yet. Add at least one emergency contact.
          </Text>
        ) : (
          contacts.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.contactRow}
              // 🔁 CHANGED: simple tap instead of long-press
              onPress={() => handleDeleteContact(c.id)}
            >
              <View>
                <Text style={styles.contactName}>{c.name}</Text>
                <Text style={styles.contactPhone}>{c.phoneNumber}</Text>
              </View>
              <Text style={styles.deleteHint}>Tap to delete</Text>
            </TouchableOpacity>
          ))
        )}

        {/* Add Form */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Name"
            placeholderTextColor="#6b7280"
            value={contactName}
            onChangeText={setContactName}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor="#6b7280"
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
          />
          <TouchableOpacity
            style={styles.addButton}
            onPress={handleAddContact}
          >
            <Text style={styles.addButtonText}>Add Contact</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SOS Button */}
      <View style={styles.sosContainer}>
        <TouchableOpacity
          style={styles.sosButton}
          onPress={tracking ? stopTracking : triggerAutoSOS}
          activeOpacity={0.8}
        >
          <Text style={styles.sosText}>
            {tracking ? "STOP\nSOS" : "SOS"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.sosHint}>
          {tracking
            ? "Tap to stop or shake to auto-detect."
            : "Tap to SOS or shake to auto-detect."}
        </Text>

        {/* Temporary Test Link */}
        <TouchableOpacity
          style={{ marginTop: 20, padding: 10, backgroundColor: '#333', borderRadius: 8 }}
          onPress={() => router.push('/voice-test')}
        >
          <Text style={{ color: 'white', textAlign: 'center' }}>Test Voice SOS Module</Text>
        </TouchableOpacity>
      </View>

      {/* Logout Button */}
      <View style={{ alignItems: "center", marginBottom: 40 }}>
        <TouchableOpacity
          style={{
            backgroundColor: "#1f2937",
            paddingVertical: 10,
            paddingHorizontal: 25,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#374151",
          }}
          onPress={logout}
        >
          <Text style={{ color: "#f87171", fontSize: 16, fontWeight: "700" }}>
            Logout
          </Text>
        </TouchableOpacity>
      </View>


      {/* Hidden Camera View for Background Recording */}
      <View style={{ height: 1, width: 1, overflow: 'hidden', opacity: 0 }}>
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          mode="video"
          facing="back"
          mute={false}
        />
      </View>
    </ScrollView >
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  header: {
    marginBottom: 16,
  },
  appTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "700",
  },
  appSubtitle: {
    color: "#9ca3af",
    marginTop: 6,
    fontSize: 13,
  },
  card: {
    backgroundColor: "#0b1120",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  cardTitle: {
    color: "#e5e7eb",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  motionValue: {
    color: "#f97316",
    fontSize: 32,
    fontWeight: "800",
  },
  motionSub: {
    color: "#9ca3af",
    marginTop: 4,
  },
  cooldownText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "600",
  },
  cooldownActive: {
    color: "#f97316",
  },
  cooldownReady: {
    color: "#22c55e",
  },
  lastTime: {
    color: "#9ca3af",
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  badgeLabel: {
    color: "#e5e7eb",
    flex: 1,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },
  badgeOk: {
    backgroundColor: "#16a34a",
  },
  badgeFailed: {
    backgroundColor: "#dc2626",
  },
  badgePending: {
    backgroundColor: "#6b7280",
  },
  contactsInfo: {
    color: "#9ca3af",
    fontSize: 13,
    marginBottom: 6,
  },
  noContacts: {
    color: "#6b7280",
    fontSize: 13,
    marginBottom: 10,
  },
  contactRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  contactName: {
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: "600",
  },
  contactPhone: {
    color: "#9ca3af",
    fontSize: 13,
  },
  deleteHint: {
    color: "#f97316",
    fontSize: 10,
  },
  form: {
    marginTop: 12,
  },
  input: {
    backgroundColor: "#020617",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "white",
    marginBottom: 8,
    fontSize: 13,
  },
  addButton: {
    backgroundColor: "#22c55e",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  addButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 14,
  },
  sosContainer: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 32,
  },
  sosButton: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 10,
  },
  sosText: {
    color: "white",
    fontSize: 24, // Reduced size to fit
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center", // Center align for multi-line
  },
  sosHint: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 12,
    textAlign: "center",
  },
});
