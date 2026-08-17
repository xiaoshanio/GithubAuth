/** Local 2FA generation — secrets stay in decrypted memory and are never sent over the network. */
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToBytes(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index === -1) throw new Error("无效的 Base32 密钥");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
}

export async function generateTotp(secret: string, timestamp = Date.now()) {
  if (!secret.trim()) return null;
  const counter = Math.floor(timestamp / 30_000);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter, false);
  const key = await crypto.subtle.importKey(
    "raw",
    base32ToBytes(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function getTotpSecondsLeft(timestamp = Date.now()) {
  return 30 - (Math.floor(timestamp / 1000) % 30);
}
