import type { CSSProperties } from "react";

type DotmSquare12Props = {
  size: number;
  dotSize: number;
  speed: number;
  pattern: "full";
  colorPreset: "solid-mint";
  animated?: boolean;
  opacityBase: number;
  opacityMid: number;
  opacityPeak: number;
};

type DotmRootStyle = CSSProperties & {
  "--dotm-opacity-base": number;
  "--dotm-opacity-mid": number;
  "--dotm-opacity-peak": number;
  "--dotm-speed": string;
};

type DotmDotStyle = CSSProperties & {
  "--dotm-static-opacity": number;
};

const GRID_SIZE = 5;
const ORIGIN_ROW = 1;
const ORIGIN_COLUMN = 1;
const MAX_MANHATTAN_DISTANCE = 6;
const BASE_CYCLE_MS = 1500;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const safeOpacity = (value: number, fallback: number) =>
  clamp(Number.isFinite(value) ? value : fallback, 0, 1);

export default function DotmSquare12({
  size,
  dotSize,
  speed,
  pattern,
  colorPreset,
  animated = true,
  opacityBase,
  opacityMid,
  opacityPeak,
}: DotmSquare12Props) {
  const safeSize = Math.max(24, Number.isFinite(size) ? size : 108);
  const maximumDotSize = Math.max(2, (safeSize - (GRID_SIZE - 1)) / GRID_SIZE);
  const safeDotSize = clamp(
    Number.isFinite(dotSize) ? dotSize : 16,
    2,
    maximumDotSize,
  );
  const safeSpeed = Math.max(0.2, Number.isFinite(speed) ? speed : 1.35);
  const cycleDurationMs = BASE_CYCLE_MS / safeSpeed;
  const step = (safeSize - safeDotSize) / (GRID_SIZE - 1);
  const radius = safeDotSize / 2;
  const baseOpacity = safeOpacity(opacityBase, 0.12);
  const midOpacity = safeOpacity(opacityMid, 0.42);
  const peakOpacity = safeOpacity(opacityPeak, 1);
  const rootStyle: DotmRootStyle = {
    "--dotm-opacity-base": baseOpacity,
    "--dotm-opacity-mid": midOpacity,
    "--dotm-opacity-peak": peakOpacity,
    "--dotm-speed": `${cycleDurationMs}ms`,
  };

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={safeSize}
      height={safeSize}
      viewBox={`0 0 ${safeSize} ${safeSize}`}
      className={`dotm-square12 dotm-square12--${pattern} dotm-square12--${colorPreset}${animated ? " dotm-square12--animated" : ""}`}
      style={rootStyle}
      data-pattern={pattern}
      data-color-preset={colorPreset}
    >
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
        const row = Math.floor(index / GRID_SIZE);
        const column = index % GRID_SIZE;
        const distance =
          Math.abs(row - ORIGIN_ROW) + Math.abs(column - ORIGIN_COLUMN);
        const phase =
          (distance * cycleDurationMs) / (MAX_MANHATTAN_DISTANCE + 1);
        const dotStyle: DotmDotStyle = {
          animationDelay: `${-phase}ms`,
          "--dotm-static-opacity":
            distance === 0
              ? peakOpacity
              : distance <= 2
                ? midOpacity
                : baseOpacity,
        };
        return (
          <circle
            key={`${row}-${column}`}
            className="dotm-square12__dot"
            cx={radius + column * step}
            cy={radius + row * step}
            r={radius}
            style={dotStyle}
          />
        );
      })}
    </svg>
  );
}
