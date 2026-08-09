import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const androidRoot = join(projectRoot, "android");
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const tasks = process.argv.slice(2);

if (!tasks.length) throw new Error("Pass at least one Android Gradle task.");

const child = spawn(wrapper, tasks, {
  cwd: androidRoot,
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Gradle stopped with ${signal}.`);
    process.exitCode = 1;
  } else process.exitCode = code ?? 1;
});
