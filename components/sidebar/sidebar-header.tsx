"use client";

import React from "react";
import { motion } from "framer-motion";
import { useSidebarStore } from "@/stores/sidebar-store";

export const SidebarHeader = ({ children }: { children: React.ReactNode }) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <div
      className={`flex w-full h-[50px] ${
        isOpen ? "justify-start" : "justify-center"
      }`}
    >
      {children}
    </div>
  );
};

export const SidebarTitle = ({ children }: { children: React.ReactNode }) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <motion.h1
      className="text-2xl font-medium whitespace-nowrap overflow-hidden"
      animate={{
        opacity: isOpen ? 1 : 0,
        width: isOpen ? "auto" : 0,
      }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.h1>
  );
};

export const SidebarDescription = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <motion.p
      className="text-sm font-thin text-muted-foreground whitespace-nowrap overflow-hidden"
      animate={{
        opacity: isOpen ? 1 : 0,
        width: isOpen ? "auto" : 0,
      }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.p>
  );
};
