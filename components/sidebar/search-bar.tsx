"use client";

import React from "react";
import { SearchIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "../ui/input";
import { useSidebarStore } from "@/stores/sidebar-store";

export const SearchBar = ({
  value,
  onChange,
  placeholder = "Search pools",
}: {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
}) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <div className="flex justify-center mt-12">
      <motion.div
        className="relative flex h-[40px] items-center bg-gray-200 rounded-md justify-center"
        animate={{
          width: isOpen ? "100%" : 40,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <SearchIcon
          className={`w-5 h-5 text-black shrink-0 ${isOpen ? "absolute left-3" : ""}`}
        />
        {isOpen && (
          <Input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-[40px] pl-10 bg-transparent border-none shadow-none ring-0 outline-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:border-none placeholder:text-black/50"
          />
        )}
      </motion.div>
    </div>
  );
};
