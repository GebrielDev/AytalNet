import { Request, Response } from 'express';
import { User } from '../models';
import { Op } from 'sequelize';

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, search } = req.query;
    const where: any = {};

    if (role) where.role = role;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const users = await User.findAll({
      where,
      attributes: { exclude: ['passwordHash'] },
      order: [['createdAt', 'DESC']],
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ['passwordHash'] } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }

    const user = await User.create({
      name,
      email,
      passwordHash: password,
      role: role || 'dispatcher',
    });

    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { name, email, password, role } = req.body;

    if (email && email !== user.email) {
      const existing = await User.findOne({ where: { email } });
      if (existing) {
        res.status(400).json({ error: 'Email already exists' });
        return;
      }
    }

    await user.update({
      ...(name && { name }),
      ...(email && { email }),
      ...(role && { role }),
      ...(password && { passwordHash: password }),
    });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      updatedAt: user.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent deleting yourself
    const currentUser = (req as any).user;
    if (currentUser && currentUser.id === user.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    await user.destroy();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
};
