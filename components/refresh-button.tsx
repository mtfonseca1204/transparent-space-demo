"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

export function RefreshButton() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Invalidate all queries to force a refetch
      await queryClient.invalidateQueries();
      // Optional: Add a small delay so the spinner is visible
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
      title="Refresh all data"
    >
      <RefreshCw
        className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
      />
      <span className="text-sm">Refresh</span>
    </button>
  );
}
