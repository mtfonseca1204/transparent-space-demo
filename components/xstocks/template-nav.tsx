"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./template-nav.module.css";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/xstocks", label: "Weekend Movers" },
  { href: "/xstocks/earnings", label: "Overnight Tape" },
];

export function TemplateNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Template">
      {LINKS.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={styles.link}
            data-active={isActive ? "1" : "0"}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
