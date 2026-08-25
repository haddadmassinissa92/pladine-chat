"use client";

import { useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import ChatContainer from "@/components/ChatContainer";
import { useAuthStore } from "@/store/useAuthStore";
import { useChatStore } from "@/store/useChatStore";

export default function Home() {
  const { checkAuth, isCheckingAuth } = useAuthStore();
  const { selectedUser, selectedGroup } = useChatStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isCheckingAuth) {
    return (
      <div className="flex h-screen items-center justify-center">
        Chargement...
      </div>
    );
  }

  const hasSelection = selectedUser || selectedGroup;

  return (
    <div className="relative h-screen overflow-hidden sm:flex">
      <div
        className={`absolute inset-0 sm:relative sm:w-72 transition-transform duration-300 ease-in-out ${
          hasSelection ? "-translate-x-full sm:translate-x-0" : "translate-x-0"
        }`}
      >
        <Sidebar />
      </div>

      <div
        className={`absolute inset-0 sm:relative sm:flex-1 transition-transform duration-300 ease-in-out ${
          hasSelection ? "translate-x-0" : "translate-x-full sm:translate-x-0"
        }`}
      >
        <ChatContainer />
      </div>
    </div>
  );
}
