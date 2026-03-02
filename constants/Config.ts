const FALLBACK_URL = "http://192.168.0.100:8080";
const TWILIO_SERVICE_URL = "https://twilio-sms-service.onrender.com";
const AUTH_SERVICE_URL = "https://safety-login.onrender.com";

// Use the expo public env variable if available, otherwise use the fallback
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || FALLBACK_URL;

export const Config = {
    API_BASE_URL,
    AUTH_SERVICE_URL,
    endpoints: {
        SOS_TRIGGER: `${API_BASE_URL}/api/sos/trigger`,
        CONTACTS: `${API_BASE_URL}/api/contacts`,
        UPDATE_LOCATION: `${API_BASE_URL}/api/sos/update-location`,
        MEDIA_UPLOAD: `${API_BASE_URL}/api/media/upload`,
        TWILIO_SMS: `${TWILIO_SERVICE_URL}/api/sms/send`,
        AUTH_LOGIN: `${AUTH_SERVICE_URL}/auth/login`,
        AUTH_REGISTER: `${AUTH_SERVICE_URL}/auth/register`,
        AUTH_ME: `${AUTH_SERVICE_URL}/auth/me`,
    },
    SMS: {
        FALLBACK_NUMBER: "+917906272840",
        DEFAULT_MESSAGE: (name?: string) => `🚨 EMERGENCY! ${name ? name + ' needs' : 'I need'} help.`,
        EVIDENCE_MESSAGE: (name?: string) => `🚨 EMERGENCY EVIDENCE${name ? ` for ${name}` : ''}:`,
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
