"use client";

import React from "react";
import { BarChart3, LucideBell } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/sidebar-store";

export const Menu = ({ children }: { children: React.ReactNode }) => {
  return <nav className="mt-8 space-y-2">{children}</nav>;
};

export const Text = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <motion.h2
      className={cn("text-lg font-semibold mb-4 text-gray-800 whitespace-nowrap", className)}
      animate={{
        opacity: isOpen ? 1 : 0,
        height: isOpen ? "auto" : 0,
        marginBottom: isOpen ? 16 : 0,
      }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.h2>
  );
};

export const MenuItem = ({
  children,
  className,
  onClick,
  isActive,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  isActive?: boolean;
}) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <div
      className={cn(
        "flex items-center py-2 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors",
        isActive ? "bg-gray-100" : "",
        isOpen ? "px-0 justify-start" : "px-0 justify-center",
        className
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      {children}
    </div>
  );
};

export const MenuIcon = ({ children }: { children: React.ReactNode }) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <div
      className={cn(
        "flex items-center justify-center shrink-0",
        isOpen ? "mr-3" : "mr-0"
      )}
    >
      {children}
    </div>
  );
};

export const MenuTitle = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <motion.span
      className={cn("text-md font-medium text-gray-700 whitespace-nowrap overflow-hidden", className)}
      animate={{
        opacity: isOpen ? 1 : 0,
        width: isOpen ? "auto" : 0,
      }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.span>
  );
};

export const AnalyticsIcon = () => {
  return <BarChart3 className="w-5 h-5 text-gray-600" />;
};

export const BellIcon = () => {
  return <LucideBell className="w-5 h-5 text-gray-600" />;
};
