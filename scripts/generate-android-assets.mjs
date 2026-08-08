import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appIcon = await readFile(new URL("../public/app-icon.svg", import.meta.url));
const foreground = await readFile(new URL("../mobile/assets/android-foreground.svg", import.meta.url));

const iconTargets = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];

const splashTargets = [
  ["drawable/splash.png", 480, 320, 116],
  ["drawable-land-mdpi/splash.png", 480, 320, 116],
  ["drawable-land-hdpi/splash.png", 800, 480, 168],
  ["drawable-land-xhdpi/splash.png", 1280, 720, 252],
  ["drawable-land-xxhdpi/splash.png", 1600, 960, 336],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280, 448],
  ["drawable-port-mdpi/splash.png", 320, 480, 116],
  ["drawable-port-hdpi/splash.png", 480, 800, 168],
  ["drawable-port-xhdpi/splash.png", 720, 1280, 252],
  ["drawable-port-xxhdpi/splash.png", 960, 1600, 336],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920, 448],
];

const resourceRoot = new URL("../android/app/src/main/res/", import.meta.url);

for (const size of [180, 192, 512]) {
  await sharp(appIcon)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`../public/app-icon-${size}.png`, import.meta.url)));
}

for (const [density, iconSize, foregroundSize] of iconTargets) {
  const directory = new URL(`mipmap-${density}/`, resourceRoot);
  const icon = sharp(appIcon).resize(iconSize, iconSize).png();
  await icon.clone().toFile(fileURLToPath(new URL("ic_launcher.png", directory)));
  await icon.clone().toFile(fileURLToPath(new URL("ic_launcher_round.png", directory)));
  await sharp(foreground)
    .resize(foregroundSize, foregroundSize)
    .png()
    .toFile(fileURLToPath(new URL("ic_launcher_foreground.png", directory)));
}

for (const [path, width, height, markSize] of splashTargets) {
  const mark = await sharp(appIcon).resize(markSize, markSize).png().toBuffer();
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#f9f9f9",
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(fileURLToPath(new URL(path, resourceRoot)));
}

console.log("Generated Midori Kanjo Android launcher and splash assets.");
