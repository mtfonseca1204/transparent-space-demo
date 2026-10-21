"use client";

import React from "react";
import { cn } from "@/lib/utils";

export const OnboardingTasks = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-gray-100 p-4 md:p-5",
        className
      )}
    >
      {children}
    </div>
  );
};

export const OnboardingTitle = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <h3 className={cn("text-sm sm:text-base font-medium text-gray-900 mb-3 md:mb-4", className)}>
      {children}
    </h3>
  );
};

export const OnboardingProgress = ({
  current,
  total,
  className,
}: {
  current: number;
  total: number;
  className?: string;
}) => {
  const percentage = (current / total) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex justify-between text-sm">
        <span className="text-gray-500">Progress</span>
        <span className="text-gray-700 font-medium">
          {current}/{total} completed
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#1a1a2e] rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export const OnboardingList = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("space-y-3 mt-4", className)}>{children}</div>
  );
};

export const OnboardingItem = ({
  children,
  completed = false,
  className,
}: {
  children: React.ReactNode;
  completed?: boolean;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-colors",
        completed ? "bg-gray-50" : "bg-white border border-gray-100",
        className
      )}
    >
      <div
        className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
          completed ? "bg-green-500" : "border-2 border-gray-300"
        )}
      >
        {completed && (
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
      <span
        className={cn(
          "text-sm",
          completed ? "text-gray-400 line-through" : "text-gray-700"
        )}
      >
        {children}
      </span>
    </div>
  );
};

