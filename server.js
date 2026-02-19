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
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-gpu',
            '--no-first-run', '--no-zygote', '--single-process',
            '--disable-features=VizDisplayCompositor',
            '--disable-blink-features=AutomationControlled',
            '--memory-pressure-off',
            '--js-flags=--max-old-space-size=256',
            '--aggressive-cache-discard',
            '--disable-cache',
            '--disable-extensions'
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
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const session = { browser, page, url: '' };
    sessions.set(sid, session);
    session.timer = setTimeout(() => closeSession(sid), 15 * 60 * 1000);
    return session;
}

function resetTimer(sid) {
    const s = sessions.get(sid);
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => closeSession(sid), 15 * 60 * 1000);
}

async function closeSession(sid) {
    const s = sessions.get(sid);
    if (s) { try { await s.browser.close(); } catch {} sessions.delete(sid); }
}

async function snap(page) {
    return page.screenshot({ type: 'jpeg', quality: 65,
        clip: { x: 0, y: 0, width: 1280, height: 720 } });
}

async function isBrowserAlive(s) {
    try { await s.page.evaluate(() => true); return true; } catch { return false; }
}

async function smartWait(page, ms = 3000) {
    try {
        await Promise.race([
            page.waitForNetworkIdle({ idleTime: 800, timeout: ms }),
            new Promise(r => setTimeout(r, ms))
        ]);
    } catch { await new Promise(r => setTimeout(r, 500)); }
}

app.get('/', (req, res) => res.json({ status: 'ok', version: '3.4', sessions: sessions.size }));

app.get('/navigate', async (req, res) => {
    const { sid = 'default', url } = req.query;
    if (!url) return res.status(400).json({ error: 'url obrigatorio' });
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        let navUrl = url;
        if (!navUrl.startsWith('http')) navUrl = 'https://' + navUrl;
        const isHeavyApp = /whatsapp|gmail|outlook|teams|slack/i.test(navUrl);
        try {
            await s.page.goto(navUrl, { waitUntil: isHeavyApp ? 'domcontentloaded' : 'networkidle2', timeout: 30000 });
        } catch { console.log('navigate timeout, screenshot do estado atual'); }
        await smartWait(s.page, isHeavyApp ? 5000 : 2000);
        s.url = s.page.url();
        const title = await s.page.title().catch(() => '');
        const img   = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'X-Page-Url': encodeURIComponent(s.url), 'X-Page-Title': encodeURIComponent(title), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Page-Url, X-Page-Title' });
        res.send(img);
    } catch (err) { console.error('/navigate error:', err.message); res.status(500).json({ error: err.message }); }
});

app.get('/screenshot', async (req, res) => {
    const { sid = 'default', url } = req.query;
    try {
        if (url) {
            const browser = await launchBrowser();
            const page    = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await smartWait(page, 2000);
            const shot = await page.screenshot({ type: 'png' });
            await browser.close();
            res.set({ 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
            return res.send(shot);
        }
        const s = await getSession(sid);
        resetTimer(sid);
        const alive = await isBrowserAlive(s);
        if (!alive) {
            sessions.delete(sid);
            return res.status(503).json({ error: 'session_crashed', message: 'Browser crashou por falta de memória.' });
        }
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/refresh', async (req, res) => {
    const { sid = 'default', wait = 3000 } = req.query;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        await smartWait(s.page, parseInt(wait));
        s.url = s.page.url();
        const title = await s.page.title().catch(() => '');
        const img   = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'X-Page-Url': encodeURIComponent(s.url), 'X-Page-Title': encodeURIComponent(title), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Page-Url, X-Page-Title' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/click', async (req, res) => {
    const { sid = 'default', x, y } = req.body;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        await s.page.mouse.click(x, y);
        await smartWait(s.page, 1500);
        s.url = s.page.url();
        const title = await s.page.title().catch(() => '');
        const img   = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'X-Page-Url': encodeURIComponent(s.url), 'X-Page-Title': encodeURIComponent(title), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Page-Url, X-Page-Title' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/scroll', async (req, res) => {
    const { sid = 'default', deltaY = 300 } = req.body;
    try {
        const s = await getSession(sid);
        resetTimer(sid);
        await s.page.evaluate((dy) => window.scrollBy(0, dy), deltaY);
        await new Promise(r => setTimeout(r, 400));
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
        await s.page.keyboard.type(text, { delay: 40 });
        await new Promise(r => setTimeout(r, 600));
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
            await s.page.keyboard.down(parts[0]);
            await s.page.keyboard.press(parts[1]);
            await s.page.keyboard.up(parts[0]);
        } else { await s.page.keyboard.press(key); }
        await smartWait(s.page, 1500);
        s.url = s.page.url();
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'X-Page-Url': encodeURIComponent(s.url), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Page-Url' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/back', async (req, res) => {
    const { sid = 'default' } = req.body;
    try {
        const s = await getSession(sid);
        await s.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await smartWait(s.page, 1500);
        s.url = s.page.url();
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'X-Page-Url': encodeURIComponent(s.url), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Page-Url' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/forward', async (req, res) => {
    const { sid = 'default' } = req.body;
    try {
        const s = await getSession(sid);
        await s.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await smartWait(s.page, 1500);
        s.url = s.page.url();
        const img = await snap(s.page);
        res.set({ 'Content-Type': 'image/jpeg', 'X-Page-Url': encodeURIComponent(s.url), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Page-Url' });
        res.send(img);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Copia Autenticada API v3.4 porta ${PORT}`));
