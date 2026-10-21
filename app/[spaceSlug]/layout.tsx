import { DemoShowcaseTheme } from "@/components/demo/demo-showcase-theme";

export default function SpaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DemoShowcaseTheme />
      {children}
    </>
  );
}
