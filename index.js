import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as LocalStrategy } from 'passport-local';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
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

// Wraps a Prisma query with a timeout to prevent hanging
const withTimeout = (promise, ms = 10000) =>
    Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Database query timeout (${ms}ms)`)), ms)
        ),
    ]);

app.use(cors({
    origin: APP_BASE_URL,
    credentials: true,
}));

app.use(express.static(frontendDir));
app.use(express.json());

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

// Sessions store the LocalUser id — the source of truth for all auth
passport.serializeUser((localUser, done) => done(null, localUser.id));

passport.deserializeUser(async (localUserId, done) => {
    try {
        const localUser = await withTimeout(
            prisma.localUser.findUnique({
                where: { id: localUserId },
                include: { user: { select: { photo: true } } },
            })
        );
        done(null, localUser ?? null);
    } catch (error) {
        console.error('deserializeUser error:', error.message);
        done(error, null);
    }
});

// --- Local username/password strategy ---
passport.use(new LocalStrategy(
    { usernameField: 'username', passwordField: 'password' },
    async (username, password, done) => {
        try {
            const localUser = await withTimeout(
                prisma.localUser.findUnique({
                    where: { username },
                    include: { user: { select: { photo: true } } },
                })
            );

            if (!localUser || !localUser.passwordHash) {
                return done(null, false, { message: 'Invalid username or password' });
            }

            const valid = await bcrypt.compare(password, localUser.passwordHash);
            if (!valid) {
                return done(null, false, { message: 'Invalid username or password' });
            }

            return done(null, localUser);
        } catch (error) {
            return done(error);
        }
    }
));

// --- Google OAuth strategy ---
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
            const displayName = profile.displayName || 'Google User';
            const photo = profile.photos?.[0]?.value ?? null;

            // Check if this Google account has been linked before
            console.log('🔵 Looking for existing OAuth account...');
            const existingAccount = await withTimeout(
                prisma.oAuthAccount.findUnique({
                    where: { provider_providerAccountId: { provider, providerAccountId } },
                    include: {
                        user: {
                            include: { localUser: true },
                        },
                    },
                })
            );

            if (existingAccount) {
                console.log('🟢 Found existing OAuth account, user:', existingAccount.user.id);
                // Update OAuth profile photo/name
                await withTimeout(
                    prisma.user.update({
                        where: { id: existingAccount.user.id },
                        data: { name: displayName, email, photo },
                    })
                );

                let localUser = existingAccount.user.localUser;

                // If the User row was somehow not linked to a LocalUser yet, create one now
                if (!localUser) {
                    console.log('🟡 User missing LocalUser link — creating one...');
                    localUser = await withTimeout(
                        prisma.localUser.create({
                            data: {
                                email,
                                displayName,
                                user: { connect: { id: existingAccount.user.id } },
                            },
                        })
                    );
                    await withTimeout(
                        prisma.user.update({
                            where: { id: existingAccount.user.id },
                            data: { localUserId: localUser.id },
                        })
                    );
                } else {
                    // Keep LocalUser display info in sync
                    localUser = await withTimeout(
                        prisma.localUser.update({
                            where: { id: localUser.id },
                            data: { displayName, email },
                        })
                    );
                }

                console.log('🟢 Google OAuth login complete for LocalUser:', localUser.id);
                return done(null, { ...localUser, user: { photo } });
            }

            // No existing OAuth account — find or create LocalUser first
            console.log('🟡 No OAuth account found, finding/creating LocalUser by email:', email);
            let localUser = email
                ? await withTimeout(prisma.localUser.findUnique({ where: { email } }))
                : null;

            if (!localUser) {
                localUser = await withTimeout(
                    prisma.localUser.create({ data: { email, displayName } })
                );
                console.log('🟢 Created new LocalUser:', localUser.id);
            } else {
                localUser = await withTimeout(
                    prisma.localUser.update({
                        where: { id: localUser.id },
                        data: { displayName },
                    })
                );
                console.log('🟢 Found existing LocalUser:', localUser.id);
            }

            // Find or create the OAuth User profile row
            let oauthUser = email
                ? await withTimeout(prisma.user.findUnique({ where: { email } }))
                : null;

            if (!oauthUser) {
                oauthUser = await withTimeout(
                    prisma.user.create({
                        data: { email, name: displayName, photo, localUserId: localUser.id },
                    })
                );
                console.log('🟢 Created new User:', oauthUser.id);
            } else {
                oauthUser = await withTimeout(
                    prisma.user.update({
                        where: { id: oauthUser.id },
                        data: { name: displayName, photo, localUserId: localUser.id },
                    })
                );
                console.log('🟢 Updated existing User:', oauthUser.id);
            }

            // Link this Google account to the User row
            console.log('🔵 Creating OAuthAccount link...');
            await withTimeout(
                prisma.oAuthAccount.create({
                    data: { provider, providerAccountId, userId: oauthUser.id },
                })
            );

            console.log('🟢✅ Google OAuth flow complete for LocalUser:', localUser.id);
            return done(null, { ...localUser, user: { photo } });
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

// Local registration
app.post('/auth/register', async (req, res, next) => {
    const { username, password, displayName, email } = req.body;

    if (!username || !password || !displayName) {
        return res.status(400).json({ error: 'username, password, and displayName are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const localUser = await prisma.localUser.create({
            data: {
                username,
                passwordHash,
                displayName,
                email: email || null,
            },
        });

        req.login(localUser, (err) => {
            if (err) return next(err);
            res.json({
                success: true,
                user: {
                    id: localUser.id,
                    username: localUser.username,
                    email: localUser.email,
                    displayName: localUser.displayName,
                    photo: null,
                    hasPassword: true,
                    hasGoogle: false,
                },
            });
        });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Username or email already taken' });
        }
        next(error);
    }
});

// Local login
app.post('/auth/login', (req, res, next) => {
    passport.authenticate('local', (err, localUser, info) => {
        if (err) return next(err);
        if (!localUser) return res.status(401).json({ error: info?.message || 'Invalid credentials' });

        req.login(localUser, (err) => {
            if (err) return next(err);
            const { passwordHash: _, user: oauthProfile, ...safeUser } = localUser;
            res.json({
                success: true,
                user: {
                    ...safeUser,
                    photo: oauthProfile?.photo ?? null,
                    hasPassword: true,
                    hasGoogle: !!oauthProfile,
                },
            });
        });
    })(req, res, next);
});

app.get('/auth/logout', (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

// Returns the current authenticated user (strips sensitive fields)
app.get('/api/me', (req, res) => {
    if (!req.user) return res.json(null);
    const { passwordHash: _, user: oauthProfile, ...safeUser } = req.user;
    res.json({
        ...safeUser,
        photo: oauthProfile?.photo ?? null,
        hasPassword: !!req.user.passwordHash,
        hasGoogle: !!oauthProfile,
    });
});

// --- Existing routes ---
app.get('/', (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/api/data', (req, res) => {
    res.json({ message: 'This is some data from the server! Hello World!' });
});

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
