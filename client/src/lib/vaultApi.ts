import { invoke } from "@tauri-apps/api/core";
import type {
  BackupSettings,
  ImportMode,
  ImportPreview,
  TotpSetupView,
  UnlockView,
  VaultPayload,
  VaultStatus,
} from "./types";

export const vaultApi = {
  getStatus: () => invoke<VaultStatus>("get_vault_status"),
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
  lock: () => invoke<void>("lock_vault"),
  savePayload: (payload: VaultPayload) =>
    invoke<void>("save_vault_payload", { payload }),
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
};
