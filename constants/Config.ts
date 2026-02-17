const FALLBACK_URL = "http://10.10.171.73:8080";
const TWILIO_SERVICE_URL = "https://twilio-sms-service.onrender.com";

// Use the expo public env variable if available, otherwise use the fallback
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || FALLBACK_URL;

export const Config = {
    API_BASE_URL,
    endpoints: {
        SOS_TRIGGER: `${API_BASE_URL}/api/sos/trigger`,
        CONTACTS: `${API_BASE_URL}/api/contacts`,
        UPDATE_LOCATION: `${API_BASE_URL}/api/sos/update-location`,
        MEDIA_UPLOAD: `${API_BASE_URL}/api/media/upload`,
        TWILIO_SMS: `${TWILIO_SERVICE_URL}/api/sms/send`,
    },
    SMS: {
        FALLBACK_NUMBER: "+917906272840",
        DEFAULT_MESSAGE: "🚨 EMERGENCY! I need help.",
        EVIDENCE_MESSAGE: "🚨 EMERGENCY EVIDENCE:\n",
        MEDIA_UPLOAD_FAIL: "Media upload failed or timed out.",
    },
    TIMEOUTS: {
        MEDIA_UPLOAD_WAIT: 30000,
        LOCATION_UPDATE_INTERVAL: 5000,
        SAFETY_TIMEOUT: 20000,
        COOLDOWN: 5000,
    },
    DEFAULTS: {
        ENTITY_CONTACT_NUMBER: "+911234567890",
    }
};
