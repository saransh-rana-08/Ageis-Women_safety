import axios from 'axios';
import { Platform } from 'react-native';
import { Config } from '../constants/Config';
import ExpoSilentSms from '../modules/expo-silent-sms';

const TWILIO_SMS_URL = Config.endpoints.TWILIO_SMS;

export const SMSService = {
    async shortenUrl(url: string): Promise<string> {
        try {
            const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { timeout: 3000 });
            return res.data;
        } catch (e) {
            console.log("⚠️ Failed to shorten URL, using original:", url);
            return url;
        }
    },

    async sendTwilioSMS(recipients: string[], message: string): Promise<void> {
        console.log("🌐 Sending Twilio SMS to:", recipients);

        const promises = recipients.map(async (phone) => {
            let formattedPhone = phone.trim();
            if (!formattedPhone.startsWith("+")) {
                if (formattedPhone.startsWith("91") && formattedPhone.length === 12) {
                    formattedPhone = "+" + formattedPhone;
                } else {
                    formattedPhone = "+91" + formattedPhone;
                }
            }

            console.log(`🌐 sending to ${formattedPhone}...`);
            return axios.post(TWILIO_SMS_URL, {
                to: formattedPhone,
                message: message
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000 // 5 seconds max before giving up and going to Native SMS
            });
        });

        try {
            await Promise.all(promises);
            console.log("✅ Twilio SMS sent (all).");
        } catch (error: any) {
            console.log("❌ Twilio SMS Failed:", error?.message || "Timeout/Network Error");
        }
    },

    async sendNativeSMS(recipients: string[], message: string): Promise<boolean> {
        if (Platform.OS !== 'android') {
            console.log("⚠️ Native Silent SMS is only supported on Android. Relying on Twilio.");
            return false;
        }

        console.log("📩 Checking Native Silent SMS availability...");
        try {
            const permResult = await ExpoSilentSms.requestPermissionsAsync();
            if (!permResult.granted) {
                console.log("⚠️ SEND_SMS permission denied. Relying on Twilio API.");
                return false;
            }

            console.log("📩 Sending Silent SMS to:", recipients);
            // Pass the full array in ONE call — the native module handles multi-recipient internally
            const results = await ExpoSilentSms.sendSMSAsync(recipients, message);

            const allSent = results.every(res => res.success);
            console.log(`📩 Native Silent SMS result: ${allSent ? 'SUCCESS' : 'PARTIAL/FAILED'}`, results);
            return allSent;
        } catch (e: any) {
            console.log("📩 Native SMS error:", e?.message || e);
            return false;
        }
    }
};
