"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, Plus, Trash2, Loader2, Users, Mail, Lock, KeyRound, AlertCircle, Shield, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import { useAuthStore } from "@/lib/auth-store";

interface SpaceMember {
  id: string;
  email: string;
  space_id: string;
  created_at: string;
  spaces?: { name: string; slug: string };
}

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
}

export const AdminPanel = ({ onClose }: { onClose: () => void }) => {
  const email = useAuthStore((s) => s.email);
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);

  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(
    currentSpaceId || spaces[0]?.id || ""
  );
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add member form
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Admin users state
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(true);
  const [adminSectionOpen, setAdminSectionOpen] = useState(false);

  // Reset password state
  const [resettingEmail, setResettingEmail] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const selectedSpace = spaces.find((s) => s.id === selectedSpaceId);

  const fetchMembers = useCallback(async () => {
    if (!selectedSpaceId) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/admin/members?spaceId=${encodeURIComponent(selectedSpaceId)}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to fetch members");
        return;
      }

      setMembers(data.members || []);
    } catch {
      setError("Failed to connect to server");
    } finally {
      setIsLoading(false);
    }
  }, [selectedSpaceId]);

  const fetchAdmins = useCallback(async () => {
    setIsLoadingAdmins(true);
    try {
      const res = await fetch("/api/admin/admins");
      const data = await res.json();
      if (res.ok) {
        setAdminUsers(data.admins || []);
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoadingAdmins(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword || !selectedSpaceId) return;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setAddError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          spaceId: selectedSpaceId,
          password: newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || "Failed to add member");
        return;
      }

      setNewEmail("");
      setNewPassword("");
      fetchMembers();
    } catch {
      setAddError("Failed to connect to server");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveMember = async (memberEmail: string) => {
    if (!selectedSpaceId) return;

    setDeletingId(memberEmail);

    try {
      const res = await fetch("/api/admin/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: memberEmail,
          spaceId: selectedSpaceId,
        }),
      });

      if (res.ok) {
        fetchMembers();
      }
    } catch {
      // Silently fail
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetPassword = async (targetEmail: string) => {
    if (!resetPassword) return;

    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setIsResetting(true);
    setResetError(null);
    setResetSuccess(null);

    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEmail,
          newPassword: resetPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResetError(data.error || "Failed to reset password");
        return;
      }

      setResetSuccess(`Password reset for ${targetEmail}`);
      setResetPassword("");
      setTimeout(() => {
        setResettingEmail(null);
        setResetSuccess(null);
      }, 2000);
    } catch {
      setResetError("Failed to connect to server");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="admin-backdrop"
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[100]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        key="admin-panel"
        className={cn(
          "fixed right-0 top-0 h-full w-full max-w-lg z-[101]",
          "bg-white dark:bg-[#1a1a2e] shadow-2xl",
          "border-l border-gray-200/30 dark:border-gray-700/20",
          "flex flex-col"
        )}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200/30 dark:border-gray-700/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center rounded-lg">
              <Users className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Admin Panel
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Manage space members
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Space selector */}
        {spaces.length > 1 && (
          <div className="px-6 py-3 border-b border-gray-200/30 dark:border-gray-700/20">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
              Space
            </label>
            <select
              value={selectedSpaceId}
              onChange={(e) => setSelectedSpaceId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/30 rounded-lg text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-gray-400/30"
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Current space info */}
        <div className="px-6 py-3 bg-gray-50/50 dark:bg-gray-800/20 border-b border-gray-200/30 dark:border-gray-700/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {selectedSpace?.name || "Select a space"}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {members.length} member{members.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Add member form */}
        <form
          onSubmit={handleAddMember}
          className="px-6 py-4 border-b border-gray-200/30 dark:border-gray-700/20"
        >
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">
            Add Member
          </label>
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                autoComplete="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  setAddError(null);
                }}
                disabled={isAdding}
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/30 rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-50"
                required
              />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={`Temporary password (min ${MIN_PASSWORD_LENGTH} chars)`}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setAddError(null);
                  }}
                  disabled={isAdding}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/30 rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-50"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </div>
              <button
                type="submit"
                disabled={isAdding || !newEmail.trim() || !newPassword}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer",
                  "bg-gray-900 hover:bg-gray-800 text-white",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "flex items-center gap-1.5"
                )}
              >
                {isAdding ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add
              </button>
            </div>
          </div>
          {addError && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {addError}
            </div>
          )}
        </form>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Admin Users section */}
          <div className="border-b border-gray-200/30 dark:border-gray-700/20">
            <button
              onClick={() => setAdminSectionOpen(!adminSectionOpen)}
              className="w-full flex items-center justify-between px-6 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Admin Users
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {adminUsers.length}
                </span>
              </div>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-gray-400 transition-transform",
                  adminSectionOpen && "rotate-180"
                )}
              />
            </button>

            {adminSectionOpen && (
              <div className="divide-y divide-gray-200/30 dark:divide-gray-700/20">
                {isLoadingAdmins ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                  </div>
                ) : (
                  adminUsers.map((admin) => (
                    <div key={admin.id}>
                      <div className="flex items-center justify-between px-6 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center rounded-full text-xs font-medium text-purple-600 dark:text-purple-400 shrink-0">
                            {admin.email.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm text-gray-900 dark:text-white truncate">
                                {admin.email}
                              </p>
                              {admin.email === email && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full font-medium">
                                  you
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                              Admin since{" "}
                              {new Date(admin.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setResettingEmail(
                              resettingEmail === admin.email
                                ? null
                                : admin.email
                            );
                            setResetPassword("");
                            setResetError(null);
                            setResetSuccess(null);
                          }}
                          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors cursor-pointer shrink-0"
                          title="Reset password"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Inline reset password form */}
                      {resettingEmail === admin.email && (
                        <div className="px-6 pb-3">
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                              <input
                                type="password"
                                autoComplete="new-password"
                                placeholder={`New password (min ${MIN_PASSWORD_LENGTH} chars)`}
                                value={resetPassword}
                                onChange={(e) => {
                                  setResetPassword(e.target.value);
                                  setResetError(null);
                                }}
                                disabled={isResetting}
                                className="w-full pl-8 pr-3 py-2 text-xs bg-white dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/30 rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-50"
                                minLength={MIN_PASSWORD_LENGTH}
                              />
                            </div>
                            <button
                              onClick={() => handleResetPassword(admin.email)}
                              disabled={isResetting || !resetPassword}
                              className={cn(
                                "px-3 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer",
                                "bg-amber-500 hover:bg-amber-600 text-white",
                                "disabled:opacity-50 disabled:cursor-not-allowed",
                                "flex items-center gap-1"
                              )}
                            >
                              {isResetting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                "Reset"
                              )}
                            </button>
                          </div>
                          {resetError && (
                            <p className="text-xs text-red-500 mt-1">
                              {resetError}
                            </p>
                          )}
                          {resetSuccess && (
                            <p className="text-xs text-green-500 mt-1">
                              {resetSuccess}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Members list */}
          <div>
            <div className="px-6 py-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Space Members
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {members.length}
                </span>
              </div>
            </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Users className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No members whitelisted yet
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Add an email and password above to whitelist a user
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200/30 dark:divide-gray-700/20">
              {members.map((member) => (
                <div key={member.id}>
                  <div className="flex items-center justify-between px-6 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 flex items-center justify-center rounded-full text-xs font-medium text-gray-600 dark:text-gray-400 shrink-0">
                        {member.email.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white truncate">
                          {member.email}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                          Added {new Date(member.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setResettingEmail(
                            resettingEmail === member.email ? null : member.email
                          );
                          setResetPassword("");
                          setResetError(null);
                          setResetSuccess(null);
                        }}
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors cursor-pointer"
                        title="Reset password"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveMember(member.email)}
                        disabled={deletingId === member.email}
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                        title="Remove member"
                      >
                        {deletingId === member.email ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Inline reset password form */}
                  {resettingEmail === member.email && (
                    <div className="px-6 pb-3">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder={`New password (min ${MIN_PASSWORD_LENGTH} chars)`}
                            value={resetPassword}
                            onChange={(e) => {
                              setResetPassword(e.target.value);
                              setResetError(null);
                            }}
                            disabled={isResetting}
                            className="w-full pl-8 pr-3 py-2 text-xs bg-white dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/30 rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-50"
                            minLength={MIN_PASSWORD_LENGTH}
                          />
                        </div>
                        <button
                          onClick={() => handleResetPassword(member.email)}
                          disabled={isResetting || !resetPassword}
                          className={cn(
                            "px-3 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer",
                            "bg-amber-500 hover:bg-amber-600 text-white",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            "flex items-center gap-1"
                          )}
                        >
                          {isResetting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            "Reset"
                          )}
                        </button>
                      </div>
                      {resetError && (
                        <p className="text-xs text-red-500 mt-1">{resetError}</p>
                      )}
                      {resetSuccess && (
                        <p className="text-xs text-green-500 mt-1">{resetSuccess}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
