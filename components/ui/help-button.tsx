"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { HelpModal, type HelpSectionData } from "./help-modal";

export type { HelpSectionData };

interface HelpButtonProps {
  title: string;
  sections: HelpSectionData[];
  className?: string;
  /** The term the help is attached to. Rendered with a dotted underline; clicking opens the definition. */
  children?: React.ReactNode;
}

export const HelpButton: React.FC<HelpButtonProps> = ({
  title,
  sections,
  className,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(true);
        }}
        className={cn(
          "ts-term inline bg-transparent border-0 p-0 m-0",
          "font-[inherit] text-inherit text-left",
          className
        )}
        aria-label={`What is ${title}?`}
        title={`What is ${title}?`}
      >
        {children ?? title}
      </button>

      <HelpModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={title}
        sections={sections}
      />
    </>
  );
};

export default HelpButton;
