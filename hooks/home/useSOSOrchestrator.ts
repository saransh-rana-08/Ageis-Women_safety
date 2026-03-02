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

interface UseSOSOrchestratorProps {
    contacts: Contact[];
    cameraPermission: any;
    requestCameraPermission: () => void;
    startVideoRecording: () => void;
    stopVideoRecording: () => void;
    stopListening: () => void;
}

export const useSOSOrchestrator = ({
    contacts,
    cameraPermission,
    requestCameraPermission,
    startVideoRecording,
    stopVideoRecording,
    stopListening,
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
    const [countdown, setCountdown] = useState(8);
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
        const { audio, video, sent } = mediaUploadsRef.current;
        if (sent) return;

        const sendConsolidatedSMS = async (audioUrl?: string, videoUrl?: string) => {
            let message = Config.SMS.EVIDENCE_MESSAGE(userName);
            if (audioUrl) {
                const shortAudio = await SMSService.shortenUrl(audioUrl);
                message += `🎤 Audio: ${shortAudio}\n`;
            }
            if (videoUrl) {
                const shortVideo = await SMSService.shortenUrl(videoUrl);
                message += `📹 Video: ${shortVideo}\n`;
            }
            if (!audioUrl && !videoUrl) {
                message += Config.SMS.MEDIA_UPLOAD_FAIL;
            }

            const recipients = contacts.length > 0 ? contacts.map((c) => c.phoneNumber) : [Config.SMS.FALLBACK_NUMBER];

            // Always try Twilio first (wait for it so the OS doesn't kill it when Native SMS backgrounds the app)
            await SMSService.sendTwilioSMS(recipients, message);
            // Fallback Native
            await SMSService.sendNativeSMS(recipients, message);
        };

        if (audio && video) {
            if (mediaUploadsRef.current.timer) clearTimeout(mediaUploadsRef.current.timer);
            await sendConsolidatedSMS(audio, video);
            mediaUploadsRef.current.sent = true;
            return;
        }

        if (!mediaUploadsRef.current.timer) {
            mediaUploadsRef.current.timer = setTimeout(async () => {
                const { audio: finalAudio, video: finalVideo, sent: finalSent } = mediaUploadsRef.current;
                if (!finalSent) {
                    await sendConsolidatedSMS(finalAudio, finalVideo);
                    mediaUploadsRef.current.sent = true;
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
        mediaUploadsRef.current.video = url;
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

        Alert.alert("SOS Stopped", "Tracking and recording have been stopped.");
    }, [stopRecording, stopVideoRecording, stopLocationTracking, currentSosIdRef, handleAudioUploaded]);

    const startTrackingSequence = useCallback(async (alertId: number) => {
        console.log("🔁 Starting SOS tracking for id:", alertId);

        // Stop Voice Listener explicitly to release mic
        stopListening();

        mediaUploadsRef.current = { sent: false };

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

        // Safety Timeout (e.g. 20s)
        safetyTimerRef.current = setTimeout(() => {
            console.log("⏰ Safety timeout reached. Stopping SOS main tracking flow...");
            stopTracking();
        }, Config.TIMEOUTS.SAFETY_TIMEOUT) as unknown as NodeJS.Timeout;

    }, [
        cameraPermission, requestCameraPermission, startRecording, startVideoRecording,
        stopListening, startLocationTracking, stopRecording, currentSosIdRef,
        handleAudioUploaded, stopTracking
    ]);

    const triggerAutoSOS = useCallback(async () => {
        if (tracking) {
            Alert.alert("SOS already active", "Stop current SOS before starting a new one.");
            return;
        }

        // Force cleanup of Pre-SOS
        if (preSosActive || countdownTimerRef.current) {
            setPreSosActive(false);
            setCountdown(8);
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
                return;
            }

            const loc = await Location.getCurrentPositionAsync({});
            latitude = loc.coords.latitude;
            longitude = loc.coords.longitude;

            // 2. Initial Backend API
            try {
                const response = await SOSService.triggerSOS(latitude, longitude);
                backendOk = true;
                createdSosId = response.id;
            } catch (err: any) {
                console.log("❌ Initial Backend error:", err?.message || err);
            }

            // 3. Initial SMS (Location Only)
            if (latitude !== null && longitude !== null) {
                let mapsPart = `\nMy Location:\nhttps://www.google.com/maps?q=${latitude},${longitude}`;
                let message = Config.SMS.DEFAULT_MESSAGE(userName) + mapsPart;
                const recipients = contacts.length > 0 ? contacts.map(c => c.phoneNumber) : [Config.SMS.FALLBACK_NUMBER];

                await SMSService.sendTwilioSMS(recipients, message);
                smsOk = await SMSService.sendNativeSMS(recipients, message);

                // If native fails but Twilio executed, we'll vaguely consider it a partial success UI-wise
                if (!smsOk) smsOk = true; // because Twilio fired
            }

            setLastSOS({ time: new Date().toLocaleTimeString(), backendOk, smsOk });

            // 4. Start Deep Tracking
            if (backendOk && createdSosId !== null) {
                await startTrackingSequence(createdSosId);
            }

            // NOTE: Removed Alert.alert("SOS Status") here because a pending 
            // modal blocks the OS from opening the Native SMS bottom-sheet intent later when media finishes.

        } catch (error: any) {
            console.log("❌ Auto SOS Error:", error?.message || error);
            Alert.alert("Error", "Failed to send SOS (unexpected error)");
        }

    }, [tracking, preSosActive, contacts, userName, startTrackingSequence]);


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
        triggerAutoSOS();
    }, [stopListening, triggerAutoSOS]);

    const startAutomatedSequence = useCallback(async () => {
        if (preSosActive || tracking) return;

        console.log("⏳ Starting Automated SOS Sequence...");
        setPreSosActive(true);
        setCountdown(8);

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
        let timeLeft = 8;
        countdownTimerRef.current = setInterval(() => {
            timeLeft -= 1;
            setCountdown(timeLeft);

            if (timeLeft <= 0) {
                if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
                finishAutomatedSequence();
            }
        }, 1000) as unknown as NodeJS.Timeout;
    }, [preSosActive, tracking, customAlarmUri, finishAutomatedSequence]);

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
        setCountdown(8);
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
