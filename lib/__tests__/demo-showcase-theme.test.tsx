// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoShowcaseTheme } from "./demo-showcase-theme";

const mockUseCurrentSpaceSlug = vi.hoisted(() => vi.fn<[], string | null>());

vi.mock("@/hooks/use-current-space-slug", () => ({
  useCurrentSpaceSlug: () => mockUseCurrentSpaceSlug(),
}));

describe("DemoShowcaseTheme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-demo-showcase");
    document.documentElement.classList.remove("dark");
    mockUseCurrentSpaceSlug.mockReset();
  });

  it("sets demo showcase attribute and removes dark mode on demo space", () => {
    document.documentElement.classList.add("dark");
    mockUseCurrentSpaceSlug.mockReturnValue("demo");

    const { unmount } = render(<DemoShowcaseTheme />);

    expect(document.documentElement.getAttribute("data-demo-showcase")).toBe("");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    unmount();
    expect(document.documentElement.hasAttribute("data-demo-showcase")).toBe(false);
  });

  it("does not set demo showcase attribute on other spaces", () => {
    mockUseCurrentSpaceSlug.mockReturnValue("kraken");

    render(<DemoShowcaseTheme />);

    expect(document.documentElement.hasAttribute("data-demo-showcase")).toBe(false);
  });
});
