"use client";

import React from "react";
import { cn } from "@/lib/utils";

export const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "bp-card relative",
        className
      )}
    >
      <div className="bp-card-inner" />
      {children}
    </div>
  );
};

export const CardHeader = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("bp-card-header", className)}>
      {children}
    </div>
  );
};

export const CardTitle = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <h3 className={cn("bp-card-title", className)}>
      {children}
    </h3>
  );
};

export const CardContent = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return <div className={cn("", className)}>{children}</div>;
};

export const CardValue = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <p className={cn("bp-metric-value", className)}>
      {children}
    </p>
  );
};

export const CardLabel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <span className={cn("bp-metric-unit", className)}>{children}</span>
  );
};
