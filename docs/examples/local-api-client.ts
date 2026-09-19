import {
  X509Certificate,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { request, type RequestOptions } from "node:https";
import { checkServerIdentity } from "node:tls";

type Connection = {
  version: 2;
  address: string;
  instanceId: string;
  serverSpkiSha256: string;
  serverX25519PublicKey: string;
  caCertificatePem: string;
};

type Envelope = {
  version: 2;
  instanceId: string;
  clientId: string;
  requestId: string;
  timestamp: string;
  route: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  keyId?: string;
};

const connection = JSON.parse(
  readFileSync("github-auth-local-connection.json", "utf8")
) as Connection;
const clientId = process.env.GHA_CLIENT_ID!;
const clientCertificate = readFileSync("client-cert.pem");
const clientTlsKey = readFileSync("client-tls-key.pem");
const clientX25519Private = createPrivateKey({
  key: JSON.parse(readFileSync("client-x25519-private.jwk", "utf8")),
  format: "jwk",
});

function x25519PublicFromRaw(rawBase64: string) {
  return createPublicKey({
    key: {
      kty: "OKP",
      crv: "X25519",
      x: Buffer.from(rawBase64, "base64").toString("base64url"),
    },
    format: "jwk",
  });
}

function aad(envelope: Envelope) {
  return Buffer.from(
    JSON.stringify([
      envelope.version,
      envelope.instanceId,
      envelope.clientId,
      envelope.requestId,
      envelope.timestamp,
      envelope.route,
      envelope.ephemeralPublicKey,
    ])
  );
}

function deriveKey(shared: Buffer, envelope: Envelope) {
  const salt = createHash("sha256")
    .update(connection.instanceId)
    .update(Buffer.from([0]))
    .update(clientId)
    .digest();
  const info = Buffer.concat([
    Buffer.from("github-auth-local-api:v2"),
    Buffer.from([0]),
    Buffer.from(envelope.route),
    Buffer.from([0]),
    Buffer.from(envelope.requestId),
  ]);
  return Buffer.from(hkdfSync("sha256", shared, salt, info, 32));
}

function encrypt(route: string, plaintext: object, keyId?: string): Envelope {
  const ephemeral = generateKeyPairSync("x25519");
  const publicJwk = ephemeral.publicKey.export({ format: "jwk" });
  const envelope: Envelope = {
    version: 2,
    instanceId: connection.instanceId,
    clientId,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    route,
    ephemeralPublicKey: Buffer.from(publicJwk.x!, "base64url").toString(
      "base64"
    ),
    nonce: randomBytes(12).toString("base64"),
    ciphertext: "",
    ...(keyId ? { keyId } : {}),
  };
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: x25519PublicFromRaw(connection.serverX25519PublicKey),
  });
  const cipher = createCipheriv(
    "chacha20-poly1305",
    deriveKey(shared, envelope),
    Buffer.from(envelope.nonce, "base64"),
    { authTagLength: 16 }
  );
  const cleartext = Buffer.from(JSON.stringify(plaintext));
  cipher.setAAD(aad(envelope), { plaintextLength: cleartext.length });
  envelope.ciphertext = Buffer.concat([
    cipher.update(cleartext),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
  return envelope;
}

function decrypt(envelope: Envelope) {
  const shared = diffieHellman({
    privateKey: clientX25519Private,
    publicKey: x25519PublicFromRaw(envelope.ephemeralPublicKey),
  });
  const combined = Buffer.from(envelope.ciphertext, "base64");
  const ciphertext = combined.subarray(0, -16);
  const decipher = createDecipheriv(
    "chacha20-poly1305",
    deriveKey(shared, envelope),
    Buffer.from(envelope.nonce, "base64"),
    { authTagLength: 16 }
  );
  decipher.setAAD(aad(envelope), { plaintextLength: ciphertext.length });
  decipher.setAuthTag(combined.subarray(-16));
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    )
  );
}

function post(route: string, envelope: Envelope): Promise<Envelope> {
  const url = new URL(connection.address + route.replace("/v2", ""));
  const body = Buffer.from(JSON.stringify(envelope));
  const options: RequestOptions = {
    method: "POST",
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    ca: connection.caCertificatePem,
    cert: clientCertificate,
    key: clientTlsKey,
    rejectUnauthorized: true,
    headers: {
      "content-type": "application/json",
      "content-length": body.length,
    },
    checkServerIdentity(host, certificate) {
      const normalError = checkServerIdentity(host, certificate);
      if (normalError) return normalError;
      const spki = new X509Certificate(certificate.raw).publicKey.export({
        format: "der",
        type: "spki",
      });
      const actual = `sha256/${createHash("sha256").update(spki).digest("base64")}`;
      return actual === connection.serverSpkiSha256
        ? undefined
        : new Error(`SPKI pin mismatch: ${actual}`);
    },
    timeout: 15_000,
  };
  return new Promise((resolve, reject) => {
    const req = request(options, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if ((response.statusCode ?? 500) >= 400)
          reject(new Error(parsed.error));
        else resolve(parsed as Envelope);
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function requestAccounts() {
  const keyId = process.env.GHA_KEY_ID!;
  const keySecret = process.env.GHA_KEY_SECRET!;
  const application = {
    name: "Example Tool",
    developer: "Example Studio",
    icon: "https://example.com/icon.png",
    description: "Reads a user-approved group for a local task",
    executablePath: process.execPath,
  };
  const accepted = decrypt(
    await post(
      "/v2/account-requests",
      encrypt(
        "/v2/account-requests",
        {
          application,
          purpose: "Run the requested local automation",
          keyId,
          keySecret,
        },
        keyId
      )
    )
  );
  const status = await post(
    "/v2/request-status",
    encrypt(
      "/v2/request-status",
      { requestId: accepted.requestId, keyId, keySecret },
      keyId
    )
  );
  console.log(decrypt(status));
}

void requestAccounts();
