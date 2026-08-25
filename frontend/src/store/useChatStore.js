// store/useChatStore.js

// importation des bibliothèques nécessaires
import { create } from "zustand";
import { axiosInstance } from "@/lib/axios";
import { useAuthStore } from "@/store/useAuthStore";

// Création du store de chat avec Zustand
export const useChatStore = create((set, get) => ({
  users: [],
  messages: [],
  groups: [],
  selectedUser: null,
  replyingTo: null,
  selectedGroup: null,
  isUsersLoading: false,
  isMessagesLoading: false,

  // Fonction pour récupérer la liste des utilisateurs
  getUsers: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/users");
      set({ users: res.data });
    } catch (error) {
      console.error(error);
    } finally {
      set({ isUsersLoading: false });
    }
  },

  // Fonction pour récupérer les messages d'une conversation avec un utilisateur spécifique
  getMessages: async (id, isGroup = false) => {
    set({ isMessagesLoading: true });
    try {
      const res = await axiosInstance.get(`/messages/${id}?isGroup=${isGroup}`);
      set({ messages: res.data });
    } catch (error) {
      console.error(error);
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  // Fonction pour envoyer un message à l'utilisateur sélectionné
  sendMessage: async (data) => {
    const { selectedUser, selectedGroup, messages } = get();
    try {
      const formData = new FormData();
      if (data.text) formData.append("text", data.text);
      if (data.image) formData.append("image", data.image);
      if (data.audio) formData.append("image", data.audio);
      if (data.replyTo) formData.append("replyTo", data.replyTo._id);
      if (selectedGroup) formData.append("groupId", selectedGroup._id);

      const targetId = selectedGroup ? selectedGroup._id : selectedUser._id;

      const res = await axiosInstance.post(
        `/messages/send/${targetId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      set({ messages: [...messages, res.data], replyingTo: null });
    } catch (error) {
      console.error(error);
    }
  },

  // Fonction pour définir le message auquel l'utilisateur répond
  setReplyingTo: (message) => set({ replyingTo: message }),

  // Fonction pour supprimer un message
  deleteMessage: async (messageId) => {
    try {
      await axiosInstance.delete(`/messages/${messageId}`);
      set({ messages: get().messages.filter((m) => m._id !== messageId) });
    } catch (error) {
      console.error(error);
    }
  },

  // Fonction pour modifier un message
  editMessage: async (messageId, newText) => {
    try {
      const res = await axiosInstance.put(`/messages/${messageId}`, {
        text: newText,
      });
      set({
        messages: get().messages.map((m) =>
          m._id === messageId ? res.data : m,
        ),
      });
    } catch (error) {
      console.error(error);
    }
  },

  // Fonction pour définir l'utilisateur sélectionné pour la conversation
  setSelectedUser: (user) => set({ selectedUser: user, selectedGroup: null }),

  // connecter a un message socket pour recevoir les messages en temps réel
  subscribeToMessages: () => {
    const { selectedUser, selectedGroup } = get();
    if (!selectedUser && !selectedGroup) return;

    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.on("newMessage", (newMessage) => {
      const isRelevant = selectedGroup
        ? newMessage.group === selectedGroup._id
        : newMessage.sender === selectedUser._id;

      if (!isRelevant) return;

      set({ messages: [...get().messages, newMessage] });

      if (selectedUser) {
        get().markAsRead(selectedUser._id);
      }

      if (
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const name = selectedGroup
          ? selectedGroup.name
          : selectedUser?.username;
        new Notification(`Nouveau message de ${name}`, {
          body: newMessage.text || "📎 Pièce jointe",
          icon: "/icon.png",
        });
      }
    });

    socket.on("messagesRead", ({ readBy, groupId }) => {
      const myId = useAuthStore.getState().authUser?._id;
      if (selectedGroup && groupId === selectedGroup._id) {
        set({
          messages: get().messages.map((msg) =>
            msg.sender === myId && msg.status !== "read"
              ? { ...msg, status: "read" }
              : msg,
          ),
        });
      } else if (selectedUser && readBy === selectedUser._id) {
        set({
          messages: get().messages.map((msg) =>
            msg.receiver === readBy ? { ...msg, status: "read" } : msg,
          ),
        });
      }
    });

    
    socket.on("messageDeleted", ({ messageId }) => {
      set({ messages: get().messages.filter((m) => m._id !== messageId) });
    });

    socket.on("messageEdited", (updatedMessage) => {
      set({
        messages: get().messages.map((m) =>
          m._id === updatedMessage._id ? updatedMessage : m,
        ),
      });
    });
  },

  // déconnecter du message socket pour arrêter de recevoir les messages en temps réel
  unsubscribeFromMessages: () => {
    const socket = useAuthStore.getState().socket;
    socket?.off("newMessage");
    socket?.off("messagesRead");
    socket?.off("messageDeleted");
    socket?.off("messageEdited");
  },

  // boolean pour indiquer si l'utilisateur sélectionné est en train d'écrire un message
  isTyping: false,

  // souscrire aux événements de saisie en temps réel pour l'utilisateur sélectionné
  subscribeToTyping: () => {
    const { selectedUser } = get();
    if (!selectedUser) return;

    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.on("userTyping", ({ senderId }) => {
      if (senderId === selectedUser._id) {
        set({ isTyping: true });
      }
    });

    socket.on("userStopTyping", ({ senderId }) => {
      if (senderId === selectedUser._id) {
        set({ isTyping: false });
      }
    });
  },

  // se désabonner des événements de saisie en temps réel pour l'utilisateur sélectionné
  unsubscribeFromTyping: () => {
    const socket = useAuthStore.getState().socket;
    socket?.off("userTyping");
    socket?.off("userStopTyping");
  },

  // marquer les messages comme lus pour l'utilisateur sélectionné
  markAsRead: async (id, isGroup = false) => {
    try {
      await axiosInstance.put(`/messages/read/${id}?isGroup=${isGroup}`);
    } catch (error) {
      console.error(error);
    }
  },

  //
  getGroups: async () => {
    try {
      const res = await axiosInstance.get("/groups");
      set({ groups: res.data });
    } catch (error) {
      console.error(error);
    }
  },

  createGroup: async (name, memberIds) => {
    try {
      const res = await axiosInstance.post("/groups", {
        name,
        members: memberIds,
      });
      set({ groups: [...get().groups, res.data] });
      return { success: true };
    } catch (error) {
      console.error(error);
      return { success: false };
    }
  },

  //
  setSelectedGroup: (group) =>
    set({ selectedGroup: group, selectedUser: null }),

  deleteGroup: async (groupId) => {
    try {
      await axiosInstance.delete(`/groups/${groupId}`);
      set({
        groups: get().groups.filter((g) => g._id !== groupId),
        selectedGroup: null,
      });
    } catch (error) {
      console.error(error);
    }
  },
}));
