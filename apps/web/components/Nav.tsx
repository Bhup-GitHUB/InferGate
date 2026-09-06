"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/playground", label: "Playground" },
  { href: "/activity", label: "Activity" },
  { href: "/routing", label: "Routing" },
  { href: "/models", label: "Models" },
  { href: "/fleet", label: "GPU Fleet" },
  { href: "/keys", label: "API Keys" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/audit", label: "Audit" },
  { href: "/billing", label: "Billing" },
];

export function Nav(): React.ReactElement {
  const path = usePathname();
  return (
    <>
      <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-edge bg-panel/95 px-3 py-2 backdrop-blur lg:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              path === l.href
                ? "shrink-0 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-sm font-medium text-white"
                : "shrink-0 rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-fog"
            }
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-2 border-r border-edge bg-panel/90 px-5 py-7 backdrop-blur lg:flex">
      <div className="mb-7 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-acid to-ice text-lg font-black text-void shadow-[0_0_24px_rgba(200,255,46,0.45)]">
          I
        </div>
        <div>
          <div className="text-[17px] font-extrabold tracking-wide">InferGate</div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-fog">AI Gateway</div>
        </div>
      </div>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={
            path === l.href
              ? "flex items-center gap-3 rounded-xl border border-edge bg-panel2 px-3.5 py-2.5 text-sm font-medium text-white"
              : "flex items-center gap-3 rounded-xl border border-transparent px-3.5 py-2.5 text-sm font-medium text-fog transition hover:bg-panel2 hover:text-white"
          }
        >
          <span className={path === l.href ? "h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_10px_#c8ff2e]" : "h-1.5 w-1.5 rounded-full bg-[#3a3a42]"} />
          {l.label}
        </Link>
      ))}
      <div className="mt-auto rounded-xl border border-edge bg-panel p-3.5">
        <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-fog">Gateway status</div>
        <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-[#131318] px-3 py-1 text-xs font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_#c8ff2e]" />
          <span className="font-mono">operational</span>
        </div>
      </div>
      </aside>
    </>
  );
}
