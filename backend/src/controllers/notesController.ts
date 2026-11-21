import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Driver, DriverNote } from '../models';
import { driverRoom } from '../socket';

/** One-way notes: dispatchers send, drivers read and tap "Got it". */

const noteView = (n: DriverNote) => ({
  id: n.id,
  message: n.message,
  sentByName: n.sentByName ?? null,
  readAt: n.readAt ?? null,
  reply: n.reply ?? null,
  repliedAt: n.repliedAt ?? null,
  createdAt: n.createdAt,
});

// What the driver's trip screen shows: notes not yet acknowledged.
const unreadFor = async (driverId: number) =>
  (await DriverNote.findAll({ where: { driverId, readAt: null }, order: [['createdAt', 'ASC']], limit: 20 })).map(noteView);

const validId = (v: string) => /^\d+$/.test(v);

export const sendDriverNote = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!validId(req.params.id)) {
      res.status(400).json({ error: 'Invalid driver id' });
      return;
    }
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'Write a message first' });
      return;
    }
    if (message.length > 500) {
      res.status(400).json({ error: 'Keep the message under 500 characters' });
      return;
    }
    const driver = await Driver.findByPk(req.params.id, { attributes: ['id'] });
    if (!driver) {
      res.status(404).json({ error: 'Driver not found' });
      return;
    }
    const note = await DriverNote.create({ driverId: driver.id, message, sentById: req.user!.id, sentByName: req.user!.name });
    const io = req.app.get('io');
    io?.of('/driver').to(driverRoom(driver.id)).emit('notes:updated', await unreadFor(driver.id));
    io?.to('dashboard').emit('notes:changed', { driverId: driver.id });
    res.status(201).json(noteView(note));
  } catch (error) {
    console.error('[notes] Could not send note', error);
    res.status(500).json({ error: 'Failed to send note' });
  }
};

export const getDriverNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!validId(req.params.id)) {
      res.status(400).json({ error: 'Invalid driver id' });
      return;
    }
    const notes = await DriverNote.findAll({ where: { driverId: req.params.id }, order: [['createdAt', 'DESC']], limit: 30 });
    res.json(notes.map(noteView));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
};

export const getMyNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await unreadFor(req.driver!.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
};

export const markMyNoteRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    if (!validId(req.params.noteId)) {
      res.status(400).json({ error: 'Invalid note id' });
      return;
    }
    await DriverNote.update({ readAt: new Date() }, { where: { id: req.params.noteId, driverId, readAt: { [Op.is]: null } } });
    req.app.get('io')?.to('dashboard').emit('notes:changed', { driverId });
    res.json(await unreadFor(driverId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note' });
  }
};

/** Quick answers a driver can send back. */
export const QUICK_REPLIES = ['Got it', 'On my way', 'Call me', 'Running late'];

export const replyToMyNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = req.driver!.id;
    if (!validId(req.params.noteId)) {
      res.status(400).json({ error: 'Invalid note id' });
      return;
    }
    const reply = String(req.body?.reply ?? '').trim();
    if (!QUICK_REPLIES.includes(reply)) {
      res.status(400).json({ error: `Reply must be one of: ${QUICK_REPLIES.join(', ')}` });
      return;
    }
    const note = await DriverNote.findOne({ where: { id: req.params.noteId, driverId } });
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    const now = new Date();
    await note.update({ reply, repliedAt: now, readAt: note.readAt ?? now });
    const io = req.app.get('io');
    io?.to('dashboard').emit('notes:changed', { driverId });
    if (reply !== 'Got it') {
      const driver = await Driver.findByPk(driverId, { attributes: ['name'] });
      io?.to('dashboard').emit('note:replied', { noteId: note.id, driverId, driverName: driver?.name ?? 'Driver', message: note.message, reply, at: now });
    }
    res.json(await unreadFor(driverId));
  } catch (error) {
    console.error('[notes] Could not save reply', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
};
