import { notesApi } from './api';

/** One-way notes from the dispatcher, shown on the trip screen until "Got it". */
export type Note = { id: number; message: string; sentByName: string | null; readAt: string | null; createdAt: string };

const listeners = new Set<(notes: Note[]) => void>();
let current: Note[] = [];

const publish = (notes: Note[]) => {
  current = notes;
  listeners.forEach((l) => l(notes));
};

export const subscribeToNotes = (listener: (notes: Note[]) => void): (() => void) => {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
};

/** Pushed live by the server. */
export const setNotesLocal = (notes: Note[]) => publish(Array.isArray(notes) ? notes : []);

export const fetchNotes = async (): Promise<void> => {
  try {
    publish((await notesApi.getMine()).data);
  } catch {
    // No signal: keep what is shown.
  }
};

export const QUICK_REPLIES = ['Got it', 'On my way', 'Call me', 'Running late'];

/** Sends a quick reply (which also clears the note). False if it could not be sent. */
export const replyToNote = async (id: number, reply: string): Promise<boolean> => {
  try {
    publish((await notesApi.reply(id, reply)).data);
    return true;
  } catch {
    return false;
  }
};
