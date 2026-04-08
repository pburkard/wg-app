import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (!Device.isDevice) {
    // Push notifications don't work on simulators/emulators
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android needs a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  // Get the Expo push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  const token = tokenData.data;

  // Store the token in the user's profile
  await supabase
    .from('profiles')
    .update({ push_token: token })
    .eq('id', userId);

  return token;
}

export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
) {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: expoPushToken,
      sound: 'default',
      title,
      body,
    }),
  });
}

export async function notifyApartmentMembers(
  apartmentId: string,
  excludeUserId: string,
  title: string,
  body: string,
) {
  const { data: members } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('apartment_id', apartmentId)
    .neq('id', excludeUserId)
    .not('push_token', 'is', null);

  if (!members) return;

  const tokens = members
    .map((m) => m.push_token)
    .filter((t): t is string => !!t);

  for (const token of tokens) {
    await sendPushNotification(token, title, body);
  }
}
