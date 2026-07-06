import React, { useState, useEffect } from 'react';
import { BookOpen, Search, LifeBuoy, MessageCircle, FileText, ChevronRight, ExternalLink } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthProvider';
import { motion } from 'motion/react';

export const DocsAndSupport = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<any[]>([]);
  const [newTicketMsg, setNewTicketMsg] = useState('');

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'tickets'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setTickets(docs);
    });
    return unsubscribe;
  }, [user]);

  const handleCreateTicket = async () => {
    if (!user || !newTicketMsg.trim()) return;
    const msg = newTicketMsg;
    setNewTicketMsg('');
    await addDoc(collection(db, 'users', user.uid, 'tickets'), {
      message: msg,
      status: 'Open',
      createdAt: serverTimestamp()
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] border-l border-slate-800">
      <div className="h-14 border-b border-slate-800 flex items-center px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3 w-full">
          <LifeBuoy className="text-blue-400" /> Documentation & Support
          <span className="ml-auto flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            FIRESTORE SYNC ACTIVE
          </span>
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex gap-8">
        {/* Support Tickets */}
        <div className="flex-1 flex flex-col gap-6">
           <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
             <h3 className="text-white font-bold mb-4 flex items-center gap-2"><MessageCircle className="w-5 h-5 text-indigo-400"/> My Support Tickets</h3>
             <div className="space-y-4 mb-4">
                {tickets.length === 0 && (
                  <div className="text-slate-500 text-sm font-mono text-center">No open tickets.</div>
                )}
                {tickets.map(ticket => (
                  <div key={ticket.id} className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex justify-between items-center">
                     <span className="text-slate-300 font-mono text-sm truncate max-w-sm">{ticket.message}</span>
                     <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-1 rounded text-xs font-bold">{ticket.status}</span>
                  </div>
                ))}
             </div>
             <div className="flex gap-2">
               <input 
                 type="text" 
                 value={newTicketMsg}
                 onChange={e => setNewTicketMsg(e.target.value)}
                 className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 text-sm text-slate-300 focus:border-indigo-500 outline-none" 
                 placeholder="Describe your issue..." 
               />
               <button onClick={handleCreateTicket} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors">
                 Submit Ticket
               </button>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};
