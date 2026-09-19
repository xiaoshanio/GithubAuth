/** Data model only — visual decisions live in Home.tsx under the "加密索引库" design direction. */
export type AppLanguage =
  | "zh-CN"
  | "zh-TW"
  | "en"
  | "ja"
  | "ko"
  | "ru"
  | "fr"
  | "vi"
  | "es"
  | "it"
  | "pt"
  | "fi"
  | "fil";

export type VaultGroup = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
};

export type VaultEmail = {
  value: string;
  isPrimary: boolean;
  showOnHome: boolean;
};

export type VaultAccount = {
  id: string;
  name: string;
  email: string;
  emails: VaultEmail[];
  password: string;
  totpSecret: string;
  groupId: string;
  note: string;
  avatarUrl?: string;
  githubCreatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultSettings = {
  language: AppLanguage;
  clipboardClearSeconds: number;
};

export type LocalApiKey = {
  id: string;
  name: string;
  keyHash: string;
  groupId: string;
  clientId: string | null;
  requiresRepair: boolean;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export type PairedClient = {
  id: string;
  applicationName: string;
  developer: string;
  description: string;
  icon: string;
  certificateFingerprint: string;
  encryptionPublicKey: string;
  executablePath: string;
  executableSha256: string;
  authenticodePublisher: string;
  signatureStatus: string;
  allowImport: boolean;
  allowRead: boolean;
  groupId: string | null;
  enabled: boolean;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

export type LocalApiLog = {
  id: string;
  occurredAt: string;
  method?: string | null;
  clientId: string | null;
  endpoint: string;
  action:
    | "import_request"
    | "import_approved"
    | "import_denied"
    | "account_request"
    | "account_approved"
    | "account_denied"
    | "client_paired"
    | "api_key_created"
    | string;
  outcome: "pending" | "success" | "denied" | "blocked" | string;
  appName: string;
  developer: string;
  certificateFingerprint: string | null;
  executableSha256: string | null;
  apiKeyName: string | null;
  groupId: string | null;
  accountCount: number;
  sourcePid: number | null;
  remoteAddress: string;
  requestId: string | null;
  detail: string;
};

export type LocalApiConfig = {
  protocolVersion: number;
  exportEnabled: boolean;
  apiKeys: LocalApiKey[];
  clients: PairedClient[];
  logs: LocalApiLog[];
};

export type ClientApplication = {
  name: string;
  developer: string;
  icon: string;
  description: string;
  executablePath: string;
};

export type IncomingAccount = {
  name: string;
  email: string;
  password: string;
  emails: string[];
  totpSecret: string;
  note: string;
  avatarUrl: string | null;
  githubCreatedAt: string | null;
};

export type PendingApiImport = {
  id: string;
  clientId: string;
  application: ClientApplication;
  purpose: string;
  accounts: IncomingAccount[];
  requestedAt: string;
  remoteAddress: string;
  sourcePid: number | null;
  executableSha256: string;
  authenticodePublisher: string;
  signatureStatus: string;
};

export type ExportAccountPreview = {
  name: string;
  email: string;
  hasPassword: boolean;
  hasTotp: boolean;
};

export type PendingApiExport = {
  id: string;
  clientId: string;
  application: ClientApplication;
  purpose: string;
  apiKeyName: string;
  apiKeyId: string;
  groupId: string;
  groupName: string;
  accounts: ExportAccountPreview[];
  requestedAt: string;
  remoteAddress: string;
  sourcePid: number | null;
  executablePath: string;
  executableSha256: string;
  authenticodePublisher: string;
  signatureStatus: string;
};

export type PendingPairing = {
  id: string;
  clientId: string;
  application: ClientApplication;
  purpose: string;
  allowImport: boolean;
  allowRead: boolean;
  groupId: string | null;
  groupName: string | null;
  requestedAt: string;
  remoteAddress: string;
  sourcePid: number | null;
  executablePath: string;
  executableSha256: string;
  authenticodePublisher: string;
  signatureStatus: string;
};

export type LocalApiRuntimeStatus = {
  listening: boolean;
  baseUrl: string;
  importEndpoint: string;
  accountEndpoint: string;
  pairingEndpoint: string;
  protocolVersion: number;
  tls13: boolean;
  mtls: boolean;
  instanceId: string;
  spkiFingerprint: string;
  serverEncryptionPublicKey: string;
};

export type VaultPayload = {
  groups: VaultGroup[];
  accounts: VaultAccount[];
  settings: VaultSettings;
  localApi: LocalApiConfig;
};

export type VaultStatus = {
  hasVault: boolean;
  quickUnlockEnabled: boolean;
};

export type UnlockView = {
  payload: VaultPayload;
  quickUnlockEnabled: boolean;
};

export type TotpSetupView = {
  qrDataUrl: string;
  manualSecret: string;
};

export type BackupSettings = {
  enabled: boolean;
  intervalHours: 6 | 12 | 24 | 168;
  directory: string;
  retention: number;
  lastBackupAt: string | null;
  lastError: string | null;
};

export type ImportMode = "add" | "replace" | "backupGroup";

export type ImportPreview = {
  token: string;
  accountCount: number;
  groupCount: number;
  createdAt: string;
};
