import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { driversApi } from '../services/api';

const SOCKET_URL = new URL(import.meta.env.VITE_API_URL || '/', window.location.origin).origin;

interface Note {
  id: number;
  message: string;
  sentByName: string | null;
  readAt: string | null;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

const QUICK = ['Call the office when you can', 'Running late? Let us know', 'Next stop changed — check your list'];

/** One-way notes to a driver. They appear on the driver's trip screen until tapped "Got it". */
export default function NotesModal({ driver, onClose }: { driver: { id: number; name: string }; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = () => driversApi.getNotes(driver.id).then((res) => setNotes(res.data)).catch(() => setError('Could not load notes'));

  // "Seen" updates live when the driver taps Got it.
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: import.meta.env.VITE_SOCKET_PATH || '/socket.io',
      auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
    });
    socket.on('notes:changed', (e: { driverId: number }) => e.driverId === driver.id && load());
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id]);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id]);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      await driversApi.sendNote(driver.id, message.trim());
      setMessage('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not send the note');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" data-testid="notes-modal">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-6 pb-3">
          <h2 className="text-lg font-bold text-gray-900">Note to {driver.name}</h2>
          <p className="text-sm text-gray-500 mt-1">Shows on the driver's trip screen straight away. They answer with a quick reply (Got it, On my way, Call me, Running late).</p>
        </div>
        <div className="px-6 space-y-3 overflow-y-auto flex-1">
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button key={q} onClick={() => setMessage(q)} className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100">
                {q}
              </button>
            ))}
          </div>
          <textarea
            data-testid="notes-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Type a short message…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-900"
          />
          {error && <p className="text-sm text-red-600" data-testid="notes-error">{error}</p>}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent notes</h3>
            {notes.length === 0 && <p className="text-sm text-gray-500">No notes sent yet.</p>}
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="border border-gray-200 rounded-lg p-3" data-testid={`notes-item-${n.id}`}>
                  <p className="text-sm text-gray-900">{n.message}</p>
                  {n.reply && n.reply !== 'Got it' && (
                    <p className="text-sm font-semibold text-blue-700 mt-1" data-testid={`notes-reply-${n.id}`}>
                      ↩ “{n.reply}”{n.repliedAt ? ` · ${new Date(n.repliedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(n.createdAt).toLocaleString()} · {n.sentByName || 'Dispatcher'} ·{' '}
                    {n.readAt ? (
                      <span className="text-green-700 font-medium">Seen {new Date(n.readAt).toLocaleTimeString()}</span>
                    ) : (
                      <span className="text-amber-700 font-medium">Not seen yet</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-6 pt-4">
          <button data-testid="notes-close-button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
          <button data-testid="notes-send-button" disabled={sending || !message.trim()} onClick={send} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
            {sending ? 'Sending…' : 'Send note'}
          </button>
        </div>
      </div>
    </div>
  );
}
