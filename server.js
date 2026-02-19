const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND = 'https://copia-autenticada-api.onrender.com';

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'ok', version: '2.0', service: 'Copia Autenticada API' });
});

app.get('/proxy', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('url obrigatorio');

    let target;
    try { target = new URL(url); } catch { return res.status(400).send('URL invalida'); }

    const lib = target.protocol === 'https:' ? https : http;
    const opts = {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Accept-Encoding': 'identity'
        },
        timeout: 20000,
        rejectUnauthorized: false
    };

    const pr = lib.request(opts, (upstream) => {
        const ct = upstream.headers['content-type'] || '';
        const loc = upstream.headers['location'];

        if ([301,302,303,307,308].includes(upstream.statusCode) && loc) {
            let next;
            try { next = new URL(loc, target.origin).href; } catch { next = loc; }
            return res.redirect(`/proxy?url=${encodeURIComponent(next)}`);
        }

        if (!ct.includes('text/html')) {
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Content-Type', ct);
            return upstream.pipe(res);
        }

        let html = '';
        upstream.setEncoding('utf8');
        upstream.on('data', d => html += d);
        upstream.on('end', () => {
            const base = target.origin;
            html = html.replace(/<base[^>]*>/gi, '');
            html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">`);
            html = html.replace(/(href|src|action)=["']([^"'#][^"']*)["']/gi, (m, attr, val) => {
                if (/^(javascript:|data:|mailto:|tel:|#)/i.test(val)) return m;
                try {
                    const abs = new URL(val, base).href;
                    if (!abs.startsWith('http') || abs.includes('/proxy?url=')) return m;
                    if (attr === 'href') return `${attr}="${BACKEND}/proxy?url=${encodeURIComponent(abs)}"`;
                    return `${attr}="${abs}"`;
                } catch { return m; }
            });
            const inj = `<script>(function(){try{window.parent.postMessage({type:'NAV',url:window.location.href},'*');}catch(e){}})();<\/script>`;
            html = html.replace('</body>', inj + '</body>');
            res.set({
                'Content-Type': 'text/html; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'X-Frame-Options': 'ALLOWALL',
                'Content-Security-Policy': ''
            });
            res.send(html);
        });
    });

    pr.on('error', err => res.status(502).send(`Erro: ${err.message}`));
    pr.on('timeout', () => { pr.destroy(); res.status(504).send('Timeout'); });
    pr.end();
});

app.get('/screenshot', async (req, res) => {
    const { url, width = '1366', height = '768', delay = '2000', full = 'false' } = req.query;
    if (!url) return res.status(400).json({ error: 'url obrigatorio' });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
                   '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
                   '--single-process','--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: parseInt(width), height: parseInt(height), deviceScaleFactor: 1 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        if (parseInt(delay) > 0) await new Promise(r => setTimeout(r, parseInt(delay)));
        const shot = await page.screenshot({
            type: 'png',
            fullPage: full === 'true',
            clip: full === 'true' ? undefined : { x:0, y:0, width:parseInt(width), height:parseInt(height) }
        });
        await browser.close();
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.send(shot);
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Copia Autenticada API v2.0 porta ${PORT}`));
