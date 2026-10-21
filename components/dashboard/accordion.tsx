"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export const Accordion = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("bp-card !p-0 overflow-hidden", className)}>
      <div className="bp-card-inner" />
      {children}
    </div>
  );
};

export const AccordionItem = ({
  children,
  defaultOpen = false,
  className,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("border-b border-[var(--bp-border-subtle)] last:border-b-0", className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<{ isOpen?: boolean; onToggle?: () => void }>, {
            isOpen,
            onToggle: () => setIsOpen(!isOpen),
          });
        }
        return child;
      })}
    </div>
  );
};

export const AccordionTrigger = ({
  children,
  isOpen,
  onToggle,
  className,
}: {
  children: React.ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  className?: string;
}) => {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "bp-accordion-trigger flex items-center justify-between w-full text-left",
        "hover:bg-[var(--bp-accent-glow)]",
        isOpen && "bg-[var(--bp-accent-glow)]",
        className
      )}
    >
      <span>{children}</span>
      <motion.div
        animate={{ rotate: isOpen ? 180 : 0 }}
        transition={{ duration: 0.2 }}
      >
        <ChevronDown className="w-4 h-4 text-[var(--bp-text-muted)]" />
      </motion.div>
    </button>
  );
};

export const AccordionContent = ({
  children,
  isOpen,
  className,
}: {
  children: React.ReactNode;
  isOpen?: boolean;
  className?: string;
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className={cn("bp-accordion-content", className)}>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
