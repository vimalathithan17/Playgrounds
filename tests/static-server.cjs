#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const port = process.env.PORT || 5173;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.cjs': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
    }[ext] || 'application/octet-stream'
  );
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Static server running at http://localhost:${port}`);
});
