/**
 * firebase-service.js
 * Handles Firebase initialization, Authentication, and Firestore Sync
 */

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Initialize Firebase
if (!window.firebaseConfig) {
    console.error("Firebase Configuration is missing! Ensure firebase-config.js is loaded correctly.");
}

const app = initializeApp(window.firebaseConfig || {});
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const FirebaseService = {
    currentUser: null,

    // Login with Google
    login: async () => {
        try {
            const result = await signInWithPopup(auth, provider);
            return result.user;
        } catch (error) {
            console.error("Login failed:", error);
            throw error;
        }
    },

    // Logout
    logout: async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout failed:", error);
        }
    },

    // Check Auth State
    onAuthChange: (callback) => {
        onAuthStateChanged(auth, (user) => {
            FirebaseService.currentUser = user;
            callback(user);
        });
    },

    // Process Sync Queue
    processSyncQueue: async () => {
        if (!navigator.onLine || !FirebaseService.currentUser) return;

        const queue = JSON.parse(localStorage.getItem('firebase-sync-queue') || '[]');
        if (queue.length === 0) return;

        console.log(`Processing sync queue: ${queue.length} items...`);
        
        for (const item of queue) {
            try {
                const docRef = doc(db, item.collection, item.id);
                await setDoc(docRef, {
                    ...item.data,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                FirebaseService.removeFromSyncQueue(item.collection, item.id);
            } catch (error) {
                console.warn(`Sync failed for ${item.collection}/${item.id}`, error);
            }
        }
    },

    // Save data to Firestore (Direct-First)
    saveData: async (collectionName, docId, data) => {
        // Mirror to local for instant UI feel
        localStorage.setItem(`${collectionName}-${docId}`, JSON.stringify(data));
        
        if (!navigator.onLine || !FirebaseService.currentUser) {
            FirebaseService.addToSyncQueue(collectionName, docId, data);
            return;
        }

        try {
            const docRef = doc(db, collectionName, docId);
            await setDoc(docRef, {
                ...data,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            FirebaseService.removeFromSyncQueue(collectionName, docId);
        } catch (error) {
            console.error(`Firebase save failed for ${collectionName}/${docId}:`, error);
            FirebaseService.addToSyncQueue(collectionName, docId, data);
        }
    },

    // Delete data from Firestore (and local)
    deleteData: async (collectionName, docId) => {
        // 1. Remove from local storage
        localStorage.removeItem(`${collectionName}-${docId}`);
        
        // 2. Clean from sync queue
        FirebaseService.removeFromSyncQueue(collectionName, docId);

        // 3. Delete from Firebase if online
        if (navigator.onLine && FirebaseService.currentUser) {
            try {
                const docRef = doc(db, collectionName, docId);
                await deleteDoc(docRef);
                console.log(`Successfully deleted ${collectionName}/${docId}`);
            } catch (error) {
                console.error(`Firebase deletion failed for ${collectionName}/${docId}:`, error);
            }
        }
    },

    // Fetch all documents in a collection
    fetchAllDocs: async (collectionName) => {
        if (!FirebaseService.currentUser) return [];
        try {
            const querySnapshot = await getDocs(collection(db, collectionName));
            const docs = [];
            querySnapshot.forEach((docSnap) => {
                docs.push({ id: docSnap.id, ...docSnap.data() });
            });
            return docs;
        } catch (error) {
            console.error(`Error fetching collection ${collectionName}:`, error);
            return [];
        }
    },

    // Fetch data from Firestore
    fetchData: async (collectionName, docId) => {
        if (!navigator.onLine || !FirebaseService.currentUser) {
            const local = localStorage.getItem(`${collectionName}-${docId}`);
            return local ? JSON.parse(local) : null;
        }

        try {
            const docRef = doc(db, collectionName, docId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                localStorage.setItem(`${collectionName}-${docId}`, JSON.stringify(data));
                return data;
            }
        } catch (error) {
            console.error(`Error fetching ${collectionName}/${docId}:`, error);
        }
        
        const local = localStorage.getItem(`${collectionName}-${docId}`);
        return local ? JSON.parse(local) : null;
    },

    // Sync Queue Management
    addToSyncQueue: (collectionName, docId, data) => {
        let queue = JSON.parse(localStorage.getItem('firebase-sync-queue') || '[]');
        const existing = queue.findIndex(item => item.collection === collectionName && item.id === docId);
        if (existing > -1) {
            queue[existing].data = data;
            queue[existing].timestamp = Date.now();
        } else {
            queue.push({ collection: collectionName, id: docId, data, timestamp: Date.now() });
        }
        localStorage.setItem('firebase-sync-queue', JSON.stringify(queue));
    },

    removeFromSyncQueue: (collectionName, docId) => {
        let queue = JSON.parse(localStorage.getItem('firebase-sync-queue') || '[]');
        queue = queue.filter(item => !(item.collection === collectionName && item.id === docId));
        localStorage.setItem('firebase-sync-queue', JSON.stringify(queue));
    },

    // Listen for real-time changes to a document
    listenToDoc: (collectionName, docId, callback) => {
        if (!FirebaseService.currentUser) return null;
        
        try {
            const docRef = doc(db, collectionName, docId);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    localStorage.setItem(`${collectionName}-${docId}`, JSON.stringify(data));
                    callback(data);
                } else {
                    callback(null);
                }
            }, (error) => {
                console.error(`Error listening to ${collectionName}/${docId}:`, error);
            });
        } catch (error) {
            console.error(`Setup error for listener ${collectionName}/${docId}:`, error);
            return null;
        }
    }
};

// 1. Listen for connection status
window.addEventListener('online', () => {
    console.log("App is back online. Syncing...");
    FirebaseService.processSyncQueue();
});

// 2. Proactive Sync on app focus/visibility (Zero-Leak Policy)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log("App visible. Catching up on cloud sync...");
        FirebaseService.processSyncQueue();
    }
});

// 3. Periodic sync every 60 seconds (Increased frequency for reliability)
setInterval(() => {
    FirebaseService.processSyncQueue();
}, 60000);

window.FirebaseService = FirebaseService;
