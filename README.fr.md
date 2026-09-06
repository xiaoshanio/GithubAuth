# Github Auth

Coffre-fort local et chiffré de comptes GitHub, packagé pour Windows avec Tauri 2.

**Lisez ceci dans d'autres langues :** [简体中文](README.zh-CN.md) · [English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · **Français** · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md)

## Langues de l'interface

L'application est livrée avec 13 langues d'interface : 简体中文, 繁體中文, English, 日本語, 한국어, Русский, Français, Tiếng Việt, Español, Italiano, Português, Suomi et Filipino. Au premier lancement, l'interface suit la langue du système d'exploitation ; la langue peut être modifiée à tout moment dans les paramètres du coffre-fort (Vault settings), et le choix est mémorisé.

## Prérequis

- Windows 10 ou Windows 11
- Node.js et pnpm
- Rust stable avec la cible `x86_64-pc-windows-msvc`
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

## Développement

```powershell
pnpm install
pnpm tauri:dev
```

## Build

```powershell
pnpm tauri:build
```

Résultats du build :

- Exécutable portable : `src-tauri/target/release/github-auth.exe`
- Installateur NSIS : `src-tauri/target/release/bundle/nsis/Github Auth_1.0.0_x64-setup.exe`

L'installateur ouvre un sélecteur de langue avec l'anglais et le chinois simplifié, et utilise le LOGO de l'application pour l'installateur, le désinstallateur, l'exécutable et les raccourcis.

## Sécurité

- Le format de coffre-fort v2 chiffre l'intégralité de la charge utile avec une clé de données aléatoire de 256 bits et AES-256-GCM.
- Le mot de passe maître est traité par Argon2id (64 MiB, 3 itérations, parallélisme 1) avec un sel aléatoire. La clé dérivée enveloppe la clé de données ; elle ne chiffre pas directement les enregistrements de comptes.
- Chaque écriture de charge utile et chaque enveloppement de clé de mot de passe utilise un nonce AES-GCM de 96 bits frais et des données authentifiées propres à l'usage.
- Les enveloppes, les charges utiles, les conteneurs de sauvegarde, les limites KDF, les identifiants d'enregistrements et les références de groupes sont validés par le backend Rust avant utilisation.
- Les fichiers de coffre-fort sont remplacés de manière atomique avec une sémantique write-through sous Windows. L'application est mono-instance afin d'empêcher les écritures concurrentes dans le coffre-fort.
- Les fichiers de coffre-fort version 1 avec PBKDF2-SHA-256 ne sont migrés vers v2 qu'après que l'ancien mot de passe a déchiffré et authentifié avec succès l'intégralité de la charge utile.
- Les mots de passe, les charges utiles déchiffrées et les clés de chiffrement ne sont pas écrits dans les journaux de l'application. Les tampons Rust sensibles sont effacés lors de leur libération lorsque c'est possible.
- Une enveloppe ou une sauvegarde qui dépasserait la limite de taille lisible est rejetée avant toute écriture, de sorte qu'une charge utile trop volumineuse ne puisse jamais remplacer un fichier de coffre-fort valide par un fichier illisible.
- Les URL d'avatars stockées dans le coffre-fort doivent utiliser une origine `https` et sont limitées en longueur, comme tous les autres champs de compte, avant qu'une charge utile ne soit acceptée.
- La fenêtre est sans décor et son habillage est dessiné par l'application. La webview reçoit exactement cinq autorisations de fenêtre (`start-dragging`, `minimize`, `toggle-maximize`, `is-maximized`, `close`) limitées à la fenêtre `main` ; aucune autorisation de système de fichiers, de shell, de chemin ou d'événement n'est exposée, et l'accès au coffre-fort reste derrière les commandes propres de l'application.

### Déverrouillage rapide via l'authentificateur

Le déverrouillage rapide via Google Authenticator utilise un TOTP standard à 6 chiffres sur 30 secondes. Le secret TOTP et la clé de données du coffre-fort sont protégés par Windows DPAPI pour l'utilisateur Windows actuel et liés à l'identifiant du coffre-fort. Les pas de temps réussis ne peuvent pas être rejoués, et des échecs répétés déclenchent un temps de refroidissement exponentiel.

Le déverrouillage rapide est une fonctionnalité de commodité liée à l'appareil, et non un second mot de passe de chiffrement portable. Le mot de passe maître reste toujours disponible et est la seule donnée d'identification capable de déchiffrer une sauvegarde sur un autre appareil. La liaison du déverrouillage rapide n'est jamais incluse dans les sauvegardes.

## Sauvegardes chiffrées

- Les sauvegardes manuelles utilisent le format `.ghauth-backup` et sont écrites via le backend Rust.
- Les sauvegardes automatiques ne s'exécutent que lorsque Github Auth est ouvert, y compris lorsque le coffre-fort est verrouillé. Les intervalles pris en charge sont 6 heures, 12 heures, quotidien et hebdomadaire.
- Le répertoire de sauvegarde automatique par défaut est `%LOCALAPPDATA%\com.githubauth.vault\backups` ; le répertoire et le nombre de rétentions peuvent être modifiés dans les paramètres du coffre-fort.
- Une sauvegarde utilise le mot de passe maître qui était actif au moment de sa création. Changer le mot de passe maître actuel ne modifie pas les sauvegardes plus anciennes.
- L'importation nécessite d'abord le mot de passe d'origine de la sauvegarde. L'ajout de données ou leur placement dans un groupe de sauvegarde daté préserve les paramètres actuels du coffre-fort.
- Le remplacement des données actuelles exige toujours le mot de passe actuel du coffre-fort comme étape d'autorisation distincte. L'utilisateur peut créer une sauvegarde protégée par le mot de passe actuel avant le remplacement.
- Les données importées sont rechiffrées avec la clé de données du coffre-fort actuel et l'enveloppe actuelle du mot de passe maître. L'importation ne modifie jamais le mot de passe actuel ni la liaison de l'authentificateur.

L'enveloppe chiffrée est stockée sous `%LOCALAPPDATA%\com.githubauth.vault`. Les builds de production excluent l'ancien runtime Manus, le collecteur de débogage et le proxy de stockage.

Lancez les tests de sécurité avec :

```powershell
pnpm test:security
cargo test --manifest-path src-tauri/Cargo.toml
```

Les builds de release ne sont pas signés tant qu'un certificat de signature de code Windows n'est pas configuré. Les installateurs non signés peuvent déclencher des avertissements Microsoft Defender SmartScreen.
