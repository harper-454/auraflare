import { db, auth } from './firebase';
import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';

export const StorageService = {
  save: async (key: string, data: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      
      const user = auth.currentUser;
      if (user) {
        const docRef = doc(db, 'users', user.uid, 'data', key);
        await setDoc(docRef, { value: JSON.stringify(data), updatedAt: new Date() });
      }
    } catch (e) {
      console.error('Failed to save to localStorage/Firebase', e);
    }
  },
  load: (key: string) => {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to load from localStorage', e);
      return null;
    }
  },
  hasSavedData: () => {
    return Object.keys(localStorage).some(k => k.startsWith('aura-app-') || k.startsWith('vision-') || k.startsWith('tasks-') || k.startsWith('roadmap-') || k.startsWith('requirements-') || k.startsWith('viewport-'));
  },
  clearAll: () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('aura-app-') || k.startsWith('vision-') || k.startsWith('tasks-') || k.startsWith('roadmap-') || k.startsWith('requirements-') || k.startsWith('viewport-'));
    keys.forEach(k => localStorage.removeItem(k));
  },
  syncFromCloud: async () => {
    const user = auth.currentUser;
    if (!user) return false;
    try {
      const querySnapshot = await getDocs(collection(db, 'users', user.uid, 'data'));
      let synced = false;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.value) {
          localStorage.setItem(doc.id, data.value);
          synced = true;
        }
      });
      return synced;
    } catch (e) {
      console.error("Failed to sync from cloud", e);
      return false;
    }
  }
};
