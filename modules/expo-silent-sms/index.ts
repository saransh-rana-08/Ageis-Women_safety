import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

export type SmsResult = {
  phoneNumber: string;
  success: boolean;
  sent: boolean;
  delivered: boolean;
  error?: string;
};

export type SmsOptions = {
  subscriptionId?: number;
  retryCount?: number;
};

export type PermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
};

export type OEMInfo = {
  manufacturer: string;
  requiresAutoStartPermission: boolean;
};

export type SubscriptionInfo = {
  subscriptionId: number;
  displayName: string;
  carrierName: string;
  number: string;
};

interface NativeModule {
  isAvailableAsync(): Promise<boolean>;
  requestPermissionsAsync(): Promise<PermissionResult>;
  getSubscriptionInfoAsync(): Promise<SubscriptionInfo[]>;
  getOEMInfoAsync(): Promise<OEMInfo>;
  enableMockMode(enabled: boolean): void;
  sendSMSAsync(
    phoneNumbers: string[],
    message: string,
    options?: SmsOptions
  ): Promise<SmsResult[]>;
}

const NativeSilentSms = Platform.OS === 'android' 
  ? requireNativeModule<NativeModule>('ExpoSilentSms')
  : null;

export const ExpoSilentSms = {
  isAvailableAsync: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    return await NativeSilentSms?.isAvailableAsync() ?? false;
  },

  requestPermissionsAsync: async (): Promise<PermissionResult> => {
    if (Platform.OS !== 'android') return { granted: false, canAskAgain: false };
    return await NativeSilentSms?.requestPermissionsAsync() ?? { granted: false, canAskAgain: false };
  },

  getSubscriptionInfoAsync: async (): Promise<SubscriptionInfo[]> => {
    if (Platform.OS !== 'android') return [];
    return await NativeSilentSms?.getSubscriptionInfoAsync() ?? [];
  },

  getOEMInfoAsync: async (): Promise<OEMInfo> => {
    if (Platform.OS !== 'android') return { manufacturer: 'iOS', requiresAutoStartPermission: false };
    return await NativeSilentSms?.getOEMInfoAsync() ?? { manufacturer: 'Unknown', requiresAutoStartPermission: false };
  },

  enableMockMode: (enabled: boolean): void => {
    if (Platform.OS === 'android') {
      NativeSilentSms?.enableMockMode(enabled);
    }
  },

  sendSMSAsync: async (
    phoneNumbers: string[],
    message: string,
    options?: SmsOptions
  ): Promise<SmsResult[]> => {
    if (Platform.OS !== 'android') {
      return phoneNumbers.map(phone => ({
        phoneNumber: phone,
        success: false,
        sent: false,
        delivered: false,
        error: "UNSUPPORTED_PLATFORM"
      }));
    }

    try {
      return await NativeSilentSms?.sendSMSAsync(phoneNumbers, message, options) ?? [];
    } catch (e: any) {
      return phoneNumbers.map(phone => ({
        phoneNumber: phone,
        success: false,
        sent: false,
        delivered: false,
        error: e?.message || "NATIVE_ERROR"
      }));
    }
  }
};

export default ExpoSilentSms;
