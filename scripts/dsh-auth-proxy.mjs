// DSH 公网入口的认证代理：Basic Auth + WebSocket 透传
// 监听 127.0.0.1:3081 → 转发到 127.0.0.1:3080
// 用法：node dsh-auth-proxy.mjs <username> <password> [listenPort] [targetPort]

import http from 'node:http';
import net from 'node:net';

const [, , userArg, passArg, listenArg = '3081', targetArg = '3080'] = process.argv;
if (!userArg || !passArg) {
  console.error('用法: node dsh-auth-proxy.mjs <username> <password> [listenPort] [targetPort]');
  process.exit(1);
}

const USER = userArg;
const PASS = passArg;
const LISTEN_PORT = Number(listenArg);
const TARGET_PORT = Number(targetArg);
const TARGET_HOST = '127.0.0.1';

const expected = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

function authorized(req) {
  const h = req.headers.authorization ?? '';
  // 定长比较，避免时序侧信道
  const a = Buffer.from(h);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function deny(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="DSH", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('需要账号密码\n');
}

const server = http.createServer((req, res) => {
  if (!authorized(req)) return deny(res);

  const proxyReq = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`上游不可达: ${err.message}\n`);
  });
  req.pipe(proxyReq);
});

// WebSocket / 其它 upgrade 透传
server.on('upgrade', (req, socket, head) => {
  if (!authorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="DSH"\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`auth-proxy: http://127.0.0.1:${LISTEN_PORT} -> 127.0.0.1:${TARGET_PORT} (user=${USER})`);
});
