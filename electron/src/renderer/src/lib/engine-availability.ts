/** Codes the backend sends with an unavailable engine (api/public_engine_metadata.py). */
export const ENGINE_UNAVAILABLE_CODES = [
  'license',
  'platform',
  'no_mps',
  'file_missing',
  'file_missing_manual',
  'needs_config',
  'not_installed',
  'not_installed_manual',
  'unavailable',
] as const;

export interface EngineAvailability {
  availability_code?: string | null;
  availability_reason?: string | null;
}

/**
 * Why an engine cannot run, in the user's language.
 *
 * The backend's ``availability_reason`` is a fixed English sentence; showing it
 * put "Engine unavailable. Check installation and configuration." in a
 * Vietnamese UI. The code picks the translated sentence; the English one stays
 * only as the fallback for a code this build does not know.
 */
export function engineAvailabilityText(
  t: (key: string) => string,
  engine: EngineAvailability | null | undefined,
): string | undefined {
  const code = engine?.availability_code;
  if (code && (ENGINE_UNAVAILABLE_CODES as readonly string[]).includes(code))
    return t(`engines.unavailableReason_${code}`);
  return engine?.availability_reason || undefined;
}
