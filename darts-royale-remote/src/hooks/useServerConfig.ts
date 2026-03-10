import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_IP = "remote_server_ip";
const KEY_PORT = "remote_server_port";
const DEFAULT_PORT = "3000";

export type ServerConfig = { ip: string; port: string };

export async function loadConfig(): Promise<ServerConfig> {
  const [ip, port] = await Promise.all([
    AsyncStorage.getItem(KEY_IP),
    AsyncStorage.getItem(KEY_PORT),
  ]);
  return {
    ip: ip?.trim() ?? "",
    port: (port?.trim() || DEFAULT_PORT) ?? DEFAULT_PORT,
  };
}

export async function saveConfig(ip: string, port: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(KEY_IP, String(ip ?? "").trim()),
    AsyncStorage.setItem(KEY_PORT, String(port ?? DEFAULT_PORT).trim() || DEFAULT_PORT),
  ]);
}
