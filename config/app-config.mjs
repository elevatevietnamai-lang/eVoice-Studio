import rawConfig from "./app.json" with { type: "json" };

function requiredString(value, key) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`config/app.json: ${key} must be a non-empty string`);
  }
  return value.trim();
}

function requiredPort(value, key) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new TypeError(`config/app.json: ports.${key} must be an integer from 1 to 65535`);
  }
  return value;
}

export const PRODUCT_NAME = requiredString(rawConfig.productName, "productName");
export const APP_ID = requiredString(rawConfig.appId, "appId");
function optionalBoolean(value, key, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`config/app.json: ${key} must be true or false`);
  }
  return value;
}

/** In-app update checks against the GitHub releases of UPDATE_REPOSITORY. */
export const APPLICATION_UPDATES = optionalBoolean(
  rawConfig.applicationUpdates,
  "applicationUpdates",
  true,
);
/** `owner/name` of the GitHub repository whose releases are this build's update feed. */
export const UPDATE_REPOSITORY = (() => {
  const value = requiredString(rawConfig.updateRepository, "updateRepository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new TypeError("config/app.json: updateRepository must look like owner/name");
  }
  return value;
})();
/**
 * Update feed a build publishes when the release job does not name one
 * (VOICESTUDIO_UPDATE_CHANNEL): `X.Y.Z-beta.N` builds feed Beta, others Stable.
 * A local beta build stamped Stable would publish a manifest Beta never reads.
 */
export function defaultUpdateChannel(version, platform, arch) {
  const kind = /^\d+\.\d+\.\d+-beta\.\d+$/.test(String(version)) ? "beta" : "stable";
  return `electron-${kind}-${platform}-${arch}`;
}

export const DEFAULT_BACKEND_PORT = requiredPort(rawConfig.ports?.backend, "backend");
export const DEFAULT_WEB_PORT = requiredPort(rawConfig.ports?.web, "web");
export const DEFAULT_ELECTRON_DEV_PORT = requiredPort(rawConfig.ports?.electronDev, "electronDev");
export const DEFAULT_ELECTRON_PROXY_PORT = DEFAULT_ELECTRON_DEV_PORT + 1;

const configuredPorts = [DEFAULT_BACKEND_PORT, DEFAULT_WEB_PORT, DEFAULT_ELECTRON_DEV_PORT];
if (new Set(configuredPorts).size !== configuredPorts.length) {
  throw new TypeError("config/app.json: default ports must be distinct");
}
if (DEFAULT_ELECTRON_PROXY_PORT > 65535 || configuredPorts.includes(DEFAULT_ELECTRON_PROXY_PORT)) {
  throw new TypeError(
    "config/app.json: ports.electronDev + 1 is reserved for the private Electron proxy",
  );
}

export const APP_CONFIG = Object.freeze({
  productName: PRODUCT_NAME,
  appId: APP_ID,
  applicationUpdates: APPLICATION_UPDATES,
  updateRepository: UPDATE_REPOSITORY,
  ports: Object.freeze({
    backend: DEFAULT_BACKEND_PORT,
    web: DEFAULT_WEB_PORT,
    electronDev: DEFAULT_ELECTRON_DEV_PORT,
  }),
});
