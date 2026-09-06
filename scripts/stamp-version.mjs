// Writes the build-time version into a gitignored config fragment that
// `tauri build --config` merges over tauri.conf.json, so a build never dirties
// a tracked file.
//
// Scheme: YYYY.MMDD.HHMM in local time. 2026-08-27 01:07 -> "2026.827.107"
//
// Every field has to stay a leading-zero-free integer no larger than 65535:
// semver rejects leading zeros, and the Windows VERSIONINFO resource caps each
// field at 65535. Packing MM/DD and HH/MM as MM*100+DD and HH*100+MM keeps both
// constraints and stays monotonic (101 < 827 < 1231, 53 < 100 < 2359).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "build", "version.json");

const now = new Date();
const version = [
  now.getFullYear(),
  (now.getMonth() + 1) * 100 + now.getDate(),
  now.getHours() * 100 + now.getMinutes(),
].join(".");

let previous;
try {
  previous = JSON.parse(readFileSync(output, "utf8")).version;
} catch {
  // No previous stamp, or an unreadable one. Either way, overwrite it.
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version }, null, 2)}\n`);

const pad = n => String(n).padStart(2, "0");
const stamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
  `${pad(now.getHours())}:${pad(now.getMinutes())}`;
console.log(`Stamped version ${version} (built ${stamp} local time)`);

if (previous === version) {
  console.warn(
    `Warning: the previous build also stamped ${version}. Two builds in the ` +
      `same minute carry the same version, so the installer treats this one ` +
      `as a reinstall instead of an upgrade. Wait a minute and rebuild.`
  );
}
