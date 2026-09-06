# Github Auth

Kho lưu trữ cục bộ đã mã hóa cho tài khoản GitHub, được đóng gói cho Windows bằng Tauri 2.

**Đọc tài liệu này bằng các ngôn ngữ khác:** [简体中文](README.zh-CN.md) · [English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Français](README.fr.md) · **Tiếng Việt** · [한국어](README.ko.md)

## Ngôn ngữ giao diện

Ứng dụng đi kèm 13 ngôn ngữ giao diện: 简体中文, 繁體中文, English, 日本語, 한국어, Русский, Français, Tiếng Việt, Español, Italiano, Português, Suomi và Filipino. Khi khởi động lần đầu, giao diện theo ngôn ngữ của hệ điều hành; bạn có thể đổi ngôn ngữ bất kỳ lúc nào trong phần cài đặt Vault, và lựa chọn sẽ được ghi nhớ.

## Yêu cầu

- Windows 10 hoặc Windows 11
- Node.js và pnpm
- Rust stable với target `x86_64-pc-windows-msvc`
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

## Phát triển

```powershell
pnpm install
pnpm tauri:dev
```

## Build

```powershell
pnpm tauri:build
```

Kết quả build:

- Tệp thực thi di động (portable): `src-tauri/target/release/github-auth.exe`
- Trình cài đặt NSIS: `src-tauri/target/release/bundle/nsis/Github Auth_1.0.0_x64-setup.exe`

Trình cài đặt mở bộ chọn ngôn ngữ với tiếng Anh và tiếng Trung giản thể, đồng thời sử dụng LOGO của ứng dụng cho trình cài đặt, trình gỡ cài đặt, tệp thực thi và các lối tắt.

## Bảo mật

- Định dạng vault v2 mã hóa toàn bộ payload bằng khóa dữ liệu 256-bit ngẫu nhiên và AES-256-GCM.
- Mật khẩu chính được xử lý bằng Argon2id (64 MiB, 3 vòng lặp, parallelism 1) với salt ngẫu nhiên. Khóa dẫn xuất dùng để bọc khóa dữ liệu; nó không trực tiếp mã hóa các bản ghi tài khoản.
- Mỗi lần ghi payload và mỗi lần bọc khóa bằng mật khẩu đều sử dụng nonce AES-GCM 96-bit hoàn toàn mới và dữ liệu xác thực (authenticated data) riêng cho từng mục đích.
- Envelope, payload, vùng chứa sao lưu, giới hạn KDF, ID bản ghi và tham chiếu nhóm đều được backend Rust xác thực trước khi sử dụng.
- Tệp vault được thay thế một cách nguyên tử (atomic) với ngữ nghĩa write-through trên Windows. Ứng dụng chạy đơn thực thể (single-instance) để ngăn ghi vault đồng thời.
- Tệp vault phiên bản 1 dùng PBKDF2-SHA-256 chỉ được di chuyển sang v2 sau khi mật khẩu cũ giải mã và xác thực thành công toàn bộ payload.
- Mật khẩu, payload đã giải mã và khóa mã hóa không được ghi vào nhật ký của ứng dụng. Các vùng đệm Rust nhạy cảm được xóa sạch khi giải phóng khi khả thi.
- Envelope hoặc bản sao lưu vượt quá giới hạn kích thước đọc được sẽ bị từ chối trước khi bất kỳ dữ liệu nào được ghi, vì vậy một payload quá lớn không bao giờ có thể thay thế tệp vault tốt bằng một tệp không thể đọc.
- URL avatar được lưu trong vault phải sử dụng nguồn gốc (origin) `https` và bị giới hạn độ dài, cùng với mọi trường tài khoản khác, trước khi payload được chấp nhận.
- Cửa sổ không có khung trang trí và phần viền giao diện được vẽ bởi chính ứng dụng. Webview chỉ được cấp đúng năm quyền cửa sổ (`start-dragging`, `minimize`, `toggle-maximize`, `is-maximized`, `close`) giới hạn trong cửa sổ `main`; không có quyền hệ thống tệp, shell, đường dẫn hay sự kiện nào bị lộ, và việc truy cập vault luôn nằm sau các lệnh riêng của ứng dụng.

### Mở khóa nhanh bằng Authenticator

Mở khóa nhanh bằng Google Authenticator sử dụng TOTP tiêu chuẩn 6 chữ số, chu kỳ 30 giây. Secret TOTP và khóa dữ liệu của vault được bảo vệ bằng Windows DPAPI cho người dùng Windows hiện tại và liên kết với ID của vault. Bước thời gian đã thành công không thể phát lại, và các lần thất bại lặp lại sẽ kích hoạt thời gian chờ tăng theo cấp số nhân.

Mở khóa nhanh là tính năng tiện lợi gắn với thiết bị, không phải một mật khẩu mã hóa thứ hai có thể mang theo. Mật khẩu chính luôn luôn khả dụng và là thông tin xác thực duy nhất có thể giải mã bản sao lưu trên một thiết bị khác. Liên kết mở khóa nhanh không bao giờ được đưa vào bản sao lưu.

## Sao lưu đã mã hóa

- Sao lưu thủ công sử dụng định dạng `.ghauth-backup` và được ghi thông qua backend Rust.
- Sao lưu tự động chỉ chạy khi Github Auth đang mở, kể cả khi vault đang bị khóa. Các khoảng thời gian được hỗ trợ là 6 giờ, 12 giờ, hằng ngày và hằng tuần.
- Thư mục sao lưu tự động mặc định là `%LOCALAPPDATA%\com.githubauth.vault\backups`; có thể thay đổi thư mục và số lượng lưu giữ trong phần cài đặt Vault.
- Một bản sao lưu sử dụng mật khẩu chính đang có hiệu lực tại thời điểm bản sao lưu đó được tạo. Việc thay đổi mật khẩu chính hiện tại không ảnh hưởng đến các bản sao lưu cũ hơn.
- Nhập (import) trước tiên yêu cầu mật khẩu gốc của bản sao lưu. Việc thêm dữ liệu hoặc đặt dữ liệu vào nhóm sao lưu có ngày sẽ giữ nguyên cài đặt vault hiện tại.
- Thay thế dữ liệu hiện tại luôn yêu cầu mật khẩu vault hiện tại như một bước xác thực riêng biệt. Người dùng có thể tạo một bản sao lưu được bảo vệ bằng mật khẩu hiện tại trước khi thay thế.
- Dữ liệu được nhập sẽ được mã hóa lại bằng khóa dữ liệu của vault hiện tại và bộ bọc mật khẩu chính hiện tại. Việc nhập không bao giờ thay đổi mật khẩu hiện tại hay liên kết với Authenticator.

Envelope đã mã hóa được lưu dưới `%LOCALAPPDATA%\com.githubauth.vault`. Bản build production đã loại bỏ runtime Manus cũ, trình thu thập debug và proxy lưu trữ.

Chạy các bài kiểm tra bảo mật bằng:

```powershell
pnpm test:security
cargo test --manifest-path src-tauri/Cargo.toml
```

Các bản build release chưa được ký cho đến khi cấu hình chứng chỉ ký mã (code-signing) của Windows. Trình cài đặt chưa ký có thể kích hoạt cảnh báo Microsoft Defender SmartScreen.
