import { PermissionsAndroid, Platform } from "react-native";

/**
 * Ask for what scanning and connecting need. Android 12+ has its own Bluetooth permissions (the
 * manifest marks scanning as never used for location); older Android ties scanning to location.
 * True when everything was granted.
 */
export async function askBluetooth(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const got = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => got[p] === PermissionsAndroid.RESULTS.GRANTED);
}
