export const PRODUCT_NAME: string;
export const APP_ID: string;
export const APPLICATION_UPDATES: boolean;
/** `owner/name` of the GitHub repository whose releases feed in-app updates. */
export const UPDATE_REPOSITORY: string;
export function defaultUpdateChannel(version: string, platform: string, arch: string): string;
export const DEFAULT_BACKEND_PORT: number;
export const DEFAULT_WEB_PORT: number;
export const DEFAULT_ELECTRON_DEV_PORT: number;
export const DEFAULT_ELECTRON_PROXY_PORT: number;
export const APP_CONFIG: Readonly<{
  productName: string;
  appId: string;
  applicationUpdates: boolean;
  updateRepository: string;
  ports: Readonly<{ backend: number; web: number; electronDev: number }>;
}>;
