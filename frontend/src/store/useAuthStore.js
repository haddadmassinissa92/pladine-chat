// store/useAuthStore.js

// importation des bibliothèques nécessaires
import { create } from "zustand";
import { axiosInstance } from "@/lib/axios";
import { io } from "socket.io-client";

// Définition de l'URL du socket à partir des variables d'environnement
const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL;

// Création du store d'authentification avec Zustand
export const useAuthStore = create((set, get) => ({
  authUser: null,
  isCheckingAuth: true,
  socket: null,
  onlineUsers: [],

  // Fonction pour vérifier l'authentification de l'utilisateur
  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/me");
      set({ authUser: res.data, isCheckingAuth: false });
      get().connectSocket();
    } catch {
      set({ authUser: null, isCheckingAuth: false });
    }
  },

  // Fonction pour inscrire un nouvel utilisateur
  signup: async (data) => {
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      get().connectSocket();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Erreur",
      };
    }
  },

  // Fonction pour connecter un utilisateur existant
  login: async (data) => {
    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data });
      get().connectSocket();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Erreur",
      };
    }
  },

  // Fonction pour déconnecter l'utilisateur
  logout: async () => {
    await axiosInstance.post("/auth/logout");
    get().disconnectSocket();
    set({ authUser: null });
  },

  // Fonction pour demander la permission de notification à l'utilisateur
  requestNotificationPermission: () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  },

  // Fonction pour connecter le socket de l'utilisateur
  connectSocket: () => {
    const { authUser, socket } = get();
    if (!authUser || socket?.connected) return;

    const newSocket = io(SOCKET_URL, {
      query: { userId: authUser._id },
    });

    newSocket.connect();
    set({ socket: newSocket });

    get().requestNotificationPermission();

    newSocket.on("getOnlineUsers", (userIds) => {
      set({ onlineUsers: userIds });
    });
  },

  // Fonction pour déconnecter le socket de l'utilisateur
  disconnectSocket: () => {
    if (get().socket?.connected) get().socket.disconnect();
  },

  
}));
