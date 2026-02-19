const express    = require('express');
const puppeteer  = require('puppeteer');
const cors       = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Cópia Autenticada ® Screenshot API', version: '1.0' });
});

app.get('/screenshot', async (req, res) => {
    const { url, width = '1366', height = '768', delay = '2000', full = 'false' } = req.query;

    if (!url) return res.status(400).json({ error: 'Parametro url obrigatorio' });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: parseInt(width), height: parseInt(height), deviceScaleFactor: 1 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        if (parseInt(delay) > 0) await new Promise(r => setTimeout(r, parseInt(delay)));

        const screenshot = await page.screenshot({
            type: 'png',
            fullPage: full === 'true',
            clip: full === 'true' ? undefined : { x: 0, y: 0, width: parseInt(width), height: parseInt(height) }
        });

        await browser.close();

        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.send(screenshot);

    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
