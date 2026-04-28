import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

export const useVideoSOS = (options?: { onRecordingFinished?: (uri: string) => void }) => {
    const [permission, requestPermission] = useCameraPermissions();
    // const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions(); // ❌ Causes crash on Expo Go if Audio perm missing
    const [isRecording, setIsRecording] = useState(false);
    const cameraRef = useRef<CameraView>(null);
    const recordingStartTimestamp = useRef<number>(0);
    const stopRequestedRef = useRef(false);

    const startRecording = useCallback(async () => {
        if (!permission?.granted) {
            const { granted } = await requestPermission();
            if (!granted) {
                Alert.alert("Permission Required", "Camera permission is needed for Video SOS.");
                return;
            }
        }

        const mediaPerm = await MediaLibrary.requestPermissionsAsync(true);
        if (!mediaPerm.granted) {
            Alert.alert("Permission Required", "Gallery access is needed to save video.");
            return;
        }

        if (cameraRef.current && !isRecording) {
            try {
                setIsRecording(true);
                stopRequestedRef.current = false;
                recordingStartTimestamp.current = Date.now();
                console.log("[VideoSOS] Starting recording...");

                const videoPromise = cameraRef.current.recordAsync({
                    maxDuration: 20,
                });

                videoPromise.then(async (data: any) => {
                    if (!data?.uri) {
                        console.log("[VideoSOS] Recording finished but NO URI returned. Notifying orchestrator...");
                        setIsRecording(false);
                        if (options?.onRecordingFinished) {
                            options.onRecordingFinished(""); 
                        }
                        return;
                    }
                    console.log("[VideoSOS] Recording finished:", data.uri);
                    setIsRecording(false);
                    try {
                        await MediaLibrary.saveToLibraryAsync(data.uri);
                        console.log("[VideoSOS] Video saved to gallery.");

                        console.log("[VideoSOS] Uploading video to Cloudinary...");
                        const { SOSService } = require('../../../services/sosService');
                        const uploadedUrl = await SOSService.uploadMedia(data.uri, 'video');
                        console.log("[VideoSOS] Upload success:", uploadedUrl);

                        if (options?.onRecordingFinished) {
                            options.onRecordingFinished(uploadedUrl);
                        }
                    } catch (e) {
                        console.error("[VideoSOS] Failed to save/upload video:", e);
                        if (options?.onRecordingFinished) {
                            options.onRecordingFinished(""); 
                        }
                    }
                }).catch((e: any) => {
                    console.error("[VideoSOS] Recording error:", e);
                    setIsRecording(false);
                    if (options?.onRecordingFinished) {
                        options.onRecordingFinished(""); 
                    }
                });

            } catch (error) {
                console.error("[VideoSOS] Failed to start recording:", error);
                setIsRecording(false);
            }
        }
    }, [permission, isRecording, options]);

    const stopRecording = useCallback(() => {
        if (cameraRef.current && isRecording) {
            const elapsed = Date.now() - recordingStartTimestamp.current;
            
            // 🚨 FIX: Minimum 3 seconds of recording to prevent "Unknown error" on Android
            if (elapsed < 3000) {
                console.log(`[VideoSOS] Stop requested too early (${elapsed}ms). Waiting for minimum duration...`);
                stopRequestedRef.current = true;
                setTimeout(() => {
                    if (stopRequestedRef.current) {
                        console.log("[VideoSOS] Executing deferred stop...");
                        cameraRef.current?.stopRecording();
                        setIsRecording(false);
                        stopRequestedRef.current = false;
                    }
                }, 3000 - elapsed);
                return;
            }

            console.log("[VideoSOS] Stopping recording manually...");
            cameraRef.current.stopRecording();
            setIsRecording(false);
            stopRequestedRef.current = false;
        }
    }, [isRecording]);

    return {
        cameraRef,
        isRecording,
        startRecording,
        stopRecording,
        permission,
        requestPermission
    };
};
