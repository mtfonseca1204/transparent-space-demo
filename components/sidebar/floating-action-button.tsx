"use client";

import React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "../ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useSidebarStore } from "@/stores/sidebar-store";

export const FloatingActionButton = () => {
  const { isOpen, toggle } = useSidebarStore();

  return (
    <motion.div
      className="absolute top-[25px] z-20"
      animate={{
        left: isOpen ? 295 : 85,
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <Button
        className="w-10 h-10 rounded-full shadow-lg"
        onClick={toggle}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <PanelLeftClose className="w-5 h-5" />
            </motion.div>
          ) : (
            <motion.div
              key="open"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <PanelLeftOpen className="w-5 h-5" />
            </motion.div>
          )}
        </AnimatePresence>
      </Button>
    </motion.div>
  );
};
