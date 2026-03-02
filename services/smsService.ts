import axios from 'axios';
import * as SMS from 'expo-sms';
import { Config } from '../constants/Config';

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
        console.log("📩 Checking SMS availability...");
        const isAvailable = await SMS.isAvailableAsync();

        if (!isAvailable) {
            console.log("⚠️ SMS composer unavailable, relying on Twilio API.");
            return false;
        }

        try {
            // Android often hangs the promise when opening the Native SMS bottom sheet
            // We use Promise.race to force-resolve after 5 seconds so the JS thread isn't blocked forever.
            const timeoutPromise = new Promise<{ result: string }>((resolve) =>
                setTimeout(() => resolve({ result: 'timeout_assumed_sent' }), 5000)
            );

            const result = await Promise.race([
                SMS.sendSMSAsync(recipients, message),
                timeoutPromise
            ]);

            console.log("📩 Native SMS result:", result);
            return true;
        } catch (e: any) {
            console.log("📩 Native SMS error:", e?.message || e);
            return false;
        }
    }
};
