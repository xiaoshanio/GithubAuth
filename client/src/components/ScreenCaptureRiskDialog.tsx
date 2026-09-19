import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useScreenCaptureProtection } from "@/contexts/ScreenCaptureProtectionContext";
import { getScreenCaptureMessages } from "@/lib/i18n/screenCapture";
import { Settings2, ShieldAlert } from "lucide-react";

export default function ScreenCaptureRiskDialog({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { language } = useLanguage();
  const protection = useScreenCaptureProtection();
  const messages = getScreenCaptureMessages(language);

  return (
    <AlertDialog open={protection.noticeOpen}>
      <AlertDialogContent className="border-white/[0.1] bg-[#141419] text-white sm:max-w-xl">
        <AlertDialogHeader>
          <div className="mb-2 grid size-11 place-items-center rounded-xl border border-amber-300/15 bg-amber-400/[0.07] text-amber-200">
            <ShieldAlert size={21} />
          </div>
          <AlertDialogTitle>{messages.noticeTitle}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left leading-6 text-zinc-400">
            <span className="block">{messages.noticeDescription}</span>
            <span className="block text-xs text-zinc-500">
              {messages.noticeLimitation}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:flex-wrap">
          <AlertDialogAction
            onClick={() => protection.dismissNotice(false)}
            className="border border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
          >
            {messages.understand}
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => protection.dismissNotice(true)}
            className="border border-violet-300/20 bg-violet-400/[0.08] text-violet-100 hover:bg-violet-400/[0.14]"
          >
            {messages.understandAndDontShow}
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => {
              protection.dismissNotice(false);
              onOpenSettings();
            }}
            className="bg-violet-500 text-white hover:bg-violet-400"
          >
            <Settings2 size={15} /> {messages.openSettings}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
