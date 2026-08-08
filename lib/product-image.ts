const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const TARGET_BYTES = 96 * 1024;

function dataUrlBytes(value: string) {
  const comma = value.indexOf(",");
  return Math.ceil((value.length - comma - 1) * 0.75);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
    image.src = url;
  });
}

export async function prepareProductImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose a JPG, PNG, WebP or another image file.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("The photo is too large. Choose an image below 15 MB.");

  const source = await loadImage(file);
  let maxSide = 480;
  let quality = 0.82;
  let result = "";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
    const width = Math.max(1, Math.round(source.naturalWidth * scale));
    const height = Math.max(1, Math.round(source.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This device could not prepare the photo.");
    context.fillStyle = "#f9f9f9";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    result = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(result) <= TARGET_BYTES) return result;
    if (quality > 0.5) quality -= 0.1;
    else maxSide = Math.round(maxSide * 0.82);
  }

  return result;
}
