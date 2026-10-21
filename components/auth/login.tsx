"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, Lock, Loader2, AlertCircle, ChevronRight, ArrowLeft } from "lucide-react";
import type { Space } from "@/lib/auth-store";

// ============================================================================
// COMPOSABLE COMPONENTS
// ============================================================================

// Root container - full screen centered layout
export const LoginContainer = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "min-h-screen bg-gray-50 flex items-center justify-center p-4",
        className
      )}
    >
      {children}
    </div>
  );
};

// White card container
export const LoginCard = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-gray-100 p-8 md:p-10 w-full max-w-md shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
};

// Logo container
export const LoginLogo = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <div className={cn("flex justify-center mb-8", className)}>
      <svg
        width="140"
        height="140"
        viewBox="0 0 64 64"
        fill="none"
        stroke="#0A0906"
        strokeWidth="1.5"
        shapeRendering="geometricPrecision"
        aria-label="Transparent.space"
      >
        <rect x="16.75" y="4.75" width="43.25" height="43.25" />
        <rect x="10.75" y="10.75" width="43.25" height="43.25" />
        <rect x="4.75" y="16.75" width="43.25" height="43.25" />
      </svg>
    </div>
  );
};

// Heading
export const LoginHeading = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <h1
      className={cn(
        "text-xl md:text-2xl font-normal text-gray-800 text-center mb-8",
        className
      )}
    >
      {children}
    </h1>
  );
};

// Form wrapper
export const LoginForm = ({
  children,
  onSubmit,
  className,
}: {
  children: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  className?: string;
}) => {
  return (
    <form
      onSubmit={onSubmit}
      className={cn("flex flex-col gap-6", className)}
    >
      {children}
    </form>
  );
};

// Email input wrapper with icon
export const LoginInputWrapper = ({
  value,
  onChange,
  placeholder = "Email Address",
  disabled,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) => {
  return (
    <div className={cn("relative", className)}>
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
        <Mail className="w-5 h-5" />
      </div>
      <Input
        type="email"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="email"
        className="pl-10 h-12 text-base"
        required
      />
    </div>
  );
};

// Password input wrapper with icon
export const PasswordInputWrapper = ({
  value,
  onChange,
  placeholder = "Password",
  disabled,
  autoComplete = "current-password",
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
}) => {
  return (
    <div className={cn("relative", className)}>
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
        <Lock className="w-5 h-5" />
      </div>
      <Input
        type="password"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        className="pl-10 h-12 text-base"
        required
      />
    </div>
  );
};

// Login button
export const LoginButton = ({
  children,
  disabled,
  isLoading,
  className,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}) => {
  return (
    <Button
      type="submit"
      disabled={disabled || isLoading}
      className={cn(
        "w-full h-12 text-base font-medium bg-gray-500 hover:bg-gray-600 text-white",
        className
      )}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verifying...
        </span>
      ) : (
        children
      )}
    </Button>
  );
};

// Error message
export const LoginError = ({
  message,
  className,
}: {
  message: string | null;
  className?: string;
}) => {
  if (!message) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3",
        className
      )}
    >
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
};

// ============================================================================
// SPACE SELECTOR (shown after email verification for admins)
// ============================================================================

const SpaceSelector = ({
  spaces,
  onSelectSpace,
  onBack,
  email,
}: {
  spaces: Space[];
  onSelectSpace: (spaceId: string) => void;
  onBack: () => void;
  email: string | null;
}) => {
  return (
    <LoginContainer>
      <LoginCard>
        <LoginLogo />
        <LoginHeading>Select a Space</LoginHeading>

        {email && (
          <p className="text-sm text-gray-500 text-center -mt-4 mb-6">
            Logged in as <span className="font-medium text-gray-700">{email}</span>
          </p>
        )}

        <div className="flex flex-col gap-2 max-h-[232px] overflow-y-auto pr-1">
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              onClick={() => onSelectSpace(space.id)}
              className={cn(
                "flex items-center gap-4 w-full px-4 py-4 shrink-0",
                "bg-white border border-gray-200 rounded-lg",
                "hover:border-gray-300 hover:bg-gray-50",
                "transition-all duration-150 cursor-pointer",
                "text-left group"
              )}
            >
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                {space.logo_url ? (
                  <img
                    src={space.logo_url}
                    alt={`${space.name} logo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-base font-semibold text-gray-600">
                    {space.name.charAt(0)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {space.name}
                </div>
                {space.description && (
                  <div className="text-xs text-gray-500 truncate">
                    {space.description}
                  </div>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors shrink-0" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 mt-6 text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer mx-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to login
        </button>
      </LoginCard>
    </LoginContainer>
  );
};

// ============================================================================
// CHANGE PASSWORD SCREEN (shown when must_change_password is true)
// ============================================================================

const ChangePasswordScreen = ({
  email,
  tempPassword,
  onChangePassword,
  onBack,
  isLoading,
  error,
}: {
  email: string | null;
  tempPassword: string | null;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onBack: () => void;
  isLoading?: boolean;
  error?: string | null;
}) => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [localLoading, setLocalLoading] = useState(false);

  const loading = isLoading || localLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }

    if (!tempPassword) {
      setLocalError("Session expired. Please log in again.");
      return;
    }

    setLocalLoading(true);
    try {
      await onChangePassword(tempPassword, newPassword);
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <LoginContainer>
      <LoginCard>
        <LoginLogo />
        <LoginHeading>Change Your Password</LoginHeading>

        {email && (
          <p className="text-sm text-gray-500 text-center -mt-4 mb-6">
            You must set a new password for{" "}
            <span className="font-medium text-gray-700">{email}</span>
          </p>
        )}

        <LoginForm onSubmit={handleSubmit}>
          <PasswordInputWrapper
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New Password"
            disabled={loading}
            autoComplete="new-password"
          />
          <PasswordInputWrapper
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm New Password"
            disabled={loading}
            autoComplete="new-password"
          />
          <LoginError message={localError || error || null} />
          <LoginButton isLoading={loading}>Set New Password</LoginButton>
        </LoginForm>

        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 mt-6 text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer mx-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to login
        </button>
      </LoginCard>
    </LoginContainer>
  );
};

// ============================================================================
// CONVENIENCE COMPONENT
// ============================================================================

export const LoginScreen = ({
  onLogin,
  isLoading: externalLoading,
  error: externalError,
  needsSpaceSelection,
  mustChangePassword,
  tempPassword,
  spaces,
  email: currentEmail,
  onSelectSpace,
  onChangePassword,
  onBack,
  className,
}: {
  onLogin: (email: string, password: string) => Promise<boolean> | void;
  isLoading?: boolean;
  error?: string | null;
  needsSpaceSelection?: boolean;
  mustChangePassword?: boolean;
  tempPassword?: string | null;
  spaces?: Space[];
  email?: string | null;
  onSelectSpace?: (spaceId: string) => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onBack?: () => void;
  className?: string;
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localLoading, setLocalLoading] = useState(false);

  const isLoading = externalLoading || localLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && password && !isLoading) {
      setLocalLoading(true);
      try {
        await onLogin(email, password);
      } finally {
        setLocalLoading(false);
      }
    }
  };

  // Step 3: Change password (must_change_password)
  if (mustChangePassword && onChangePassword) {
    return (
      <ChangePasswordScreen
        email={currentEmail || null}
        tempPassword={tempPassword || null}
        onChangePassword={onChangePassword}
        onBack={onBack || (() => {})}
        isLoading={externalLoading}
        error={externalError}
      />
    );
  }

  // Step 2: Space selection for admins
  if (needsSpaceSelection && spaces && spaces.length > 0 && onSelectSpace) {
    return (
      <SpaceSelector
        spaces={spaces}
        onSelectSpace={onSelectSpace}
        onBack={onBack || (() => {})}
        email={currentEmail || null}
      />
    );
  }

  // Step 1: Email + password entry
  return (
    <LoginContainer className={className}>
      <LoginCard>
        <LoginLogo />
        <LoginHeading>Welcome to Transparent.space</LoginHeading>
        <LoginForm onSubmit={handleSubmit}>
          <LoginInputWrapper
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email Address"
            disabled={isLoading}
          />
          <PasswordInputWrapper
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isLoading}
          />
          <LoginError message={externalError || null} />
          <LoginButton isLoading={isLoading}>Login</LoginButton>
        </LoginForm>
      </LoginCard>
    </LoginContainer>
  );
};
