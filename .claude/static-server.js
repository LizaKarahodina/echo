const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = 8934;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const filePath = path.join(root, urlPath === '/' ? '/echo-prototype.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: any unrecognized path (e.g. OAuth/magic-link redirects
      // carrying ?code=... or ?token_hash=... query params) still serves the app,
      // since routing/session handling happens client-side.
      fs.readFile(path.join(root, '/echo-prototype.html'), (fallbackErr, fallbackData) => {
        if (fallbackErr) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fallbackData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('listening on', port));
