const express   = require('express');
const puppeteer = require('puppeteer');
const cors      = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = new Map();

async function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-gpu',
            '--no-first-run', '--no-zygote', '--single-process',
            '--disable-features=VizDisplayCompositor'
        ]
    });
}

async function getSession(sid) {
    if (sessions.has(sid)) {
        const s = sessions.get(sid);
        try { await s.page.title(); return s; } catch { sessions.delete(sid); }
    }
    const browser = await launchBrowser();
    const page    = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    const session = { browser, page, url: '' };
    sessions.set(sid, session);
    session.timer = setTimeout(() => closeSession(sid), 10 * 60 * 1000);
    return session;
}

function resetTimer(sid) {
    const s = sessions.get(sid);
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => closeSession(sid), 10 * 60 * 1000);
}

async function closeSession(sid) {
    const s = sessions.get(sid);
    if (s) { try { await s.browser.close(); } catch {} sessions.delete(sid); }
}

async function snap(page) {
    return page.screenshot({ type: 'jpeg', quality: 85,
        clip: { x: 0, y: 0, width: 1366, height: 768 } });
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', version: '3.1', sessions: sessions.size });
});

app.get('/navigate', async (req, res) => {
    const { sid = 'default', url } = req.query;
    if (!url) return res.status(400).json({ error: 'url obrigatorio' });
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        let navUrl = url;
        if (!navUrl.startsWith('http')) navUrl = 'https://' + navUrl;
        await s.page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));
        s.url = s.page.url();
        const title = await s.page.title().catch(() => '');
        const img   = await snap(s.page);
        res.set({
            'Content-Type': 'image/jpeg',
            'X-Page-Url': encodeURIComponent(s.url),
            'X-Page-Title': encodeURIComponent(title),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Page-Url, X-Page-Title'
        });
        res.send(img);
    } catch (err) {
        console.error('/navigate error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/screenshot', async (req, res) => {
    const { sid = 'default', url } = req.query;
    try {
        if (url) {
            const browser = await launchBrowser();
            const page    = await browser.newPage();
            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));
            const shot = await page.screenshot({ type: 'png' });
            await browser.close();
            res.set({ 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
            return res.send(shot);
        }
        const s   = await getSession(sid);
        resetTimer(sid);
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
        res.send(img);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/click', async (req, res) => {
    const { sid = 'default', x, y } = req.body;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        await s.page.mouse.click(x, y);
        await new Promise(r => setTimeout(r, 1500));
        s.url = s.page.url();
        const title = await s.page.title().catch(() => '');
        const img   = await snap(s.page);
        res.set({
            'Content-Type': 'image/jpeg',
            'X-Page-Url': encodeURIComponent(s.url),
            'X-Page-Title': encodeURIComponent(title),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Page-Url, X-Page-Title'
        });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/scroll', async (req, res) => {
    const { sid = 'default', deltaY = 300 } = req.body;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        await s.page.evaluate((dy) => window.scrollBy(0, dy), deltaY);
        await new Promise(r => setTimeout(r, 500));
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/type', async (req, res) => {
    const { sid = 'default', text = '' } = req.body;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        await s.page.keyboard.type(text, { delay: 50 });
        await new Promise(r => setTimeout(r, 800));
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/key', async (req, res) => {
    const { sid = 'default', key = 'Enter' } = req.body;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        if (key.includes('+')) {
            const parts = key.split('+');
            const mod   = parts[0];
            const k     = parts[1];
            await s.page.keyboard.down(mod);
            await s.page.keyboard.press(k);
            await s.page.keyboard.up(mod);
        } else {
            await s.page.keyboard.press(key);
        }
        await new Promise(r => setTimeout(r, 1200));
        s.url = s.page.url();
        const img = await snap(s.page);
        res.set({
            'Content-Type': 'image/jpeg',
            'X-Page-Url': encodeURIComponent(s.url),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Page-Url'
        });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/back', async (req, res) => {
    const { sid = 'default' } = req.body;
    try {
        const s = await getSession(sid);
        await s.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));
        s.url = s.page.url();
        const img = await snap(s.page);
        res.set({
            'Content-Type': 'image/jpeg',
            'X-Page-Url': encodeURIComponent(s.url),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Page-Url'
        });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/forward', async (req, res) => {
    const { sid = 'default' } = req.body;
    try {
        const s = await getSession(sid);
        await s.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));
        s.url = s.page.url();
        const img = await snap(s.page);
        res.set({
            'Content-Type': 'image/jpeg',
            'X-Page-Url': encodeURIComponent(s.url),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Page-Url'
        });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Copia Autenticada API v3.1 porta ${PORT}`));
