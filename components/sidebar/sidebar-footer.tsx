"use client";

import React from "react";
import { LogOutIcon, User } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../ui/button";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/auth-store";

export const SidebarFooter = ({ children }: { children: React.ReactNode }) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <div
      className={`absolute bottom-4 left-4 right-4 flex items-center p-3 rounded-lg ${
        isOpen ? "justify-start" : "justify-center"
      }`}
    >
      {children}
    </div>
  );
};

export const ProfilePicture = () => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <div
      className={`w-10 h-10 rounded-full overflow-hidden shrink-0 bg-gray-200 flex items-center justify-center ${
        isOpen ? "mr-3" : "mr-0"
      }`}
    >
      <User className="w-6 h-6 text-gray-500" />
    </div>
  );
};

export const UserInfo = ({ children }: { children: React.ReactNode }) => {
  const isOpen = useSidebarStore((state) => state.isOpen);

  return (
    <motion.div
      className="flex flex-col flex-1 overflow-hidden"
      animate={{
        opacity: isOpen ? 1 : 0,
        width: isOpen ? "auto" : 0,
      }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  );
};

export const UserName = ({ children }: { children: React.ReactNode }) => {
  return (
    <span className="text-lg font-medium text-gray-800 whitespace-nowrap">
      {children}
    </span>
  );
};

export const UserEmail = ({ children }: { children: React.ReactNode }) => {
  return (
    <span className="text-[10px] text-gray-500 whitespace-nowrap">
      {children}
    </span>
  );
};

export const LogoutButton = () => {
  const isOpen = useSidebarStore((state) => state.isOpen);
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = () => {
    logout();
  };

  return (
    <motion.div
      animate={{
        opacity: isOpen ? 1 : 0,
        width: isOpen ? "auto" : 0,
      }}
      transition={{ duration: 0.2 }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="w-8 h-8 p-0 hover:bg-gray-200"
        onClick={handleLogout}
        title="Logout"
      >
        <LogOutIcon className="w-4 h-4 text-gray-600" />
      </Button>
    </motion.div>
  );
};
