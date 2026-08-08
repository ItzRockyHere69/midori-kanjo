import { Capacitor } from "@capacitor/core";

export interface NativeShareOptions {
  fileName: string;
  title: string;
  text?: string;
  dialogTitle?: string;
}

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

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

export async function shareNativeBlob(blob: Blob, options: NativeShareOptions) {
  if (!isNativeApp()) return false;
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const fileName = safeFileName(options.fileName);
  const written = await Filesystem.writeFile({
    path: `midori-kanjo-exports/${Date.now()}-${fileName}`,
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
