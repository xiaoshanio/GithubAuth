import { invoke } from "@tauri-apps/api/core";
import type {
  BackupSettings,
  LocalApiConfig,
  LocalApiRuntimeStatus,
  PendingApiImport,
  PendingApiExport,
  ImportMode,
  ImportPreview,
  TotpSetupView,
  UnlockView,
  VaultPayload,
  VaultStatus,
} from "./types";

export type CreatedApiKey = {
  apiKey: string;
  config: LocalApiConfig;
};

export type ResetOutcome = {
  backupPath: string;
  verifiedBy: "windowsHello" | "acknowledgment";
};

export const vaultApi = {
  getStatus: () => invoke<VaultStatus>("get_vault_status"),
  checkWindowsHello: () =>
    invoke<"available" | "notConfigured" | "unavailable">(
      "check_windows_hello"
    ),
  resetVault: (acknowledgment?: string | null) =>
    invoke<ResetOutcome>("reset_vault", {
      acknowledgment: acknowledgment ?? null,
    }),
  beginInitialization: (password: string) =>
    invoke<void>("begin_initialization", { password }),
  cancelInitialization: () => invoke<void>("cancel_initialization"),
  beginInitialTotp: () => invoke<TotpSetupView>("begin_initial_totp_setup"),
  completePasswordInitialization: () =>
    invoke<UnlockView>("complete_password_initialization"),
  confirmInitialTotp: (code: string) =>
    invoke<UnlockView>("confirm_initial_totp", { code }),
  unlockWithPassword: (password: string) =>
    invoke<UnlockView>("unlock_with_password", { password }),
  unlockWithTotp: (code: string) =>
    invoke<UnlockView>("unlock_with_totp", { code }),
  verifyTotpForAction: (code: string) =>
    invoke<void>("verify_totp_for_action", { code }),
  verifyPasswordForAction: (password: string) =>
    invoke<void>("verify_password_for_action", { password }),
  lock: () => invoke<void>("lock_vault"),
  savePayload: (payload: VaultPayload) =>
    invoke<void>("save_vault_payload", { payload }),
  getUnlockedPayload: () => invoke<VaultPayload>("get_unlocked_payload"),
  changeMasterPassword: (currentPassword: string, newPassword: string) =>
    invoke<void>("change_master_password", { currentPassword, newPassword }),
  beginTotpRebind: (currentPassword: string) =>
    invoke<TotpSetupView>("begin_totp_rebind", { currentPassword }),
  confirmTotpRebind: (code: string) =>
    invoke<void>("confirm_totp_rebind", { code }),
  disableTotp: (currentPassword: string) =>
    invoke<void>("disable_totp", { currentPassword }),
  getBackupSettings: () => invoke<BackupSettings>("get_backup_settings"),
  updateBackupSettings: (settings: BackupSettings) =>
    invoke<BackupSettings>("update_backup_settings", { settings }),
  chooseBackupDirectory: () => invoke<string | null>("choose_backup_directory"),
  createManualBackup: () => invoke<string | null>("create_manual_backup"),
  chooseImportBackup: () => invoke<string | null>("choose_import_backup"),
  inspectBackup: (path: string, backupPassword: string) =>
    invoke<ImportPreview>("inspect_backup", { path, backupPassword }),
  cancelBackupImport: () => invoke<void>("cancel_backup_import"),
  commitBackupImport: (
    token: string,
    mode: ImportMode,
    backupCurrent: boolean,
    currentPassword?: string
  ) =>
    invoke<VaultPayload>("commit_backup_import", {
      token,
      mode,
      backupCurrent,
      currentPassword: currentPassword || null,
    }),
  getLocalApiRuntimeStatus: () =>
    invoke<LocalApiRuntimeStatus>("get_local_api_runtime_status"),
  getPendingApiImports: () =>
    invoke<PendingApiImport[]>("get_pending_api_imports"),
  getPendingApiExports: () =>
    invoke<PendingApiExport[]>("get_pending_api_exports"),
  approveLocalApiImport: (
    requestId: string,
    groupId: string | null,
    newGroupName: string | null,
    authKind: "password" | "totp",
    credential: string
  ) =>
    invoke<VaultPayload>("approve_local_api_import", {
      input: {
        requestId,
        groupId,
        newGroupName,
        authKind,
        credential,
      },
    }),
  denyLocalApiImport: (requestId: string) =>
    invoke<VaultPayload>("deny_local_api_import", { requestId }),
  approveLocalApiExport: (
    requestId: string,
    authKind: "password" | "totp",
    credential: string
  ) =>
    invoke<VaultPayload>("approve_local_api_export", {
      requestId,
      authKind,
      credential,
    }),
  denyLocalApiExport: (requestId: string) =>
    invoke<VaultPayload>("deny_local_api_export", { requestId }),
  createLocalApiKey: (
    name: string,
    groupId: string,
    authKind: "password" | "totp",
    credential: string
  ) =>
    invoke<CreatedApiKey>("create_local_api_key", {
      name,
      groupId,
      authKind,
      credential,
    }),
  setLocalApiExportEnabled: (
    enabled: boolean,
    authKind?: "password" | "totp",
    credential?: string
  ) =>
    invoke<LocalApiConfig>("set_local_api_export_enabled", {
      enabled,
      authKind: authKind ?? null,
      credential: credential ?? null,
    }),
  setLocalApiKeyEnabled: (keyId: string, enabled: boolean) =>
    invoke<LocalApiConfig>("set_local_api_key_enabled", { keyId, enabled }),
  deleteLocalApiKey: (keyId: string) =>
    invoke<LocalApiConfig>("delete_local_api_key", { keyId }),
};
