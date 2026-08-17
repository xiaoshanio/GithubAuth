/* Visual direction: “加密索引库” — protected core layered over two offset account-index records. */
const LOGO = "./assets/github-vault-logo_fdf70cb3.png";

export default function VaultMark({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <span className={`relative grid shrink-0 place-items-center ${className}`} aria-hidden="true">
      <i className="absolute h-[78%] w-[78%] -translate-x-1.5 translate-y-1.5 rounded-[.6rem] border border-violet-300/20 bg-violet-500/[0.05]" />
      <i className="absolute h-[84%] w-[84%] translate-x-1 translate-y-0.5 rounded-[.65rem] border border-white/[0.11] bg-[#111116]" />
      <img src={LOGO} className="relative h-full w-full rounded-xl" alt="" />
    </span>
  );
}
