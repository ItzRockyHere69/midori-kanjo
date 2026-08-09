import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard uses the requested animated mint dot-square", async () => {
  const app = await read("app/BillingApp.tsx");
  assert.match(app, /<DotmSquare12/);
  assert.match(app, /size=\{108\}/);
  assert.match(app, /dotSize=\{16\}/);
  assert.match(app, /speed=\{1\.35\}/);
  assert.match(app, /pattern="full"/);
  assert.match(app, /colorPreset="solid-mint"/);
  assert.match(app, /opacityBase=\{0\.12\}/);
  assert.match(app, /opacityMid=\{0\.42\}/);
  assert.match(app, /opacityPeak=\{1\}/);
});

test("dot-square is decorative, deterministic and motion-safe", async () => {
  const component = await read("app/DotmSquare12.tsx");
  const styles = await read("app/globals.css");
  const keyframes = styles.slice(
    styles.indexOf("@keyframes dotm-square12-pulse"),
    styles.indexOf("@media (min-width:1024px)"),
  );

  assert.match(component, /const GRID_SIZE = 5/);
  assert.match(component, /const ORIGIN_ROW = 1/);
  assert.match(component, /const ORIGIN_COLUMN = 1/);
  assert.match(component, /const MAX_MANHATTAN_DISTANCE = 6/);
  assert.match(component, /const BASE_CYCLE_MS = 1500/);
  assert.match(component, /BASE_CYCLE_MS \/ safeSpeed/);
  assert.match(component, /Math\.abs\(row - ORIGIN_ROW\) \+ Math\.abs\(column - ORIGIN_COLUMN\)/);
  assert.match(component, /\(distance \* cycleDurationMs\) \/ \(MAX_MANHATTAN_DISTANCE \+ 1\)/);
  assert.doesNotMatch(component, /distance \/ MAX_MANHATTAN_DISTANCE/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /focusable="false"/);
  assert.match(styles, /color:#34d399/);
  assert.match(styles, /\.reports-dashboard-decoration[\s\S]*pointer-events:none/);
  assert.match(styles, /@media \(min-width:1024px\)[\s\S]*\.reports-dashboard-decoration \{ display:block; width:72px; height:72px; \}/);
  assert.doesNotMatch(keyframes, /transform:/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)[\s\S]*\.dotm-square12--animated \.dotm-square12__dot \{ animation:none!important/);
  assert.match(styles, /nav,button,\.reports-dashboard-decoration\{display:none!important\}/);
});
