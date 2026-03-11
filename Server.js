const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const Jimp = require('jimp'); 
const ffmpeg = require('fluent-ffmpeg'); 
const http = require('http'); 
const { Server } = require('socket.io'); 
require('dotenv').config();

const app = express();
const server = http.createServer(app); 
const io = new Server(server, {
    cors: { origin: "*" }
});

// --- CINEMATIC LAUNCH SEQUENCE ---
const launchProtocol = async () => {
    const brand = "iNFLUENSA";
    const subtext = "the power of influens";
    for (let char of brand) {
        process.stdout.write(char + " ");
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    console.log("\n" + subtext);
    console.log("------------------------------------------");
};

// --- AFRO COIN GENESIS CONSTANTS ---
const AFRO_HARD_CAP = 1000000000; 
const PROTOCOL_FEE = 0.0789;      
const MINTING_REWARD_RATE = 0.10; 
const PLATFORM_RESERVE_SHARE = 0.20; 

// --- NEURAL SENTRY CONFIGURATION ---
const neuralSentryLog = new Map();
const MAX_REQUESTS_PER_WINDOW = 100; // Limits nodes to 100 reqs per minute
const WINDOW_MS = 60000; 

// 1. DIRECTORY & UPLOAD SETUP
const uploadDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// 2. MIDDLEWARE
app.use(cors());
app.use(express.json({ limit: '110mb' })); 
app.use(express.urlencoded({ limit: '110mb', extended: true }));
app.use('/uploads', express.static(uploadDir));

// --- NEURAL SENTRY MIDDLEWARE ---
app.use((req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    if (!neuralSentryLog.has(ip)) {
        neuralSentryLog.set(ip, { count: 1, startTime: now });
    } else {
        const entry = neuralSentryLog.get(ip);
        if (now - entry.startTime < WINDOW_MS) {
            entry.count++;
            if (entry.count > MAX_REQUESTS_PER_WINDOW) {
                console.log(`⚠️ NEURAL SENTRY: Rate Limit Triggered for ${ip}`);
                return res.status(429).json({ error: "NEURAL_SENTRY_BLOCK", message: "Excessive Nodal Traffic Detected" });
            }
        } else {
            neuralSentryLog.set(ip, { count: 1, startTime: now });
        }
    }
    next();
});

app.use(express.static(__dirname));

// 3. DATABASE
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🔥 iNFLUENSA Grid: MongoDB Connected'))
    .catch(err => console.error('❌ Grid Connection Error:', err));

// 4. SCHEMAS
const postSchema = new mongoose.Schema({
    title: String, price: Number, owner: String, mime: String, filename: String, 
    cid: { type: String, unique: true }, unlocked_by: [String], licensed_to: [String],
    scarcity_limit: { type: Number, default: 0 }, 
    collaborators: [{ node: String, signature: String, split: Number, signedAt: Number, contractHash: String }],
    is_burned: { type: Boolean, default: false }, timestamp: { type: Number, default: Date.now },
    is_stream: { type: Boolean, default: false }, stream_url: String
});
const Post = mongoose.model('Post', postSchema);

const userSchema = new mongoose.Schema({ 
    identity: { type: String, unique: true, index: true }, 
    afroCoins: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    lastSeen: { type: Number, default: Date.now } 
});
const User = mongoose.model('User', userSchema);

const vaultSchema = new mongoose.Schema({ 
    id: { type: String, default: 'protocol_vault' }, 
    balance: { type: Number, default: 0 }, 
    totalAfroMinted: { type: Number, default: 0 },
    platformAfroReserve: { type: Number, default: 0 } 
});
const Vault = mongoose.model('Vault', vaultSchema);

const transactionSchema = new mongoose.Schema({
    checkoutID: { type: String, unique: true },
    postID: String,
    userPhone: String,
    amountPaid: Number, 
    currency: { type: String, default: 'KES' }, 
    gateway: { type: String, default: 'mpesa' }, 
    type: { type: String, enum: ['unlock', 'license', 'share_download'] }, 
    status: { type: String, default: 'pending' }, 
    timestamp: { type: Number, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

const handshakeSchema = new mongoose.Schema({
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, 
    sender: String,
    target: String,
    split: Number,
    signature: String, 
    contractHash: String,
    status: { type: String, default: 'pending', enum: ['pending', 'accepted', 'rejected', 'countered'] }, 
    timestamp: { type: Number, default: Date.now }
});
const Handshake = mongoose.model('Handshake', handshakeSchema);

// 5. HELPERS
const cleanPhone = (phone) => {
    if(!phone) return "";
    let cleaned = phone.toString().replace(/\D/g, ''); 
    if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1);
    return cleaned; 
};

const calculateLiveTax = async () => {
    const nodeCount = await User.countDocuments({});
    const dynamicModifier = Math.log10(nodeCount + 10);
    const liveRate = PROTOCOL_FEE / dynamicModifier;
    return Math.max(0.01, liveRate); 
};

const governAfroMinting = async (requestedAmount) => {
    const vault = await Vault.findOneAndUpdate({ id: 'protocol_vault' }, {}, { upsert: true, new: true });
    const rewardAmount = requestedAmount * MINTING_REWARD_RATE;
    const userRewardTotal = rewardAmount * 2; 
    const totalNewMint = userRewardTotal / (1 - PLATFORM_RESERVE_SHARE);
    const platformShare = totalNewMint * PLATFORM_RESERVE_SHARE;
    if (vault.totalAfroMinted + totalNewMint > AFRO_HARD_CAP) return { user: 0, platform: 0 };
    await Vault.updateOne({ id: 'protocol_vault' }, { $inc: { totalAfroMinted: totalNewMint, platformAfroReserve: platformShare } });
    return { user: rewardAmount, platform: platformShare };
};

const CURRENCY_MAP = {
    '254': { code: 'KES', rate: 1 },
    '256': { code: 'UGX', rate: 30 }, 
    '255': { code: 'TZS', rate: 20 }, 
    '234': { code: 'NGN', rate: 11 }  
};

const getCurrencyByPhone = (phone) => {
    for (let prefix in CURRENCY_MAP) {
        if (phone.startsWith(prefix)) return CURRENCY_MAP[prefix];
    }
    return CURRENCY_MAP['254'];
};

const triggerUniversalPush = async (phone, amountInKES, postId, type) => {
    const formattedPhone = cleanPhone(phone);
    const currencyData = getCurrencyByPhone(formattedPhone);
    const convertedAmount = Math.ceil(amountInKES * currencyData.rate);
    
    if (formattedPhone.startsWith('254')) {
        return await triggerStkPush(formattedPhone, convertedAmount, postId, type);
    } 
    return await triggerFlutterwavePush(formattedPhone, convertedAmount, currencyData.code, postId, type);
};

const getMpesaToken = async () => {
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
        headers: { Authorization: `Basic ${auth}` }
    });
    return res.data.access_token;
};

const triggerStkPush = async (phone, amount, postId, type) => {
    const token = await getMpesaToken();
    const date = new Date();
    const timestamp = date.getFullYear() + ("0" + (date.getMonth() + 1)).slice(-2) + ("0" + date.getDate()).slice(-2) + ("0" + date.getHours()).slice(-2) + ("0" + date.getMinutes()).slice(-2) + ("0" + date.getSeconds()).slice(-2);
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
    
    const payload = {
        "BusinessShortCode": process.env.MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": Math.ceil(amount),
        "PartyA": phone,
        "PartyB": process.env.MPESA_SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": process.env.MPESA_CALLBACK_URL,
        "AccountReference": `IP${postId.toString().slice(-8).toUpperCase()}`,
        "TransactionDesc": `iNFLUENSA ${type.toUpperCase()}`
    };

    const response = await axios.post("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest", payload, { 
        headers: { 'Authorization': `Bearer ${token}` } 
    });

    await Transaction.create({
        checkoutID: response.data.CheckoutRequestID,
        postID: postId, userPhone: phone, amountPaid: amount, type, gateway: 'mpesa', currency: 'KES'
    });
    return response.data;
};

const triggerFlutterwavePush = async (phone, amount, currency, postId, type) => {
    const tx_ref = `FLW-${Date.now()}-${postId.toString().slice(-4)}`;
    let network = "MTN"; 
    if(phone.startsWith('255')) network = "TIGO";
    if(phone.startsWith('234')) network = "NQR";

    const payload = {
        tx_ref, amount, currency, network,
        email: "node@influensa.io",
        phone_number: phone,
        fullname: "iNFLUENSA Node",
        callback_url: process.env.FLW_CALLBACK_URL
    };

    const response = await axios.post("https://api.flutterwave.com/v3/charges?type=mobile_money_uganda", payload, {
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        timeout: 15000 
    });

    await Transaction.create({
        checkoutID: tx_ref, 
        postID: postId, userPhone: phone, amountPaid: amount, type, gateway: 'flutterwave', currency
    });

    return { CheckoutRequestID: tx_ref }; 
};

// 6. REAL-TIME SOCKET LOGIC
io.on('connection', (socket) => {
    socket.on('join_payment_room', (checkoutID) => socket.join(checkoutID));
    
    socket.on('watch_post', (postId) => {
        socket.join(`viewers_${postId}`);
        const viewerCount = io.sockets.adapter.rooms.get(`viewers_${postId}`)?.size || 0;
        io.to(`viewers_${postId}`).emit('viewer_update', { postId, count: viewerCount });
    });

    socket.on('leave_post', (postId) => {
        socket.leave(`viewers_${postId}`);
        const viewerCount = io.sockets.adapter.rooms.get(`viewers_${postId}`)?.size || 0;
        io.to(`viewers_${postId}`).emit('viewer_update', { postId, count: viewerCount });
    });

    socket.on('disconnecting', () => {
        for (const room of socket.rooms) {
            if (room.startsWith('viewers_')) {
                const postId = room.replace('viewers_', '');
                setTimeout(() => {
                    const count = io.sockets.adapter.rooms.get(room)?.size || 0;
                    io.to(room).emit('viewer_update', { postId, count });
                }, 100);
            }
        }
    });
});

// 7. ROUTES

// --- HEALTH SENTRY ENDPOINT ---
app.get('/api/health', async (req, res) => {
    const healthData = {
        status: 'SIGNAL_STRONG',
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        grid: {
            database: mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED',
            socket_nodes: io.sockets.adapter.rooms.size
        }
    };
    if (mongoose.connection.readyState !== 1) return res.status(503).json(healthData);
    res.status(200).json(healthData);
});

app.post('/api/flw-webhook', async (req, res) => {
    const secretHash = process.env.FLW_HASH;
    const signature = req.headers["verif-hash"];
    if (!signature || signature !== secretHash) return res.status(401).end();

    const { status, tx_ref } = req.body.data;
    const tx = await Transaction.findOne({ checkoutID: tx_ref });
    if (!tx) return res.status(200).end();

    if (status === "successful") {
        await processGridSuccess(tx);
    } else {
        tx.status = 'failed';
        await tx.save();
        io.to(tx_ref).emit('payment_failed');
    }
    res.status(200).end();
});

// --- UPDATED PROCESS GRID SUCCESS WITH 7.89% SOVEREIGN TAX ---
const processGridSuccess = async (tx) => {
    if (tx.status === 'completed') return; 

    const post = await Post.findById(tx.postID);
    
    // --- THE SOVEREIGN TAX CALCULATION ---
    const PLATFORM_TAX_RATE = 0.0789; // Your 7.89%
    const platformFee = tx.amountPaid * PLATFORM_TAX_RATE;
    const netPayout = tx.amountPaid - platformFee;

    // Optional: Keep Afro Coin rewards logic
    const mintResults = await governAfroMinting(tx.amountPaid);
    const reward = mintResults.user;

    await User.findOneAndUpdate({ identity: tx.userPhone }, { lastSeen: Date.now() }, { upsert: true });
    
    // 1. Move the 7.89% to the Protocol Vault (Your Money)
    await Vault.findOneAndUpdate(
        { id: 'protocol_vault' }, 
        { $inc: { balance: platformFee } }, 
        { upsert: true }
    );
    
    // Reward user with Afro Coins
    await User.findOneAndUpdate({ identity: tx.userPhone }, { $inc: { afroCoins: reward } });
    
    // 2. Handle Creator & Collaborator Payouts
    if (post) {
        if (post.collaborators && post.collaborators.length > 0) {
            let totalCollaboratorShare = 0;
            for (let colab of post.collaborators) {
                const colabEarnings = netPayout * (colab.split / 100);
                await User.findOneAndUpdate({ identity: colab.node }, { $inc: { earnings: colabEarnings } });
                totalCollaboratorShare += colabEarnings;
            }
            const ownerEarnings = netPayout - totalCollaboratorShare;
            await User.findOneAndUpdate({ identity: post.owner }, { $inc: { afroCoins: reward, earnings: ownerEarnings } });
        } else {
            // No collaborators: Owner gets the full Net (92.11%)
            await User.findOneAndUpdate({ identity: post.owner }, { $inc: { afroCoins: reward, earnings: netPayout } });
        }
    }

    const updateField = tx.type === 'license' ? { $addToSet: { licensed_to: tx.userPhone } } : { $addToSet: { unlocked_by: tx.userPhone } };
    await Post.findByIdAndUpdate(tx.postID, updateField);

    // 3. Mark transaction as done and notify the App
    tx.status = 'completed';
    await tx.save();
    io.to(tx.checkoutID).emit('payment_success', { message: "Nodal Sync Confirmed", netAmount: netPayout, txType: tx.type });
};

app.post('/api/callback', async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const checkoutID = callbackData.CheckoutRequestID;
    try {
        const tx = await Transaction.findOne({ checkoutID });
        if (!tx) return res.json({ ResultCode: 0 }); 
        if (callbackData.ResultCode === 0) {
            await processGridSuccess(tx);
        } else { 
            tx.status = 'failed';
            await tx.save();
            io.to(checkoutID).emit('payment_failed');
        }
        res.json({ ResultCode: 0 });
    } catch (err) { res.json({ ResultCode: 1 }); }
});

app.post('/api/posts/:id/unlock', async (req, res) => {
    const { phone, type } = req.body; 
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: "IP not found" });
        let rawPriceKES = (type === 'share_download' || type === 'license') ? post.price * 0.5 : post.price;
        const result = await triggerUniversalPush(phone, Math.max(1, Math.ceil(rawPriceKES)), post._id, type || 'unlock');
        res.json({ success: true, checkoutID: result.CheckoutRequestID });
    } catch (err) { res.status(500).json({ error: "Universal Sync Failed" }); }
});

app.post('/api/nodes/withdraw', async (req, res) => {
    const { identity, amount } = req.body;
    const cleaned = cleanPhone(identity);
    try {
        const user = await User.findOne({ identity: cleaned });
        if (!user || user.earnings < amount) {
            return res.status(400).json({ error: "INSUFFICIENT_NODAL_BALANCE" });
        }
        if (amount < 10) return res.status(400).json({ error: "BELOW_MINIMUM" });

        const config = getCurrencyByPhone(cleaned);
        const payload = {
            "account_bank": "MPS", 
            "account_number": cleaned,
            "amount": amount,
            "currency": config.code,
            "narration": "iNFLUENSA_NODE_PAYOUT",
            "reference": `WD-${Date.now()}-${cleaned.slice(-4)}`
        };

        const response = await axios.post("https://api.flutterwave.com/v3/transfers", payload, {
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
            timeout: 15000 
        });

        if (response.data.status === "success") {
            await User.findOneAndUpdate({ identity: cleaned }, { $inc: { earnings: -amount } });
            res.json({ success: true, message: "Sync Outbound Success", data: response.data.data });
        } else {
            res.status(500).json({ error: "GATEWAY_TRANSFER_FAILED" });
        }
    } catch (err) { res.status(500).json({ error: "Neural Withdrawal Error" }); }
});

app.post('/api/posts', upload.single('file'), async (req, res) => {
    try {
        const { title, price, owner, scarcity_limit } = req.body;
        if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });
        
        const cid = crypto.createHash('sha256').update(title + owner + Date.now()).digest('hex');
        const post = await Post.create({ 
            title, price, owner: cleanPhone(owner), 
            mime: req.file.mimetype, filename: req.file.filename, 
            cid, scarcity_limit: scarcity_limit || 0, is_stream: false
        });
        res.status(201).json(post);
    } catch (err) { res.status(500).json({ error: "Post Sync Failed" }); }
});

app.post('/api/posts/stream', async (req, res) => {
    try {
        const { title, price, owner, stream_url, scarcity_limit } = req.body;
        const cid = crypto.createHash('sha256').update(title + stream_url + Date.now()).digest('hex');
        const post = await Post.create({ title: title || "Live Stream", price: price || 0, owner: cleanPhone(owner), mime: "video/stream", cid, scarcity_limit: scarcity_limit || 0, is_stream: true, stream_url: stream_url.trim() });
        res.status(201).json(post);
    } catch (err) { res.status(500).json({ error: "Stream Sync Failed" }); }
});

app.get('/api/handshake/outgoing/:identity', async (req, res) => {
    try {
        const identity = cleanPhone(req.params.identity);
        const updates = await Handshake.find({ sender: identity }).sort({ timestamp: -1 }).limit(10);
        res.json(updates);
    } catch (err) { res.status(500).json({ error: "Status Pulse Failed" }); }
});

app.post('/api/handshake/counter/:id', async (req, res) => {
    try {
        const { split } = req.body;
        await Handshake.findByIdAndUpdate(req.params.id, { split, status: 'countered', timestamp: Date.now() });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Negotiation Sync Failed" }); }
});

app.get('/api/handshake/pulse/:identity', async (req, res) => {
    try {
        const identity = cleanPhone(req.params.identity);
        const count = await Handshake.countDocuments({ target: identity, status: 'pending' });
        res.json({ active: count > 0, count });
    } catch (err) { res.status(500).json({ error: "Pulse Sync Failed" }); }
});

app.post('/api/handshake/offer', async (req, res) => {
    try {
        const { postId, sender, split, signature, contractHash } = req.body;
        const post = await Post.findById(postId);
        const handshake = await Handshake.create({ postId, sender: cleanPhone(sender), target: post.owner, split, signature, contractHash });
        res.status(201).json(handshake);
    } catch (err) { res.status(500).json({ error: "Neural Signature Failed" }); }
});

app.get('/api/handshake/pending/:identity', async (req, res) => {
    try {
        const identity = cleanPhone(req.params.identity);
        const offers = await Handshake.find({ target: identity, status: 'pending' }).populate('postId');
        res.json(offers);
    } catch (err) { res.status(500).json({ error: "Neural Retrieval Error" }); }
});

app.post('/api/handshake/accept/:id', async (req, res) => {
    try {
        const handshake = await Handshake.findById(req.params.id);
        await Post.findByIdAndUpdate(handshake.postId, { $push: { collaborators: { node: handshake.sender, signature: handshake.signature, split: handshake.split, contractHash: handshake.contractHash, signedAt: Date.now() } } });
        handshake.status = 'accepted'; await handshake.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Handshake Sync Failure" }); }
});

app.post('/api/handshake/reject/:id', async (req, res) => {
    try {
        const handshake = await Handshake.findById(req.params.id);
        handshake.status = 'rejected'; await handshake.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Rejection Sync Failure" }); }
});

app.post('/api/nodes/connect', async (req, res) => {
    const { identity } = req.body;
    try {
        const user = await User.findOneAndUpdate({ identity: cleanPhone(identity) }, { lastSeen: Date.now() }, { upsert: true, new: true });
        const nodeCount = await User.countDocuments({}); 
        res.json({ success: true, nodeCount, user });
    } catch (err) { res.status(500).json({ error: "Sync Failure" }); }
});

app.get('/api/stk-status/:checkoutID', async (req, res) => {
    try {
        const tx = await Transaction.findOne({ checkoutID: req.params.checkoutID });
        res.json({ status: tx ? tx.status : 'not_found' });
    } catch (err) { res.status(500).json({ error: "Polling failed" }); }
});

app.get('/api/media/:postId', async (req, res) => {
    try {
        const { phone } = req.query;
        const post = await Post.findOne({ _id: req.params.postId, is_burned: false });
        if (!post) return res.status(404).send("NOT_FOUND");
        
        const cleaned = cleanPhone(phone);
        const hasAccess = post.owner === cleaned || post.unlocked_by.includes(cleaned) || post.licensed_to.includes(cleaned);
        if (!hasAccess) return res.status(403).send("LOCKED");
        if (post.is_stream) return res.redirect(post.stream_url);

        const filePath = path.join(uploadDir, post.filename);

        if (post.mime.startsWith('image/')) {
            const image = await Jimp.read(filePath);
            const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
            image.print(font, 10, 10, `IP:${post.cid.slice(0,8)} | NODE:${cleaned}`);
            const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
            return res.type('image/jpeg').send(buffer);
        }

        res.sendFile(filePath);
    } catch (err) { res.status(500).send("GRID_ERROR"); }
});

// --- UPDATED GOVERNANCE SIDEBAR WITH LEDGER SUPPORT ---
app.get('/api/governance/sidebar', async (req, res) => {
    try {
        const vault = await Vault.findOne({ id: 'protocol_vault' });
        const nodes = await User.countDocuments({});
        const activeIPs = await Post.countDocuments({ is_burned: false });
        // Return 7.89 as the standard display for your ledger
        res.json({ 
            nodes, 
            activeIPs, 
            vaultBalance: vault ? vault.balance.toFixed(2) : "0.00", 
            liveTax: "7.89" 
        });
    } catch (err) { res.status(500).json({ error: "Governance Offline" }); }
});

// --- NEW LEDGER ROUTE FOR VISUAL TRACKING ---
app.get('/api/governance/ledger', async (req, res) => {
    try {
        const transactions = await Transaction.find({ status: 'completed' })
            .sort({ timestamp: -1 })
            .limit(50);
        
        const ledger = transactions.map(tx => ({
            id: tx.checkoutID,
            amount: tx.amountPaid,
            taxCollected: (tx.amountPaid * 0.0789).toFixed(2),
            timestamp: tx.timestamp,
            type: tx.type
        }));
        
        res.json(ledger);
    } catch (err) { res.status(500).json({ error: "Ledger Sync Failed" }); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const vault = await Vault.findOne({ id: 'protocol_vault' });
        const userCount = await User.countDocuments({});
        const currentLiveRate = await calculateLiveTax();
        res.json({ taxVault: vault ? (vault.balance || 0).toFixed(2) : "0.00", userCount: userCount, platformReserve: vault ? (vault.platformAfroReserve || 0).toFixed(2) : "0.00", currentTaxRate: (currentLiveRate * 100).toFixed(2) + "%" });
    } catch (err) { res.status(500).json({ error: "Stats failure" }); }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const posts = await Post.find({ is_burned: false, $or: [{ title: { $regex: q, $options: 'i' } }, { owner: { $regex: q, $options: 'i' } }, { cid: { $regex: q, $options: 'i' } }] }).sort({ timestamp: -1 });
        res.json(posts);
    } catch (err) { res.status(500).json({ error: "Search logic failure" }); }
});

app.get('/api/posts', async (req, res) => {
    const posts = await Post.find({ is_burned: false }).sort({ timestamp: -1 });
    res.json(posts);
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        await Post.findByIdAndUpdate(req.params.id, { is_burned: true });
        res.sendStatus(200);
    } catch (err) { res.status(500).json({ error: "Burn failed" }); }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', async () => {
    await launchProtocol();
    console.log(`🚀 MASTER GRID ACTIVE | PORT: ${PORT}`);
});
