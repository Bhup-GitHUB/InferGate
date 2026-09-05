"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/playground", label: "Playground" },
  { href: "/models", label: "Models" },
  { href: "/keys", label: "API Keys" },
  { href: "/billing", label: "Billing" },
];

export function Nav(): React.ReactElement {
  const path = usePathname();
  return (
    <aside className="nav">
      <div className="brand">
        <div className="brand-mark">I</div>
        <div>
          <div className="brand-name">InferGate</div>
          <div className="brand-sub">AI Gateway</div>
        </div>
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "nav-link active" : "nav-link"}>
          <span className="nav-dot" />
          {l.label}
        </Link>
      ))}
      <div className="nav-foot">
        <div className="card-title">Gateway status</div>
        <div className="pill">
          <span className="dot dot-ok" />
          <span className="mono">operational</span>
        </div>
      </div>
    </aside>
  );
}
