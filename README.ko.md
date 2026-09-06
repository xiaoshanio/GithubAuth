# Github Auth

Tauri 2로 Windows용으로 패키징된, 로컬 암호화 GitHub 계정 볼트입니다.

**다른 언어로 읽기:** [简体中文](README.zh-CN.md) · [English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Français](README.fr.md) · [Tiếng Việt](README.vi.md) · **한국어**

## 인터페이스 언어

앱은 13가지 인터페이스 언어와 함께 제공됩니다: 简体中文, 繁體中文, English, 日本語, 한국어, Русский, Français, Tiếng Việt, Español, Italiano, Português, Suomi, Filipino. 첫 실행 시 인터페이스는 운영 체제 언어를 따릅니다. 언어는 볼트 설정에서 언제든지 변경할 수 있으며, 선택한 내용은 기억됩니다.

## 요구 사항

- Windows 10 또는 Windows 11
- Node.js 및 pnpm
- `x86_64-pc-windows-msvc` 타깃이 포함된 Rust stable
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

## 개발

```powershell
pnpm install
pnpm tauri:dev
```

## 빌드

```powershell
pnpm tauri:build
```

빌드 결과물:

- 포터블 실행 파일: `src-tauri/target/release/github-auth.exe`
- NSIS 설치 관리자: `src-tauri/target/release/bundle/nsis/Github Auth_1.0.0_x64-setup.exe`

설치 관리자는 영어와 간체 중국어를 포함한 언어 선택기를 열며, 설치 관리자, 제거 프로그램, 실행 파일, 바로 가기에 애플리케이션 LOGO를 사용합니다.

## 보안

- 볼트 포맷 v2는 무작위 256비트 데이터 키와 AES-256-GCM으로 전체 페이로드를 암호화합니다.
- 마스터 비밀번호는 무작위 솔트와 함께 Argon2id(64 MiB, 3회 반복, 병렬도 1)로 처리됩니다. 파생된 키는 데이터 키를 래핑하며, 계정 레코드를 직접 암호화하지 않습니다.
- 페이로드를 기록할 때와 비밀번호 키를 래핑할 때마다 새로운 96비트 AES-GCM nonce와 용도별 인증 데이터가 사용됩니다.
- 엔벨로프, 페이로드, 백업 컨테이너, KDF 제한, 레코드 ID, 그룹 참조는 사용 전에 Rust 백엔드에서 검증됩니다.
- Windows에서 볼트 파일은 write-through 의미론으로 원자적으로 교체됩니다. 애플리케이션은 단일 인스턴스로 실행되어 볼트에 대한 동시 쓰기를 방지합니다.
- 버전 1 PBKDF2-SHA-256 볼트 파일은 이전 비밀번호가 전체 페이로드를 성공적으로 복호화하고 인증한 후에만 v2로 마이그레이션됩니다.
- 비밀번호, 복호화된 페이로드, 암호화 키는 애플리케이션 로그에 기록되지 않습니다. 민감한 Rust 버퍼는 실용적인 범위에서 해제 시 삭제됩니다.
- 읽을 수 있는 크기 제한을 초과하는 엔벨로프나 백업은 무엇이든 기록되기 전에 거부되므로, 지나치게 큰 페이로드가 정상적인 볼트 파일을 읽을 수 없는 파일로 대체하는 일은 결코 일어나지 않습니다.
- 볼트에 저장되는 아바타 URL은 `https` 오리진을 사용해야 하며, 다른 모든 계정 필드와 마찬가지로 길이가 제한된 후에야 페이로드로 승인됩니다.
- 창은 장식이 없으며 창의 외곽은 애플리케이션이 그립니다. 웹뷰에는 `main` 창으로 범위가 지정된 정확히 다섯 개의 창 권한(`start-dragging`, `minimize`, `toggle-maximize`, `is-maximized`, `close`)만 부여되며, 파일 시스템, 셸, 경로 또는 이벤트 권한은 노출되지 않고, 볼트 접근은 항상 애플리케이션 자체의 명령 뒤에 유지됩니다.

### 인증기 빠른 잠금 해제

Google Authenticator 빠른 잠금 해제는 표준적인 6자리, 30초 주기 TOTP를 사용합니다. TOTP 시크릿과 볼트 데이터 키는 현재 Windows 사용자에 대해 Windows DPAPI로 보호되며 볼트 ID에 바인딩됩니다. 성공한 시간 단계는 재생(replay)될 수 없으며, 반복된 실패는 지수적으로 증가하는 쿨다운을 유발합니다.

빠른 잠금 해제는 기기에 바인딩된 편의 기능이지, 휴대 가능한 두 번째 암호화 비밀번호가 아닙니다. 마스터 비밀번호는 항상 사용 가능하며, 다른 기기에서 백업을 복호화할 수 있는 유일한 자격 증명입니다. 빠른 잠금 해제 바인딩은 백업에 절대 포함되지 않습니다.

## 암호화 백업

- 수동 백업은 `.ghauth-backup` 형식을 사용하며 Rust 백엔드를 통해 기록됩니다.
- 자동 백업은 볼트가 잠겨 있는 경우를 포함하여 Github Auth가 열려 있는 동안에만 실행됩니다. 지원되는 간격은 6시간, 12시간, 매일, 매주입니다.
- 기본 자동 백업 디렉터리는 `%LOCALAPPDATA%\com.githubauth.vault\backups`이며, 디렉터리와 보관 개수는 볼트 설정에서 변경할 수 있습니다.
- 백업은 해당 백업이 생성된 시점에 유효했던 마스터 비밀번호를 사용합니다. 현재 마스터 비밀번호를 변경해도 이전 백업은 변경되지 않습니다.
- 가져오기(import)에는 먼저 해당 백업의 원래 비밀번호가 필요합니다. 데이터를 추가하거나 날짜가 있는 백업 그룹에 배치하면 현재 볼트 설정이 유지됩니다.
- 현재 데이터를 교체할 때는 항상 현재 볼트 비밀번호가 별도의 인증 단계로 필요합니다. 사용자는 교체 전에 현재 비밀번호로 보호되는 백업을 생성할 수 있습니다.
- 가져온 데이터는 현재 볼트의 데이터 키와 현재 마스터 비밀번호 래퍼로 다시 암호화됩니다. 가져오기는 현재 비밀번호나 인증기 바인딩을 절대 변경하지 않습니다.

암호화된 엔벨로프는 `%LOCALAPPDATA%\com.githubauth.vault` 아래에 저장됩니다. 프로덕션 빌드는 이전의 Manus 런타임, 디버그 수집기, 스토리지 프록시를 제외합니다.

보안 테스트 실행 방법:

```powershell
pnpm test:security
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows 코드 서명 인증서가 구성될 때까지 릴리스 빌드는 서명되지 않은 상태입니다. 서명되지 않은 설치 관리자는 Microsoft Defender SmartScreen 경고를 트리거할 수 있습니다.
