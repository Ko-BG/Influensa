// server.js – single-file backend for Influensa (Express + MongoDB Atlas)

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ────────────────────────────────────────────────
// MongoDB Schema
// ────────────────────────────────────────────────
const postSchema = new mongoose.Schema({
  type:       { type: String, required: true },
  content:    { type: String },
  caption:    { type: String, default: '' },
  premium:    { type: Boolean, default: false },
  likes:      { type: Number, default: 0 },
  comments:   [{ text: String, createdAt: { type: Date, default: Date.now } }],
  timestamp:  { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// Simple in-memory wallet (demo – in production use User model)
let wallet = { balance: 1000, currency: 'KES' };

// ────────────────────────────────────────────────
// API Endpoints
// ────────────────────────────────────────────────

// GET /api/feed – return real posts + some demo mixing
app.get('/api/feed', async (req, res) => {
  try {
    let posts = await Post.find().sort({ timestamp: -1 }).limit(30).lean();

    // If DB empty, mix demo content
    if (posts.length < 5) {
      const demo = [
        { _id: 'demo1', type: 'chat', content: 'Hey bro, you watching the match? ⚽', timestamp: new Date().toISOString() },
        { _id: 'demo2', type: 'video', content: 'https://www.w3schools.com/html/mov_bbb.mp4', premium: true, caption: 'Epic gaming moment', timestamp: new Date().toISOString() },
        { _id: 'demo3', type: 'image', content: 'https://picsum.photos/id/1015/600/400', caption: 'Nairobi sunset vibes 🌅', timestamp: new Date().toISOString() },
        { _id: 'demo4', type: 'document', content: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', caption: 'Sample eBook', timestamp: new Date().toISOString() }
      ];
      posts = [...posts, ...demo];
    }

    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts – upload new content
app.post('/api/posts', async (req, res) => {
  try {
    // Basic duplicate check for text posts
    if (req.body.type === 'post') {
      const duplicate = await Post.findOne({ content: req.body.content });
      if (duplicate) return res.status(409).json({ error: 'Similar content already posted' });
    }

    const post = new Post(req.body);
    await post.save();
    res.status(201).json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/posts/:id/comment
app.post('/api/posts/:id/comment', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Comment required' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    post.comments.push({ text });
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet
app.get('/api/wallet', (req, res) => res.json(wallet));

// POST /api/wallet/transaction
app.post('/api/wallet/transaction', (req, res) => {
  const { amount, type } = req.body; // type: 'credit' | 'debit'
  const value = Number(amount);

  if (!value || value <= 0) return res.status(400).json({ error: 'Invalid amount' });

  if (type === 'debit' && wallet.balance < value) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  wallet.balance += (type === 'debit' ? -value : value);
  res.json({ success: true, balance: wallet.balance });
});

// Serve frontend (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/influensa')
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => {
      console.log(`Influensa running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB error:', err);
    process.exit(1);
  });
