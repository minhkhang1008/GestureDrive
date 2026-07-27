// Vendors the MediaPipe runtime into public/ so AUTO mode works offline.
// - Copies @mediapipe/tasks-vision WASM files from node_modules.
// - Downloads the hand_landmarker.task model once (~7.5 MB) if missing.
// The worker prefers these same-origin assets and falls back to the CDN when
// they are absent, so this script is optional but recommended before events
// with unreliable internet. Wired to run via `npm run vendor:mediapipe`
// (and automatically from predev/prebuild).
import { cp, mkdir, access, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const root = process.cwd();
const targetDir = path.join(root, "public", "mediapipe");
const wasmTarget = path.join(targetDir, "wasm");
const modelTarget = path.join(targetDir, "hand_landmarker.task");

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // The package's exports map blocks require.resolve of inner paths, so the
  // wasm directory is located directly inside node_modules.
  const wasmSource = path.join(
    root, "node_modules", "@mediapipe", "tasks-vision", "wasm",
  );
  if (!(await exists(wasmSource))) {
    throw new Error(`không thấy ${path.relative(root, wasmSource)} — đã chạy npm install chưa?`);
  }
  await mkdir(wasmTarget, { recursive: true });
  await cp(wasmSource, wasmTarget, { recursive: true });
  console.log(`✓ WASM copied to ${path.relative(root, wasmTarget)}`);

  if (await exists(modelTarget)) {
    console.log("✓ hand_landmarker.task already present");
    return;
  }
  console.log("Downloading hand_landmarker.task (~7.5 MB)...");
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(modelTarget, bytes);
    console.log(`✓ Model saved to ${path.relative(root, modelTarget)}`);
  } catch (reason) {
    console.warn(
      `! Không tải được model (${reason}). Worker sẽ dùng CDN khi chạy online.`,
    );
  }
}

main().catch((reason) => {
  console.warn(`! vendor-mediapipe bỏ qua: ${reason}`);
});
