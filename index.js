import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500/frontend/index.html';
const allowedOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

// Store only what we need from the Google profile
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (userId, done) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                photo: true,
            },
        });
        done(null, user ?? null);
    } catch (error) {
        done(error, null);
    }
});

passport.use(new GoogleStrategy(
    {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: 'http://localhost:3000/auth/google/callback',
    },
    async (_accessToken, _refreshToken, profile, done) => {
        try {
            const provider = 'google';
            const providerAccountId = profile.id;
            const email = profile.emails?.[0]?.value ?? null;
            const name = profile.displayName || 'Google User';
            const photo = profile.photos?.[0]?.value ?? null;

            const existingAccount = await prisma.oAuthAccount.findUnique({
                where: {
                    provider_providerAccountId: {
                        provider,
                        providerAccountId,
                    },
                },
                include: { user: true },
            });

            if (existingAccount) {
                const updatedUser = await prisma.user.update({
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
                });
                return done(null, updatedUser);
            }

            let localUser = null;
            if (email) {
                localUser = await prisma.user.findUnique({ where: { email } });
            }

            if (!localUser) {
                localUser = await prisma.user.create({
                    data: {
                        email,
                        name,
                        photo,
                    },
                });
            } else {
                localUser = await prisma.user.update({
                    where: { id: localUser.id },
                    data: {
                        name,
                        photo,
                    },
                });
            }

            await prisma.oAuthAccount.create({
                data: {
                    provider,
                    providerAccountId,
                    userId: localUser.id,
                },
            });

            return done(null, {
                id: localUser.id,
                name: localUser.name,
                email: localUser.email,
                photo: localUser.photo,
            });
        } catch (error) {
            return done(error, null);
        }
    }
));

// --- Auth routes ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: FRONTEND_URL }),
    (_req, res) => res.redirect(FRONTEND_URL)
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
app.get('/api/data', (req, res) => {
    res.json({ message: 'This is some data from the server! Hello World!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

process.on('SIGINT', async () => {
        await prisma.$disconnect();
        process.exit(0);
});