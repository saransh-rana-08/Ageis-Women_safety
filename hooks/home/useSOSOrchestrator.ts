import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Config } from '../../constants/Config';
import { Contact } from '../../services/contactService';
import { SMSService } from '../../services/smsService';
import { SOSService } from '../../services/sosService';
import { useAudioRecording } from './useAudioRecording';
import { useLocationTracker } from './useLocationTracker';
import { UseSOSRestrictionReturn } from './useSOSRestriction';

interface UseSOSOrchestratorProps {
    contacts: Contact[];
    cameraPermission: any;
    requestCameraPermission: () => void;
    startVideoRecording: () => void;
    stopVideoRecording: () => void;
    stopListening: () => void;
    /** Pass the useSOSRestriction hook return value to gate automated triggers. */
    restriction: UseSOSRestrictionReturn;
}

export const useSOSOrchestrator = ({
    contacts,
    cameraPermission,
    requestCameraPermission,
    startVideoRecording,
    stopVideoRecording,
    stopListening,
    restriction,
}: UseSOSOrchestratorProps) => {

    const [cooldown, setCooldown] = useState(false);
    const { startLocationTracking, stopLocationTracking, tracking, currentSosIdRef } = useLocationTracker();
    const { startRecording, stopRecording } = useAudioRecording();

    const [lastSOS, setLastSOS] = useState<{
        time: string | null;
        backendOk: boolean | null;
        smsOk: boolean | null;
    }>({
        time: null,
        backendOk: null,
        smsOk: null,
    });

    // Pre-SOS State
    const [preSosActive, setPreSosActive] = useState(false);
    const [countdown, setCountdown] = useState(() => restriction.sosCountdownSecs);
    const [customAlarmUri, setCustomAlarmUri] = useState<string | null>(null);
    const [userName, setUserName] = useState<string | undefined>(undefined);

    const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
    const soundRef = useRef<Audio.Sound | null>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const safetyTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isAutoSendingRef = useRef(false);

    const mediaUploadsRef = useRef<{
        audio?: string;
        video?: string;
        videoDone?: boolean;  // true when video is complete (even if it failed)
        timer?: NodeJS.Timeout;
        sent?: boolean;
    }>({});

    // Load custom alarm and User Profile on mount
    useEffect(() => {
        (async () => {
            try {
                // Fetch User Profile Name for SOS SMS personalization
                const token = await AsyncStorage.getItem("token");
                if (token) {
                    const res = await axios.get(Config.endpoints.AUTH_ME, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.data?.name) {
                        setUserName(res.data.name);
                    }
                }
            } catch (err) {
                console.log("❌ Silent Profile fetch error in Orchestrator:", err);
            }

            try {
                const storedUri = await AsyncStorage.getItem("custom_alarm_uri");
                if (storedUri) {
                    const info = await FileSystem.getInfoAsync(storedUri);
                    if (info.exists) {
                        setCustomAlarmUri(storedUri);
                    } else {
                        await AsyncStorage.removeItem("custom_alarm_uri");
                    }
                }
            } catch (e) {
                console.log("❌ Failed to load custom alarm:", e);
            }
        })();
    }, []);

    // Helper: Consolidated SMS
    const checkAndSendSMS = useCallback(async () => {
        // 1. Double-gate: check both the persistent 'sent' flag AND a local 'isSending' lock
        if (mediaUploadsRef.current.sent) return;

        const { audio, video } = mediaUploadsRef.current;

        const sendConsolidatedSMS = async (audioUrl?: string, videoUrl?: string) => {
            // SECOND GATE: Re-check inside the async block
            if (mediaUploadsRef.current.sent) return;
            
            // IMMEDIATE MARKING: Stop any other parallel flows from reaching this point
            mediaUploadsRef.current.sent = true;
            if (mediaUploadsRef.current.timer) {
                clearTimeout(mediaUploadsRef.current.timer);
                mediaUploadsRef.current.timer = undefined;
            }

            // Small delay to ensure file write is truly flushed on disk before SMS attempt
            await new Promise(res => setTimeout(res, 2000));

            console.log("📨 Dispatching consolidated SOS SMS via Hardware...");

            let message = Config.SMS.EVIDENCE_MESSAGE(userName);
            if (audioUrl) {
                message += `🎤 Audio: ${audioUrl}\n`;
            }
            if (videoUrl) {
                message += `📹 Video: ${videoUrl}\n`;
            }
            if (!audioUrl && !videoUrl) {
                message += Config.SMS.MEDIA_UPLOAD_FAIL;
            }

            const recipients = contacts.length > 0 ? contacts.map((c) => c.phoneNumber) : [Config.SMS.FALLBACK_NUMBER];

            try {
                // HARDWARE ONLY: Using Native Silent SMS
                const nativeOk = await SMSService.sendNativeSMS(recipients, message);
                
                if (nativeOk) {
                    console.log("✅ Consolidated SOS SMS dispatch complete via Native.");
                } else {
                    console.log("❌ Consolidated SMS dispatch failed on hardware.");
                }
            } catch (err) {
                console.log("❌ Consolidated SMS dispatch error:", err);
            } finally {
                isProcessingAutoSOS.current = false;
            }
        };

        // Fire immediately if:
        // - Both audio AND video URL are available (best case)
        // - Audio is ready AND video has been reported done (even if failed)
        const bothDone = (audio && video) || (audio && mediaUploadsRef.current.videoDone);
        if (bothDone) {
            await sendConsolidatedSMS(audio, video);
            return;
        }

        // If only one is ready, wait for the other OR timeout
        if (!mediaUploadsRef.current.timer) {
            console.log("⏳ One media asset ready, waiting for others or timeout...");
            mediaUploadsRef.current.timer = setTimeout(async () => {
                const { audio: finalAudio, video: finalVideo, sent: finalSent } = mediaUploadsRef.current;
                if (!finalSent) {
                    console.log("⏰ Media timeout reached, sending partial evidence...");
                    await sendConsolidatedSMS(finalAudio, finalVideo);
                }
            }, Config.TIMEOUTS.MEDIA_UPLOAD_WAIT) as unknown as NodeJS.Timeout;
        }
    }, [contacts, userName]);

    // Handle Upload Callbacks
    const handleAudioUploaded = useCallback((url: string) => {
        mediaUploadsRef.current.audio = url;
        checkAndSendSMS();
    }, [checkAndSendSMS]);

    const handleVideoUploaded = useCallback((url: string) => {
        mediaUploadsRef.current.videoDone = true;  // Mark video as complete regardless of outcome
        if (url) {
            mediaUploadsRef.current.video = url;
            console.log("📹 Video URL ready:", url);
        } else {
            mediaUploadsRef.current.video = undefined;
            console.log("📹 Video failed/empty — will send audio-only evidence SMS");
        }
        checkAndSendSMS();
    }, [checkAndSendSMS]);

    const stopTracking = useCallback(async () => {
        console.log("🛑 Stopping SOS tracking...");

        if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);

        // Stop Media
        await stopRecording(currentSosIdRef.current, handleAudioUploaded);
        stopVideoRecording();

        // Stop Location
        stopLocationTracking();

        console.log("✅ SOS tracking stopped.");
    }, [stopRecording, stopVideoRecording, stopLocationTracking, currentSosIdRef, handleAudioUploaded]);

    const startTrackingSequence = useCallback(async (alertId: number) => {
        console.log("🔁 Starting SOS tracking for id:", alertId);

        // Stop Voice Listener explicitly to release mic
        stopListening();

        mediaUploadsRef.current = { sent: false, videoDone: false };

        // Start Media Recording
        await startRecording();

        if (cameraPermission?.granted) {
            startVideoRecording();
        } else {
            requestCameraPermission();
        }

        // Auto stop recording after interval
        recordingTimerRef.current = setTimeout(async () => {
            if (isAutoSendingRef.current) return;
            isAutoSendingRef.current = true;
            await stopRecording(currentSosIdRef.current, handleAudioUploaded);
            isAutoSendingRef.current = false;
        }, Config.TIMEOUTS.MEDIA_UPLOAD_WAIT) as unknown as NodeJS.Timeout;

        // Start Location Tracking
        startLocationTracking(alertId);

        // Safety Timeout (e.g. 45s)
        safetyTimerRef.current = setTimeout(() => {
            console.log("⏰ Safety timeout reached. Stopping SOS main tracking flow...");
            stopTracking();
        }, 45000) as unknown as NodeJS.Timeout;

    }, [
        cameraPermission, requestCameraPermission, startRecording, startVideoRecording,
        stopListening, startLocationTracking, stopRecording, currentSosIdRef,
        handleAudioUploaded, stopTracking
    ]);

    const isProcessingAutoSOS = useRef(false);

    const triggerAutoSOS = useCallback(async () => {
        if (tracking || cooldown || isProcessingAutoSOS.current) {
            console.log("⚠️ SOS or Cooldown already active. Ignoring trigger.");
            return;
        }

        isProcessingAutoSOS.current = true;

        // Force cleanup of Pre-SOS
        if (preSosActive || countdownTimerRef.current) {
            setPreSosActive(false);
            setCountdown(restriction.sosCountdownSecs);
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            if (soundRef.current) {
                try {
                    await soundRef.current.stopAsync();
                    await soundRef.current.unloadAsync();
                } catch (e) { }
                soundRef.current = null;
            }
        }

        setCooldown(true);
        setTimeout(() => setCooldown(false), Config.TIMEOUTS.COOLDOWN);

        console.log("⚙ Auto SOS started…");
        let latitude: number | null = null;
        let longitude: number | null = null;
        let backendOk = false;
        let smsOk = false;
        let createdSosId: number | null = null;

        try {
            // 1. Location
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") {
                Alert.alert("Permission denied", "Location is required to send an SOS.");
                isProcessingAutoSOS.current = false;
                return;
            }

            const loc = await Location.getCurrentPositionAsync({});
            latitude = loc.coords.latitude;
            longitude = loc.coords.longitude;

            // 2. Initial SMS (Location Only) - NON-BLOCKING
            if (latitude !== null && longitude !== null) {
                let mapsPart = `\nMy Location:\nhttps://www.google.com/maps?q=${latitude},${longitude}`;
                let message = Config.SMS.DEFAULT_MESSAGE(userName) + mapsPart;
                const recipients = contacts.length > 0 ? contacts.map(c => c.phoneNumber) : [Config.SMS.FALLBACK_NUMBER];

                console.log("📩 Triggering initial alert in background (Hardware Only)...");
                (async () => {
                    try {
                        await SMSService.sendNativeSMS(recipients, message);
                    } catch (e) {
                        console.log("❌ Initial background SMS failed:", e);
                    }
                })();
            }

            // 3. Start Recording & Tracking IMMEDIATELY
            console.log("📹 Launching recording & deep tracking...");
            startTrackingSequence(-1); // Start with dummy ID while waiting for backend

            // 4. Backend API Sync (Background)
            try {
                const response = await SOSService.triggerSOS(latitude, longitude);
                backendOk = true;
                createdSosId = response.id;
                currentSosIdRef.current = response.id; // Update ref for the already running tracking
            } catch (err: any) {
                console.log("❌ Backend Sync error (will continue recording regardless):", err?.message || err);
            }

            setLastSOS({ time: new Date().toLocaleTimeString(), backendOk, smsOk: true });

        } catch (error: any) {
            console.log("❌ Auto SOS Error:", error?.message || error);
            isProcessingAutoSOS.current = false;
        }

    }, [tracking, cooldown, preSosActive, contacts, userName, startTrackingSequence]);


    // PRE-SOS Automatically logic
    const finishAutomatedSequence = useCallback(() => {
        if (soundRef.current) {
            try {
                soundRef.current.stopAsync();
                soundRef.current.unloadAsync();
            } catch (e) { }
            soundRef.current = null;
        }

        setPreSosActive(false);
        stopListening();

        // ── Record automated trigger for cooldown tracking ────────────────────
        restriction.recordSOSTrigger();

        triggerAutoSOS();
    }, [stopListening, triggerAutoSOS, restriction]);

    const startAutomatedSequence = useCallback(async () => {
        if (preSosActive || tracking || isProcessingAutoSOS.current) return;

        // ── Safety Restriction Gate (automated triggers only) ──────────────────
        const { allowed, reason } = restriction.isSOSAllowed();
        if (!allowed) {
            console.log(`🔒 [SOSRestriction] Automated trigger blocked — reason: ${reason}`);
            return;
        }

        console.log("⏳ Starting Automated SOS Sequence...");
        setPreSosActive(true);
        setCountdown(restriction.sosCountdownSecs);

        // Play Alarm
        try {
            await Audio.setAudioModeAsync({
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
            });

            let soundSource = null;

            if (customAlarmUri) {
                const info = await FileSystem.getInfoAsync(customAlarmUri);
                if (info.exists) {
                    soundSource = { uri: customAlarmUri };
                }
            }
            if (!soundSource) {
                try {
                    soundSource = require('../../assets/alarm.mp3');
                } catch (e) { }
            }

            if (soundSource) {
                const { sound } = await Audio.Sound.createAsync(soundSource);
                soundRef.current = sound;
                await sound.setIsLoopingAsync(true);
                await sound.playAsync();
            }

        } catch (e) {
            console.log("🔊 Failed to play alarm sound:", e);
        }

        // Countdown
        let timeLeft = restriction.sosCountdownSecs;
        countdownTimerRef.current = setInterval(() => {
            timeLeft -= 1;
            setCountdown(timeLeft);

            if (timeLeft <= 0) {
                if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
                finishAutomatedSequence();
            }
        }, 1000) as unknown as NodeJS.Timeout;
    }, [preSosActive, tracking, customAlarmUri, finishAutomatedSequence, restriction]);

    const cancelAutomatedSequence = useCallback(async () => {
        console.log("🛡 SOS Sequence Cancelled by User.");

        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

        if (soundRef.current) {
            try {
                await soundRef.current.stopAsync();
                await soundRef.current.unloadAsync();
            } catch (e) { }
            soundRef.current = null;
        }

        setPreSosActive(false);
        setCountdown(restriction.sosCountdownSecs);
        isProcessingAutoSOS.current = false;
        Alert.alert("Cancelled", "Emergency SOS cancelled. You are safe.");
    }, []);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
            if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
            if (soundRef.current) {
                soundRef.current.stopAsync();
                soundRef.current.unloadAsync();
            }
        };
    }, []);

    return {
        tracking,
        preSosActive,
        countdown,
        cooldown,
        lastSOS,
        customAlarmUri,
        setCustomAlarmUri,
        triggerAutoSOS,
        startAutomatedSequence,
        cancelAutomatedSequence,
        stopTracking,
        handleVideoUploaded
    };
};
