const FALLBACK_URL = "http://192.168.0.110:8080";
const TWILIO_SERVICE_URL = "http://192.168.0.110:8081";

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
};
