import { Router } from 'express';
import { loginUser, loginDriver, refreshToken, getMe, forgotPassword, resetPassword } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/login', authRateLimit('login'), loginUser);
router.post('/driver/login', authRateLimit('driver-login'), loginDriver);
router.post('/refresh', refreshToken);
router.post('/forgot-password', authRateLimit('forgot'), forgotPassword);
router.post('/reset-password', authRateLimit('reset'), resetPassword);
router.get('/me', authenticateToken, getMe);

export default router;
