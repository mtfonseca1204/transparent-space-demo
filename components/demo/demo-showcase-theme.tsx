"use client";

import { useEffect } from "react";
import { DEMO_SPACE_SLUG } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

const DEMO_SHOWCASE_ATTR = "data-demo-showcase";

/**
 * Applies classic Blueprint light tokens to the Demo space only.
 * Forces light mode so the showcase sidebar and canvas stay on-brand.
 */
export function DemoShowcaseTheme() {
  const spaceSlug = useCurrentSpaceSlug();
  const isDemoShowcase = spaceSlug === DEMO_SPACE_SLUG;

  useEffect(() => {
    const root = document.documentElement;

    if (isDemoShowcase) {
      root.setAttribute(DEMO_SHOWCASE_ATTR, "");
      root.classList.remove("dark");
      return () => {
        root.removeAttribute(DEMO_SHOWCASE_ATTR);
      };
    }

    root.removeAttribute(DEMO_SHOWCASE_ATTR);
  }, [isDemoShowcase]);

  return null;
}
