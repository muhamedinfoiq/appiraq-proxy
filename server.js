const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();

// Enable CORS for all domains
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: '*'
}));

app.get('/', (req, res) => {
  res.send('Appiraq Stream Relay Proxy is Active and Running! 🚀');
});

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url query parameter.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return res.status(400).send('Invalid url format.');
  }

  const client = parsedUrl.protocol === 'https:' ? https : http;

  const requestOptions = {
    headers: {
      'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    },
    timeout: 10000
  };

  const proxyReq = client.get(targetUrl, requestOptions, (proxyRes) => {
    // Follow 301 / 302 / 307 / 308 redirects automatically
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let redirectTarget = proxyRes.headers.location;
      if (!redirectTarget.startsWith('http')) {
        redirectTarget = new URL(redirectTarget, parsedUrl).href;
      }
      return res.redirect(`/proxy?url=${encodeURIComponent(redirectTarget)}`);
    }

    const contentType = proxyRes.headers['content-type'] || '';
    const isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8');

    if (isM3u8) {
      let bodyData = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => bodyData += chunk);
      proxyRes.on('end', () => {
        const host = req.get('host');
        const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const proxyBase = `${proto}://${host}/proxy?url=`;

        const lines = bodyData.split('\n');
        const rewritten = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;

          let absoluteChunkUrl = trimmed;
          if (!trimmed.startsWith('http')) {
            absoluteChunkUrl = new URL(trimmed, parsedUrl).href;
          }

          return `${proxyBase}${encodeURIComponent(absoluteChunkUrl)}`;
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.send(rewritten);
      });
      return;
    }

    // Stream TS chunks or video binaries
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache, no-store'
    });

    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).send('Stream gateway timeout.');
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).send('Proxy Stream Error: ' + err.message);
    }
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Stream Proxy running on port ${PORT}`);
});
