import type { AppLanguage } from "@/lib/types";

export type ScreenCaptureMessages = {
  settingTitle: string;
  settingHint: string;
  enabledStatus: string;
  disabledStatus: string;
  unavailableStatus: string;
  applyingStatus: string;
  noticeTitle: string;
  noticeDescription: string;
  noticeLimitation: string;
  understand: string;
  understandAndDontShow: string;
  openSettings: string;
};

const en: ScreenCaptureMessages = {
  settingTitle: "Screen capture protection",
  settingHint:
    "Keep the window visible on this PC, but hide it from supported screenshots and screen recordings.",
  enabledStatus: "Protection is on. Supported captures omit this window.",
  disabledStatus:
    "Protection is off. The window may appear in screenshots and recordings.",
  unavailableStatus:
    "Screen capture protection is unavailable on this platform.",
  applyingStatus: "Applying screen capture protection…",
  noticeTitle: "Screen capture may expose sensitive data",
  noticeDescription:
    "Github Auth contains passwords, email addresses, and 2FA secrets. Capture protection is on by default. Supported Windows capture methods will omit this window or show an empty area.",
  noticeLimitation:
    "This cannot stop cameras, external capture hardware, or privileged capture tools. Older Windows versions may show a black placeholder instead.",
  understand: "I understand",
  understandAndDontShow: "I understand — don't show again",
  openSettings: "Open settings",
};

const messages: Partial<Record<AppLanguage, ScreenCaptureMessages>> = {
  en,
  "zh-CN": {
    settingTitle: "屏幕捕获保护",
    settingHint:
      "应用在本机仍正常显示，但会从受支持的截图和录屏结果中自动隐藏。",
    enabledStatus: "保护已开启，受支持的捕获方式将不显示此窗口。",
    disabledStatus: "保护已关闭，此窗口可能出现在截图和录屏中。",
    unavailableStatus: "当前平台不支持屏幕捕获保护。",
    applyingStatus: "正在应用屏幕捕获保护…",
    noticeTitle: "屏幕截图和录屏存在数据泄露风险",
    noticeDescription:
      "Github Auth 包含密码、邮箱和 2FA 密钥。屏幕捕获保护已默认开启；在受支持的 Windows 捕获方式中，本窗口会从截图或录屏结果中消失，或显示为空白区域。",
    noticeLimitation:
      "此功能无法阻止相机、外接采集卡或高权限捕获工具；旧版 Windows 也可能显示黑色占位。",
    understand: "我理解",
    understandAndDontShow: "我理解并不再弹出",
    openSettings: "前往设置修改",
  },
  "zh-TW": {
    settingTitle: "螢幕擷取保護",
    settingHint:
      "應用程式在本機仍正常顯示，但會從支援的截圖與螢幕錄影結果中自動隱藏。",
    enabledStatus: "保護已開啟，支援的擷取方式將不顯示此視窗。",
    disabledStatus: "保護已關閉，此視窗可能出現在截圖與螢幕錄影中。",
    unavailableStatus: "目前平台不支援螢幕擷取保護。",
    applyingStatus: "正在套用螢幕擷取保護…",
    noticeTitle: "螢幕截圖與錄影可能造成資料外洩",
    noticeDescription:
      "Github Auth 包含密碼、電子郵件與 2FA 金鑰。螢幕擷取保護預設開啟；在支援的 Windows 擷取方式中，本視窗會從截圖或錄影結果中消失，或顯示為空白區域。",
    noticeLimitation:
      "此功能無法阻止相機、外接擷取卡或高權限擷取工具；舊版 Windows 也可能顯示黑色預留區。",
    understand: "我瞭解",
    understandAndDontShow: "我瞭解且不再顯示",
    openSettings: "前往設定修改",
  },
  ja: {
    ...en,
    settingTitle: "画面キャプチャ保護",
    settingHint:
      "このPCでは通常どおり表示し、対応するスクリーンショットや録画から自動的に隠します。",
    enabledStatus: "保護は有効です。対応するキャプチャには表示されません。",
    disabledStatus:
      "保護は無効です。スクリーンショットや録画に表示される場合があります。",
    unavailableStatus: "この環境では画面キャプチャ保護を利用できません。",
    applyingStatus: "画面キャプチャ保護を適用しています…",
    noticeTitle: "画面キャプチャで機密情報が漏れる可能性があります",
    understand: "理解しました",
    understandAndDontShow: "理解しました。今後表示しない",
    openSettings: "設定を開く",
  },
  ko: {
    ...en,
    settingTitle: "화면 캡처 보호",
    settingHint:
      "이 PC에서는 창을 정상적으로 표시하면서 지원되는 스크린샷과 화면 녹화에서는 자동으로 숨깁니다.",
    enabledStatus:
      "보호가 켜져 있습니다. 지원되는 캡처에서는 이 창이 제외됩니다.",
    disabledStatus:
      "보호가 꺼져 있습니다. 스크린샷이나 녹화에 창이 표시될 수 있습니다.",
    unavailableStatus: "이 플랫폼에서는 화면 캡처 보호를 사용할 수 없습니다.",
    applyingStatus: "화면 캡처 보호를 적용하는 중…",
    noticeTitle: "화면 캡처로 민감한 데이터가 노출될 수 있습니다",
    understand: "이해했습니다",
    understandAndDontShow: "이해했으며 다시 표시하지 않기",
    openSettings: "설정 열기",
  },
  ru: {
    ...en,
    settingTitle: "Защита от захвата экрана",
    settingHint:
      "Окно остаётся видимым на этом компьютере, но скрывается из поддерживаемых снимков и записей экрана.",
    enabledStatus:
      "Защита включена: поддерживаемый захват не показывает это окно.",
    disabledStatus:
      "Защита выключена: окно может попасть на снимок или запись.",
    unavailableStatus: "Защита от захвата экрана недоступна на этой платформе.",
    applyingStatus: "Применение защиты от захвата экрана…",
    noticeTitle: "Захват экрана может раскрыть конфиденциальные данные",
    understand: "Понятно",
    understandAndDontShow: "Понятно, больше не показывать",
    openSettings: "Открыть настройки",
  },
  fr: {
    ...en,
    settingTitle: "Protection contre la capture d’écran",
    settingHint:
      "La fenêtre reste visible sur ce PC, mais est masquée des captures et enregistrements compatibles.",
    enabledStatus:
      "Protection activée : les captures compatibles omettent cette fenêtre.",
    disabledStatus:
      "Protection désactivée : la fenêtre peut apparaître dans les captures.",
    unavailableStatus:
      "La protection contre la capture est indisponible sur cette plateforme.",
    applyingStatus: "Application de la protection contre la capture…",
    noticeTitle: "La capture d’écran peut exposer des données sensibles",
    understand: "J’ai compris",
    understandAndDontShow: "J’ai compris, ne plus afficher",
    openSettings: "Ouvrir les paramètres",
  },
  vi: {
    ...en,
    settingTitle: "Bảo vệ chụp màn hình",
    settingHint:
      "Cửa sổ vẫn hiển thị trên máy này nhưng tự ẩn khỏi ảnh chụp và bản ghi màn hình được hỗ trợ.",
    enabledStatus:
      "Đã bật bảo vệ; bản chụp được hỗ trợ sẽ không hiển thị cửa sổ này.",
    disabledStatus:
      "Đã tắt bảo vệ; cửa sổ có thể xuất hiện trong ảnh chụp hoặc bản ghi.",
    unavailableStatus: "Nền tảng này không hỗ trợ bảo vệ chụp màn hình.",
    applyingStatus: "Đang áp dụng bảo vệ chụp màn hình…",
    noticeTitle: "Chụp màn hình có thể làm lộ dữ liệu nhạy cảm",
    understand: "Tôi hiểu",
    understandAndDontShow: "Tôi hiểu và không hiển thị lại",
    openSettings: "Mở cài đặt",
  },
  es: {
    ...en,
    settingTitle: "Protección contra capturas de pantalla",
    settingHint:
      "La ventana sigue visible en este equipo, pero se oculta de capturas y grabaciones compatibles.",
    enabledStatus:
      "Protección activada; las capturas compatibles omiten esta ventana.",
    disabledStatus:
      "Protección desactivada; la ventana puede aparecer en capturas y grabaciones.",
    unavailableStatus:
      "La protección de captura no está disponible en esta plataforma.",
    applyingStatus: "Aplicando protección de captura…",
    noticeTitle: "Las capturas pueden exponer datos confidenciales",
    understand: "Entiendo",
    understandAndDontShow: "Entiendo y no volver a mostrar",
    openSettings: "Abrir ajustes",
  },
  it: {
    ...en,
    settingTitle: "Protezione dall’acquisizione dello schermo",
    settingHint:
      "La finestra resta visibile su questo PC, ma viene nascosta da screenshot e registrazioni supportati.",
    enabledStatus:
      "Protezione attiva: le acquisizioni supportate omettono questa finestra.",
    disabledStatus:
      "Protezione disattiva: la finestra può apparire nelle acquisizioni.",
    unavailableStatus: "La protezione non è disponibile su questa piattaforma.",
    applyingStatus: "Applicazione della protezione…",
    noticeTitle: "L’acquisizione dello schermo può esporre dati sensibili",
    understand: "Ho capito",
    understandAndDontShow: "Ho capito, non mostrare più",
    openSettings: "Apri impostazioni",
  },
  pt: {
    ...en,
    settingTitle: "Proteção contra captura de ecrã",
    settingHint:
      "A janela permanece visível neste PC, mas fica oculta em capturas e gravações compatíveis.",
    enabledStatus:
      "Proteção ativa; as capturas compatíveis omitem esta janela.",
    disabledStatus:
      "Proteção desativada; a janela pode aparecer em capturas e gravações.",
    unavailableStatus:
      "A proteção de captura não está disponível nesta plataforma.",
    applyingStatus: "A aplicar proteção de captura…",
    noticeTitle: "A captura de ecrã pode expor dados confidenciais",
    understand: "Compreendo",
    understandAndDontShow: "Compreendo e não mostrar novamente",
    openSettings: "Abrir definições",
  },
  fi: {
    ...en,
    settingTitle: "Näytönkaappauksen suojaus",
    settingHint:
      "Ikkuna näkyy normaalisti tällä tietokoneella, mutta piilotetaan tuetuista kuvakaappauksista ja tallenteista.",
    enabledStatus:
      "Suojaus on käytössä; tuetut kaappaukset eivät näytä tätä ikkunaa.",
    disabledStatus: "Suojaus ei ole käytössä; ikkuna voi näkyä kaappauksissa.",
    unavailableStatus:
      "Näytönkaappauksen suojaus ei ole käytettävissä tällä alustalla.",
    applyingStatus: "Otetaan näytönkaappauksen suojausta käyttöön…",
    noticeTitle: "Näytönkaappaus voi paljastaa arkaluonteisia tietoja",
    understand: "Ymmärrän",
    understandAndDontShow: "Ymmärrän, älä näytä uudelleen",
    openSettings: "Avaa asetukset",
  },
  fil: {
    ...en,
    settingTitle: "Proteksyon sa screen capture",
    settingHint:
      "Mananatiling nakikita ang window sa PC na ito ngunit awtomatikong itatago sa mga suportadong screenshot at recording.",
    enabledStatus:
      "Naka-on ang proteksyon; hindi isasama ang window sa suportadong capture.",
    disabledStatus:
      "Naka-off ang proteksyon; maaaring lumabas ang window sa capture.",
    unavailableStatus: "Hindi available ang proteksyon sa platform na ito.",
    applyingStatus: "Inilalapat ang proteksyon sa screen capture…",
    noticeTitle: "Maaaring maglantad ng sensitibong data ang screen capture",
    understand: "Nauunawaan ko",
    understandAndDontShow: "Nauunawaan ko at huwag nang ipakita",
    openSettings: "Buksan ang settings",
  },
};

export function getScreenCaptureMessages(language: AppLanguage) {
  return messages[language] ?? en;
}
