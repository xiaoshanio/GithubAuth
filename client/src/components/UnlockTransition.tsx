import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCallback, useEffect, useRef, useState } from "react";

const LOGO = "./assets/github-vault-logo_fdf70cb3.png";

gsap.registerPlugin(useGSAP);

export default function UnlockTransition({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const { t } = useLanguage();
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    if (logoReady) return;
    const timeout = window.setTimeout(finish, 5_000);
    return () => window.clearTimeout(timeout);
  }, [finish, logoReady]);

  useGSAP(
    () => {
      if (!logoReady) return;

      try {
        const frameLeft = ".unlock-frame-left";
        const frameRight = ".unlock-frame-right";
        const frameTop = ".unlock-frame-top";
        const frameBottom = ".unlock-frame-bottom";
        const socket = ".unlock-lock-socket";
        const lockModule = ".unlock-lock-module";
        const shackle = ".unlock-lock-shackle";
        const finalLogo = ".unlock-final-logo";
        const shadow = ".unlock-ground-shadow";

        const showFinalState = () => {
          gsap.set(frameLeft, {
            autoAlpha: 1,
            xPercent: -55,
            yPercent: -47,
            rotation: -2.5,
            scale: 1,
          });
          gsap.set(frameRight, {
            autoAlpha: 1,
            xPercent: -45,
            yPercent: -51,
            rotation: 2,
            scale: 1,
          });
          gsap.set(frameTop, {
            autoAlpha: 1,
            xPercent: -50,
            yPercent: -57,
            rotation: -1.5,
            scale: 1,
          });
          gsap.set(frameBottom, {
            autoAlpha: 1,
            xPercent: -50,
            yPercent: -43,
            rotation: 1.5,
            scale: 1,
          });
          gsap.set([socket, lockModule], { autoAlpha: 0 });
          gsap.set(finalLogo, { autoAlpha: 1, scale: 1 });
          gsap.set(shadow, { opacity: 0.78, scaleX: 1.04 });
        };

        const media = gsap.matchMedia();
        media.add(
          {
            fullMotion: "(prefers-reduced-motion: no-preference)",
            reduceMotion: "(prefers-reduced-motion: reduce)",
          },
          context => {
            if (context.conditions?.reduceMotion) {
              showFinalState();
              const reducedMotionDelay = gsap.delayedCall(0.6, finish);
              return () => reducedMotionDelay.kill();
            }

            gsap.set(shackle, {
              x: 44,
              y: -52,
              rotation: 16,
              svgOrigin: "1060 960",
            });

            const timeline = gsap.timeline({
              repeat: 0,
              defaults: { ease: "power3.out" },
              onComplete: finish,
            });

            timeline
              .addLabel("frames", 0)
              .fromTo(
                frameLeft,
                {
                  autoAlpha: 0,
                  xPercent: -180,
                  yPercent: -47,
                  rotation: -7,
                  scale: 0.94,
                },
                {
                  autoAlpha: 1,
                  xPercent: -55,
                  yPercent: -47,
                  rotation: -2.5,
                  scale: 1,
                  duration: 0.8,
                },
                "frames"
              )
              .fromTo(
                frameRight,
                {
                  autoAlpha: 0,
                  xPercent: 120,
                  yPercent: -51,
                  rotation: 7,
                  scale: 0.94,
                },
                {
                  autoAlpha: 1,
                  xPercent: -45,
                  yPercent: -51,
                  rotation: 2,
                  scale: 1,
                  duration: 0.8,
                },
                "frames+=0.12"
              )
              .fromTo(
                frameTop,
                {
                  autoAlpha: 0,
                  xPercent: -50,
                  yPercent: -180,
                  rotation: -5,
                  scale: 0.94,
                },
                {
                  autoAlpha: 1,
                  xPercent: -50,
                  yPercent: -57,
                  rotation: -1.5,
                  scale: 1,
                  duration: 0.75,
                },
                "frames+=0.24"
              )
              .fromTo(
                frameBottom,
                {
                  autoAlpha: 0,
                  xPercent: -50,
                  yPercent: 120,
                  rotation: 5,
                  scale: 0.94,
                },
                {
                  autoAlpha: 1,
                  xPercent: -50,
                  yPercent: -43,
                  rotation: 1.5,
                  scale: 1,
                  duration: 0.75,
                },
                "frames+=0.36"
              )
              .to(
                shadow,
                { opacity: 0.54, scaleX: 0.92, duration: 0.9 },
                "frames+=0.18"
              )
              .fromTo(
                socket,
                { autoAlpha: 0, scale: 0.82 },
                {
                  autoAlpha: 1,
                  scale: 1,
                  duration: 0.25,
                  ease: "power2.out",
                },
                1
              )
              .addLabel("lockDrop", 1.3)
              .fromTo(
                lockModule,
                { autoAlpha: 0, yPercent: -135, scale: 0.96 },
                {
                  autoAlpha: 1,
                  yPercent: 0,
                  scale: 1,
                  duration: 0.8,
                  ease: "power3.inOut",
                },
                "lockDrop"
              )
              .addLabel("lockClose", 2.1)
              .to(
                shackle,
                {
                  x: 0,
                  y: 0,
                  rotation: 0,
                  duration: 0.4,
                  ease: "power2.inOut",
                },
                "lockClose"
              )
              .addLabel("embed", 2.5)
              .to(
                lockModule,
                {
                  y: 24,
                  scale: 0.92,
                  duration: 0.3,
                  ease: "power3.in",
                },
                "embed"
              )
              .to(
                socket,
                {
                  opacity: 0.72,
                  scale: 0.92,
                  duration: 0.3,
                  ease: "power3.in",
                },
                "embed"
              )
              .to(
                shadow,
                {
                  opacity: 0.78,
                  scaleX: 1.04,
                  duration: 0.3,
                  ease: "power2.in",
                },
                "embed"
              )
              .addLabel("resolve", 2.8)
              .to(
                [socket, lockModule],
                {
                  autoAlpha: 0,
                  duration: 0.25,
                  ease: "power1.inOut",
                },
                "resolve"
              )
              .fromTo(
                finalLogo,
                { autoAlpha: 0, scale: 0.992 },
                {
                  autoAlpha: 1,
                  scale: 1,
                  duration: 0.25,
                  ease: "power1.inOut",
                },
                "resolve"
              )
              .to({}, { duration: 1.2 });

            return () => timeline.kill();
          }
        );

        return () => media.revert();
      } catch {
        finish();
      }
    },
    { scope: root, dependencies: [finish, logoReady] }
  );

  return (
    <main
      ref={root}
      role="status"
      aria-label={t.app.unlocking}
      className="screen-fill relative grid place-items-center overflow-hidden bg-[#17181d]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
      }}
    >
      <div
        aria-hidden="true"
        className="relative aspect-square w-[min(88vmin,780px)] drop-shadow-[0_34px_38px_rgba(0,0,0,0.42)] [transform:translateZ(0)]"
      >
        <div className="unlock-frame-left invisible absolute left-1/2 top-1/2 z-[1] h-[76%] w-[76%] rounded-[13%] border-[3px] border-violet-300/35 bg-violet-600/[0.075] opacity-0 shadow-[inset_0_0_38px_rgba(147,71,231,0.045),0_18px_36px_rgba(0,0,0,0.18)] will-change-transform" />
        <div className="unlock-frame-right invisible absolute left-1/2 top-1/2 z-[2] h-[81%] w-[81%] rounded-[13%] border-[3px] border-white/15 bg-[#111116]/75 opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_22px_42px_rgba(0,0,0,0.26)] will-change-transform" />
        <div className="unlock-frame-top invisible absolute left-1/2 top-1/2 z-[3] h-[73%] w-[73%] rounded-[12.5%] border-[3px] border-[#979aa8]/25 bg-[#23242b]/30 opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_16px_34px_rgba(0,0,0,0.18)] will-change-transform" />
        <div className="unlock-frame-bottom invisible absolute left-1/2 top-1/2 z-[4] h-[78%] w-[78%] rounded-[13%] border-[3px] border-[#9953d8]/25 bg-[#2b1b37]/15 opacity-0 shadow-[inset_0_0_30px_rgba(158,75,232,0.035),0_18px_34px_rgba(0,0,0,0.2)] will-change-transform" />

        <div className="unlock-ground-shadow absolute bottom-[11%] left-[22%] right-[18%] z-0 h-[7%] scale-x-[0.58] rounded-[50%] bg-black/50 opacity-[0.22] blur-[20px] will-change-transform" />
        <div className="unlock-lock-socket invisible absolute left-[35%] top-[38%] z-[5] h-[37%] w-[30%] scale-[0.82] bg-[#0d0e13] opacity-0 shadow-[inset_8px_10px_16px_rgba(255,255,255,0.025),inset_-12px_-14px_20px_rgba(0,0,0,0.46),0_0_0_8px_rgba(8,9,13,0.28)] [clip-path:polygon(22%_0,78%_0,100%_22%,100%_80%,80%_100%,20%_100%,0_80%,0_22%)] will-change-transform" />

        <div className="unlock-lock-module invisible absolute inset-0 z-[6] opacity-0 will-change-transform">
          <svg
            className="absolute inset-0 h-full w-full overflow-visible drop-shadow-[0_17px_13px_rgba(0,0,0,0.45)]"
            viewBox="0 0 1920 1920"
          >
            <defs>
              <clipPath
                id="unlock-lock-body-clip"
                clipPathUnits="userSpaceOnUse"
              >
                <path d="M 725 919 L 813 975 L 1063 975 L 1163 1025 L 1163 1273 L 1081 1398 L 763 1398 L 645 1270 L 645 988 Z" />
              </clipPath>
              <clipPath
                id="unlock-lock-shackle-clip"
                clipPathUnits="userSpaceOnUse"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M 748 963 L 748 800 C 748 735 813 693 908 693 C 1005 693 1068 740 1068 808 L 1068 963 Z M 813 963 L 813 826 C 813 776 853 748 908 748 C 964 748 1005 783 1005 835 L 1005 963 Z"
                />
              </clipPath>
            </defs>
            <g
              className="unlock-lock-shackle will-change-transform [transform-box:fill-box]"
              clipPath="url(#unlock-lock-shackle-clip)"
            >
              <image href={LOGO} width="1920" height="1920" />
            </g>
            <g clipPath="url(#unlock-lock-body-clip)">
              <image href={LOGO} width="1920" height="1920" />
            </g>
          </svg>
        </div>

        <img
          src={LOGO}
          alt=""
          onLoad={() => setLogoReady(true)}
          onError={finish}
          className="unlock-final-logo invisible absolute inset-0 z-[7] h-full w-full select-none object-contain opacity-0 will-change-transform"
        />
      </div>
    </main>
  );
}
