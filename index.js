import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const prisma = new PrismaClient({
    log: ['error', 'warn'],
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, 'frontend');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL || `${APP_BASE_URL}/`;

app.use(cors({
    origin: APP_BASE_URL,
    credentials: true,
}));

app.use(express.static(frontendDir));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    },
}));

app.use(passport.initialize());
app.use(passport.session());

// Store only what we need from the Google profile
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (userId, done) => {
    try {
        const user = await Promise.race([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    photo: true,
                },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 10000)),
        ]);
        done(null, user ?? null);
    } catch (error) {
        console.error('deserializeUser error:', error.message);
        done(error, null);
    }
});

passport.use(new GoogleStrategy(
    {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${APP_BASE_URL}/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
        console.log('🔵 Google OAuth callback started for profile:', profile.id);
        try {
            const provider = 'google';
            const providerAccountId = profile.id;
            const email = profile.emails?.[0]?.value ?? null;
            const name = profile.displayName || 'Google User';
            const photo = profile.photos?.[0]?.value ?? null;

            console.log('🔵 Looking for existing OAuth account...');
            const existingAccount = await Promise.race([
                prisma.oAuthAccount.findUnique({
                    where: {
                        provider_providerAccountId: {
                            provider,
                            providerAccountId,
                        },
                    },
                    include: { user: true },
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('OAuth account lookup timeout (10s)')), 10000)),
            ]);

            if (existingAccount) {
                console.log('🟢 Found existing OAuth account for user:', existingAccount.user.id);
                const updatedUser = await Promise.race([
                    prisma.user.update({
                        where: { id: existingAccount.user.id },
                        data: {
                            name,
                            email,
                            photo,
                        },
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            photo: true,
                        },
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('User update timeout (10s)')), 10000)),
                ]);
                console.log('🟢 Updated existing user successfully');
                return done(null, updatedUser);
            }

            console.log('🟡 OAuth account not found, checking for existing user by email:', email);
            let localUser = null;
            if (email) {
                localUser = await Promise.race([
                    prisma.user.findUnique({ where: { email } }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Email lookup timeout (10s)')), 10000)),
                ]);
            }

            if (!localUser) {
                console.log('🟡 No user found, creating new user...');
                localUser = await Promise.race([
                    prisma.user.create({
                        data: {
                            email,
                            name,
                            photo,
                        },
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('User creation timeout (10s)')), 10000)),
                ]);
                console.log('🟢 Created new user:', localUser.id);
            } else {
                console.log('🟡 Found existing user by email, updating...');
                localUser = await Promise.race([
                    prisma.user.update({
                        where: { id: localUser.id },
                        data: {
                            name,
                            photo,
                        },
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('User update timeout (10s)')), 10000)),
                ]);
                console.log('🟢 Updated existing user');
            }

            console.log('🔵 Creating OAuth account link...');
            await Promise.race([
                prisma.oAuthAccount.create({
                    data: {
                        provider,
                        providerAccountId,
                        userId: localUser.id,
                    },
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('OAuth account creation timeout (10s)')), 10000)),
            ]);
            console.log('🟢 OAuth account link created');

            console.log('🟢✅ OAuth login flow complete for user:', localUser.id);
            return done(null, {
                id: localUser.id,
                name: localUser.name,
                email: localUser.email,
                photo: localUser.photo,
            });
        } catch (error) {
            console.error('🔴 Google strategy error:', error.message);
            console.error('🔴 Stack:', error.stack);
            return done(error, null);
        }
    }
));

// --- Auth routes ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}?error=auth_failed` }),
    (req, res) => {
        console.log('Google authentication successful, redirecting to:', FRONTEND_URL);
        res.redirect(FRONTEND_URL);
    }
);

app.get('/auth/logout', (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

// Returns the logged-in user or null
app.get('/api/me', (req, res) => {
    res.json(req.user ?? null);
});

// --- Existing routes ---
app.get('/', (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/api/data', (req, res) => {
    res.json({ message: 'This is some data from the server! Hello World!' });
});

// Health check endpoint to test DB connectivity
app.get('/api/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
        console.error('Health check failed:', error.message);
        res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`APP_BASE_URL: ${APP_BASE_URL}`);
  console.log(`FRONTEND_URL: ${FRONTEND_URL}`);
});

process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await prisma.$disconnect();
    process.exit(0);
});