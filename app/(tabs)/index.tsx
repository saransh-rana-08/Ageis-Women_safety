import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

// Hooks
import { useContacts } from "../../hooks/home/useContacts";
import { useMotionDetection } from "../../hooks/home/useMotionDetection";
import { useSafeWords } from "../../hooks/home/useSafeWords";
import { useSOSOrchestrator } from "../../hooks/home/useSOSOrchestrator";
import { useSOSRestriction } from "../../hooks/home/useSOSRestriction";
import { useVideoSOS } from "../features/videoSOS/useVideoSOS";
import useVoiceSOS from "../features/voiceSOS/useVoiceSOS";

// UI Components
import { ContactsCard } from "../../components/home/ContactsCard";
import { MotionCard } from "../../components/home/MotionCard";
import { PreSOSOverlay } from "../../components/home/PreSOSOverlay";
import { SafetyControlPanel } from "../../components/home/SafetyControlPanel";
import { SafeWordsModal } from "../../components/home/SafeWordsModal";
import { SOSButton } from "../../components/home/SOSButton";
import { StatusCard } from "../../components/home/StatusCard";

export default function HomeScreen() {
  const router = useRouter();

  // 1. Independent State Hooks
  const {
    contacts, contactName, setContactName, contactPhone, setContactPhone,
    handleAddContact, handleDeleteContact
  } = useContacts();

  const {
    customSafeWords, newSafeWord, setNewSafeWord,
    isSafeWordModalVisible, setIsSafeWordModalVisible,
    addSafeWord, deleteSafeWord
  } = useSafeWords();

  // Safety restriction system (must be instantiated before orchestrator)
  const restriction = useSOSRestriction();

  // Create a ref to hold orchestrator functions without cyclic dependency
  const handleVideoUploadedRef = useRef<((url: string) => void) | null>(null);

  // 2. SOS Specific Features
  const {
    cameraRef, startRecording: startVideoRecording, stopRecording: stopVideoRecording,
    permission: cameraPermission, requestPermission: requestCameraPermission
  } = useVideoSOS({
    onRecordingFinished: (uri) => {
      if (handleVideoUploadedRef.current) {
        handleVideoUploadedRef.current(uri);
      }
    }
  });

  const { startListening, stopListening } = useVoiceSOS({
    customSafeWords: customSafeWords,
    onKeywordDetected: async (info: any) => {
      console.log("🗣 Voice SOS triggered:", info.keyword, "Type:", info.type);
      if (info.type === 'safe') {
        if (preSosActiveRef.current) {
          console.log("✅ Safe phrase detected! Cancelling SOS sequence.");
          await cancelAutomatedSequence();
        }
      } else {
        if (!preSosActiveRef.current && !trackingRef.current) {
          startAutomatedSequence();
        }
      }
    },
    onError: (err: any) => console.log("🗣 Voice SOS Error:", err)
  });

  // 3. Central Orchestrator
  const orchestrator = useSOSOrchestrator({
    contacts,
    cameraPermission,
    requestCameraPermission,
    startVideoRecording,
    stopVideoRecording,
    stopListening,
    restriction,
  });

  // Update the ref so the camera hook always calls the latest orchestrator callback
  useEffect(() => {
    handleVideoUploadedRef.current = orchestrator.handleVideoUploaded;
  }, [orchestrator.handleVideoUploaded]);

  const {
    tracking, preSosActive, countdown, cooldown, lastSOS, customAlarmUri, setCustomAlarmUri,
    triggerAutoSOS, startAutomatedSequence, cancelAutomatedSequence, stopTracking
  } = orchestrator;

  // Refs for callbacks
  const preSosActiveRef = useRef(preSosActive);
  const trackingRef = useRef(tracking);

  useEffect(() => {
    preSosActiveRef.current = preSosActive;
    trackingRef.current = tracking;
  }, [preSosActive, tracking]);



  // 4. Motion Detection
  const { magnitude, THRESHOLD: threshold, cooldown: motionCooldown } = useMotionDetection({
    onTrigger: startAutomatedSequence,
    isActive: tracking || preSosActive
  });

  // 5. App Lifecycle & Voice Focus 
  useFocusEffect(
    useCallback(() => {
      if (!tracking) startListening();
      return () => stopListening();
    }, [tracking, startListening, stopListening])
  );

  const logout = async () => {
    try {
      await AsyncStorage.removeItem("token");
      router.replace("/login");
    } catch (error) {
      console.log("❌ Logout error:", error);
    }
  };

  const pickCustomAlarm = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const originalUri = result.assets[0].uri;
      const fileName = "custom_alarm.mp3";
      const newUri = FileSystem.documentDirectory + fileName;

      await FileSystem.copyAsync({ from: originalUri, to: newUri });
      setCustomAlarmUri(newUri);
      await AsyncStorage.setItem("custom_alarm_uri", newUri);
      Alert.alert("Success", "Custom alarm tone set successfully.");

    } catch (err) {
      console.log("❌ Error picking/saving document:", err);
      Alert.alert("Error", "Failed to save audio file.");
    }
  };

  return (
    <ScrollView style={styles.screen} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.appTitle}>Ae
            gis</Text>
          <Text style={styles.appSubtitle}>
            Smart emergency detection with motion, voice, and live location tracking
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        <MotionCard
          magnitude={magnitude}
          threshold={threshold}
          cooldown={motionCooldown || cooldown}
          tracking={tracking}
        />

        <SafetyControlPanel restriction={restriction} isTracking={tracking} />

        <StatusCard lastSOS={lastSOS} />

        <ContactsCard
          contacts={contacts}
          contactName={contactName}
          setContactName={setContactName}
          contactPhone={contactPhone}
          setContactPhone={setContactPhone}
          handleAddContact={handleAddContact}
          handleDeleteContact={handleDeleteContact}
        />

        <View style={styles.sosSection}>
          <SOSButton tracking={tracking} onPress={tracking ? stopTracking : triggerAutoSOS} />

          <View style={styles.settingsRow}>
            <TouchableOpacity style={styles.testButton} onPress={() => router.push("/voice-test")}>
              <Text style={styles.testButtonText}>Test Voice SOS</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.testButton, { backgroundColor: '#475569' }]} onPress={pickCustomAlarm}>
              <Text style={styles.testButtonText}>
                {customAlarmUri ? "🎵 Change Tone" : "🎵 Set Alarm Tone"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.safeWordsButton} onPress={() => setIsSafeWordModalVisible(true)}>
            <Text style={styles.safeWordsIcon}>🛡</Text>
            <Text style={styles.safeWordsText}>Manage Safe Words</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.logoutSection}>
          <TouchableOpacity style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <PreSOSOverlay visible={preSosActive} countdown={countdown} onCancel={cancelAutomatedSequence} />

      <SafeWordsModal
        visible={isSafeWordModalVisible}
        onClose={() => setIsSafeWordModalVisible(false)}
        customSafeWords={customSafeWords}
        newSafeWord={newSafeWord}
        setNewSafeWord={setNewSafeWord}
        addSafeWord={addSafeWord}
        deleteSafeWord={deleteSafeWord}
      />

      {/* Hidden Camera View for Recording - Absolute positioned off-screen to satisfy Android hardware requirements */}
      <View style={{ 
        position: 'absolute', 
        left: -1000, 
        top: -1000, 
        width: 100, 
        height: 100, 
        overflow: 'hidden' 
      }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} mode="video" facing="back" mute={true} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a" },
  header: { backgroundColor: "#1e293b", paddingHorizontal: 24, paddingTop: 60, paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerContent: { alignItems: 'center' },
  appTitle: { color: "white", fontSize: 28, fontWeight: "800", textAlign: 'center', marginBottom: 8 },
  appSubtitle: { color: "#cbd5e1", fontSize: 14, textAlign: 'center', lineHeight: 20 },
  content: { padding: 20 },
  sosSection: { alignItems: 'center', marginTop: 8, marginBottom: 24 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  testButton: { flex: 1, marginHorizontal: 4, backgroundColor: "#334155", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#475569", alignItems: 'center' },
  testButtonText: { color: "#e2e8f0", fontSize: 14, fontWeight: '600' },
  safeWordsButton: { backgroundColor: "#1e293b", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 12, marginTop: 12, borderWidth: 1, borderColor: "#334155", width: '100%' },
  safeWordsIcon: { fontSize: 18, marginRight: 8 },
  safeWordsText: { color: "#cbd5e1", fontSize: 14, fontWeight: "600" },
  logoutSection: { alignItems: "center", marginBottom: 40 },
  logoutButton: { backgroundColor: "#1e293b", paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, borderWidth: 1, borderColor: "#334155" },
  logoutButtonText: { color: "#ef4444", fontSize: 16, fontWeight: "700" },
});
