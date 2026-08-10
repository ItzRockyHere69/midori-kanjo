import { Capacitor } from "@capacitor/core";
import type { Directory, FilesystemPlugin } from "@capacitor/filesystem";
import { isTauri } from "@tauri-apps/api/core";

export interface NativeShareOptions {
  fileName: string;
  title: string;
  text?: string;
  dialogTitle?: string;
}

export function isCapacitorApp() {
  return Capacitor.isNativePlatform();
}

export function isTauriApp() {
  return isTauri();
}

export function isNativeApp() {
  return isCapacitorApp() || isTauriApp();
}

const NATIVE_EXPORT_DIRECTORY = "midori-kanjo-exports";
const DESKTOP_PRINT_DIRECTORY = "midori-kanjo-print";
const MAX_NATIVE_EXPORT_FILES = 12;
const MAX_NATIVE_EXPORT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "Midori-Kanjo-export";
}

function desktopDialogFilter(fileName: string) {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (!extension || extension === fileName.toLowerCase()) return undefined;
  const labels: Record<string, string> = {
    csv: "CSV spreadsheet",
    json: "JSON backup",
    pdf: "PDF document",
    txt: "Text document",
  };
  return [{ name: labels[extension] || `${extension.toUpperCase()} file`, extensions: [extension] }];
}

export async function saveDesktopBlob(
  blob: Blob,
  options: NativeShareOptions,
) {
  if (!isTauriApp()) return null;
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const fileName = safeFileName(options.fileName);
  const path = await save({
    title: options.dialogTitle || options.title,
    defaultPath: fileName,
    filters: desktopDialogFilter(fileName),
    canCreateDirectories: true,
  });
  if (!path) return null;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return path;
}

export async function openDesktopPrintBlob(
  blob: Blob,
  options: Pick<NativeShareOptions, "fileName" | "title">,
) {
  if (!isTauriApp()) return false;
  const [{ appCacheDir, join }, { mkdir, writeFile }, { openPath }] =
    await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/plugin-opener"),
    ]);
  const directory = await join(await appCacheDir(), DESKTOP_PRINT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const path = await join(directory, `print-${safeFileName(options.fileName)}`);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  await openPath(path);
  return true;
}

async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function pruneNativeExportCache(filesystem: FilesystemPlugin, directory: Directory) {
  try {
    const { files } = await filesystem.readdir({
      path: NATIVE_EXPORT_DIRECTORY,
      directory,
    });
    const now = Date.now();
    const exportFiles = files
      .filter((file) => file.type === "file")
      .sort((left, right) => right.mtime - left.mtime);
    const retainedBeforeNewExport = Math.max(0, MAX_NATIVE_EXPORT_FILES - 1);

    await Promise.allSettled(exportFiles.map(async (file, index) => {
      const tooOld = !Number.isFinite(file.mtime) || now - file.mtime > MAX_NATIVE_EXPORT_AGE_MS;
      if (!tooOld && index < retainedBeforeNewExport) return;
      await filesystem.deleteFile({
        path: `${NATIVE_EXPORT_DIRECTORY}/${file.name}`,
        directory,
      });
    }));
  } catch {
    // The directory does not exist before the first export. Cache cleanup must
    // also remain best-effort so it can never block an invoice or report share.
  }
}

export async function shareNativeBlob(blob: Blob, options: NativeShareOptions) {
  if (isTauriApp()) {
    const saved = await saveDesktopBlob(blob, options);
    // A cancelled Save dialog is still a handled desktop action. Falling back
    // to a WebView download would immediately prompt the user a second time.
    return saved ? true : "cancelled" as const;
  }
  if (!isCapacitorApp()) return false;
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  // Prune only previous exports. The newly written file remains available for
  // the complete native share lifecycle and is considered on the next share.
  await pruneNativeExportCache(Filesystem, Directory.Cache);
  const fileName = safeFileName(options.fileName);
  const written = await Filesystem.writeFile({
    path: `${NATIVE_EXPORT_DIRECTORY}/${Date.now()}-${fileName}`,
    data: await blobBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({
    title: options.title,
    text: options.text,
    files: [written.uri],
    dialogTitle: options.dialogTitle || options.title,
  });
  return true;
}

export async function shareNativeText(text: string, title: string) {
  if (!isCapacitorApp()) return false;
  const { Share } = await import("@capacitor/share");
  await Share.share({ title, text, dialogTitle: title });
  return true;
}

export async function openExternalUrl(url: string) {
  if (isTauriApp()) {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.hostname !== "wa.me")
      return false;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(target);
    return true;
  }
  if (!isCapacitorApp()) return false;
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, toolbarColor: "#014921" });
  return true;
}
