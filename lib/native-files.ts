import { Capacitor } from "@capacitor/core";
import type { Directory, FilesystemPlugin } from "@capacitor/filesystem";

export interface NativeShareOptions {
  fileName: string;
  title: string;
  text?: string;
  dialogTitle?: string;
}

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

const NATIVE_EXPORT_DIRECTORY = "midori-kanjo-exports";
const MAX_NATIVE_EXPORT_FILES = 12;
const MAX_NATIVE_EXPORT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "Midori-Kanjo-export";
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
  if (!isNativeApp()) return false;
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
  if (!isNativeApp()) return false;
  const { Share } = await import("@capacitor/share");
  await Share.share({ title, text, dialogTitle: title });
  return true;
}

export async function openExternalUrl(url: string) {
  if (!isNativeApp()) return false;
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, toolbarColor: "#014921" });
  return true;
}
