import { useEffect, useState } from 'react';
import { db } from './firebase';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

const createdAtMillis = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;

function KitchenDashboard({ user }) {
  const [orders, setOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const isChristStudent = user?.email?.endsWith('@christuniversity.in') || user?.email?.endsWith('@res.christuniversity.in');

  useEffect(() => {
    if (!isChristStudent || !user?.uid) return;

    const ordersQuery = query(collection(db, 'orders'), where('student_uid', '==', user.uid));
    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const activeOrders = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          // Only PAID orders are live orders — failed/cancelled checkout attempts never enter
          // the collection queue.
          .filter((order) => order.status !== 'completed' && order.payment_status === 'paid')
          .sort((a, b) => createdAtMillis(b.created_at) - createdAtMillis(a.created_at));
        setOrders(activeOrders);
      },
      (error) => console.error('Student orders listener failed:', error)
    );

    return () => unsubscribe();
  }, [user?.uid, isChristStudent]);

  const handleCollect = async (orderId) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'completed', updatedAt: serverTimestamp(), completed_at: serverTimestamp() });
      await setDoc(
        doc(db, 'order_signals', orderId),
        { status: 'completed', completed_at: serverTimestamp() },
        { merge: true }
      ).catch((error) => console.error('Failed to mirror order signal:', error));
    } catch (error) {
      console.error('Error marking order collected:', error);
    }
  };

  const filteredOrders = orders.filter(order =>
    order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    order.item_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isChristStudent) return null;

  return (
    <div className="min-h-screen bg-[#FDF8F5] text-[#4A3525] font-sans antialiased">
      {/* NAVIGATION */}
      <nav className="border-b border-gray-100 h-16 sticky top-0 bg-white/90 backdrop-blur-sm z-50">
        <div className="max-w-[800px] mx-auto h-full flex justify-between items-center px-6">
          <img src="/logo.png" alt="CU" className="h-7 w-auto grayscale" />
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{user.displayName?.split(' ')[0]}</span>
            <img src={user.photoURL} className="w-6 h-6 grayscale border border-gray-100" alt="" />
          </div>
        </div>
      </nav>

      {/* SILK STRUCTURE: Ultra-thin border for that high-end look */}
      <main className="max-w-[800px] mx-auto mt-12 mb-20 border-[0.5px] border-gray-200 p-8 md:p-16">

        <header className="mb-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <span className="text-[10px] font-black text-gray-300 uppercase tracking-[0.4em] block mb-2">Registry</span>
              <h1 className="text-4xl font-light tracking-tighter uppercase">Live Board</h1>
            </div>

            {/* MINIMALIST SEARCH BAR */}
            <div className="w-full md:w-64 relative border-b border-gray-100 pb-1">
              <input
                type="text"
                placeholder="SEARCH TOKEN"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent py-1 text-[10px] font-bold tracking-widest focus:outline-none placeholder:text-gray-200"
              />
            </div>
          </div>
        </header>

        <div className="space-y-0">
          {filteredOrders.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-[9px] font-bold text-gray-200 uppercase tracking-[0.5em]">No Active Records</p>
            </div>
          ) : (
            filteredOrders.map(order => (
              <div key={order.id} className="flex flex-col md:flex-row justify-between gap-10 py-12 border-b border-gray-50 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-6">
                    <span className="text-[10px] font-black text-black border border-black px-2 py-0.5 uppercase tracking-tighter">
                      TK-{order.id.slice(-4).toUpperCase()}
                    </span>
                    <span className="text-[9px] text-gray-300 font-bold uppercase tracking-widest">
                      {createdAtMillis(order.created_at) ? new Date(createdAtMillis(order.created_at)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}
                    </span>
                  </div>

                  <h3 className="text-2xl font-medium text-gray-900 tracking-tight uppercase mb-8">{order.item_name}</h3>

                  <div className="max-w-xs">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[8px] font-black uppercase tracking-[0.3em] text-gray-300">Phase</span>
                      <span className="text-[9px] font-bold text-black uppercase tracking-widest">{order.status}</span>
                    </div>
                    {/* The Silk Progress Line */}
                    <div className="h-[1px] bg-gray-100 w-full">
                      <div
                        className="h-full bg-black transition-all duration-500"
                        style={{ width: order.status === 'ready' ? '100%' : order.status === 'preparing' ? '66%' : '33%' }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-end">
                  {order.status === 'ready' ? (
                    <button
                      onClick={() => handleCollect(order.id)}
                      className="px-10 py-4 bg-black text-white text-[9px] font-black uppercase tracking-[0.3em] hover:bg-[#C9501F] transition-colors duration-300"
                    >
                      Collect
                    </button>
                  ) : (
                    <span className="text-[9px] font-bold text-gray-200 uppercase tracking-widest text-right">In Queue</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      <footer className="max-w-[800px] mx-auto px-6 pb-20 flex justify-between text-[8px] font-bold text-gray-200 uppercase tracking-[0.6em]">
        <span>Portal // Christ University</span>
        <span>2026</span>
      </footer>
    </div>
  );
}

export default KitchenDashboard;
