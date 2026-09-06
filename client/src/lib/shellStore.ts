/* Shell state shared between the top toolbar (TitleBar) and the vault screen (Home).
   A tiny external store keeps the toolbar in sync with page state without lifting
   all vault state into App. */
import { useSyncExternalStore } from "react";

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const collapsedStore = createStore(
  (() => {
    try {
      return localStorage.getItem("vault.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  })()
);

export const sidebarShell = {
  isCollapsed: collapsedStore.get,
  setCollapsed: (collapsed: boolean) => {
    collapsedStore.set(collapsed);
    try {
      localStorage.setItem("vault.sidebarCollapsed", collapsed ? "1" : "0");
    } catch {
      // Private mode: the choice just does not survive a restart.
    }
  },
};

export function useSidebarCollapsed() {
  return useSyncExternalStore(collapsedStore.subscribe, collapsedStore.get);
}

const searchStore = createStore("");
export function useShellSearch() {
  return useSyncExternalStore(searchStore.subscribe, searchStore.get);
}
export const setShellSearch = searchStore.set;

const searchPlaceholderStore = createStore("");
export function useShellSearchPlaceholder() {
  return useSyncExternalStore(searchPlaceholderStore.subscribe, searchPlaceholderStore.get);
}
export const setShellSearchPlaceholder = searchPlaceholderStore.set;

const unlockedStore = createStore(false);
export function useShellUnlocked() {
  return useSyncExternalStore(unlockedStore.subscribe, unlockedStore.get);
}
export const setShellUnlocked = unlockedStore.set;

/* The toolbar's create button opens the dialog owned by the vault screen,
   the same registration pattern the Veil shell uses for its create action. */
let createAccountOpener: (() => void) | null = null;
export const registerCreateAccount = (opener: (() => void) | null) => {
  createAccountOpener = opener;
};
export const openCreateAccountFromShell = () => {
  createAccountOpener?.();
};

/* Which group the index is filtered by, shown as a pointer chip in the toolbar.
   Null = no group filter (all accounts). */
export type ShellGroupHint = { id: string; name: string; color: string } | null;

const groupHintStore = createStore<ShellGroupHint>(null);
export function useShellGroupHint() {
  return useSyncExternalStore(groupHintStore.subscribe, groupHintStore.get);
}
export const setShellGroupHint = groupHintStore.set;

let clearGroupFilterHandler: (() => void) | null = null;
export const registerClearGroupFilter = (handler: (() => void) | null) => {
  clearGroupFilterHandler = handler;
};
export const clearGroupFilterFromShell = () => {
  clearGroupFilterHandler?.();
};
