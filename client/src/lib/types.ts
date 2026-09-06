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

export type VaultPayload = {
  groups: VaultGroup[];
  accounts: VaultAccount[];
  settings: VaultSettings;
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
