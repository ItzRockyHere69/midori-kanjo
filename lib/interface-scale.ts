export const INTERFACE_SCALE_META = "interface-scale-v1";
export const INTERFACE_SCALE_CACHE = "midori-interface-scale-v1";

export const interfaceScaleOptions = [100, 110, 120, 130] as const;

export type InterfaceScale = (typeof interfaceScaleOptions)[number];

export const DEFAULT_INTERFACE_SCALE: InterfaceScale = 100;

export function parseInterfaceScale(value: unknown): InterfaceScale | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return interfaceScaleOptions.includes(numeric as InterfaceScale)
    ? (numeric as InterfaceScale)
    : null;
}

export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  return parseInterfaceScale(value) ?? DEFAULT_INTERFACE_SCALE;
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function readInterfaceScaleCacheValue(
  storage: StorageReader | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): InterfaceScale | null {
  if (!storage) return null;
  try {
    return parseInterfaceScale(storage.getItem(INTERFACE_SCALE_CACHE));
  } catch {
    return null;
  }
}

export function readInterfaceScaleCache(
  storage?: StorageReader,
): InterfaceScale {
  return readInterfaceScaleCacheValue(storage) ?? DEFAULT_INTERFACE_SCALE;
}

export function writeInterfaceScaleCache(
  value: InterfaceScale,
  storage: StorageWriter | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(INTERFACE_SCALE_CACHE, String(value));
    return true;
  } catch {
    return false;
  }
}

export function applyInterfaceScale(
  value: InterfaceScale,
  root: HTMLElement | undefined =
    typeof document === "undefined" ? undefined : document.documentElement,
): void {
  if (root) root.dataset.interfaceScale = String(value);
}
