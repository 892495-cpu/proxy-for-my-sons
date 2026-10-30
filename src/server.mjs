import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { connect as connectTls } from 'node:tls';
import { Readable } from 'node:stream';

const origin = new URL('https://web.cloudmoonapp.com');
const username = process.env.PROXY_USERNAME ?? 'shayan daddy';
const password = process.env.PROXY_PASSWORD ?? 'iamshayansson';
const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const sessionSecret = process.env.PROXY_SESSION_SECRET ?? password;
const sessionCookie = 'shayans_session';
const sessionDuration = 8 * 60 * 60 * 1000;
const expectedUsername = Buffer.from(username);
const expectedPassword = Buffer.from(password);

function safeEqual(value, expected) {
  const provided = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

function sessionSignature(expires) {
  return createHmac('sha256', sessionSecret).update(expires).digest('base64url');
}

function isAuthenticated(request) {
  const cookie = request.headers.cookie?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`));
  if (!cookie) return false;

  const [expires, signature] = cookie.slice(sessionCookie.length + 1).split('.');
  if (!expires || !signature || Number(expires) <= Date.now()) return false;
  return safeEqual(signature, sessionSignature(expires));
}

function getTarget(request) {
  const incoming = new URL(request.url ?? '/', 'http://proxy.local');
  const upstreamPath = incoming.pathname === '/cloudmoon'
    ? '/'
    : incoming.pathname.startsWith('/cloudmoon/')
      ? incoming.pathname.slice('/cloudmoon'.length)
      : incoming.pathname;
  return new URL(`${upstreamPath}${incoming.search}`, origin);
}

function hopByHopHeaders(headers) {
  const names = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);
  for (const token of (headers.connection ?? '').split(',')) {
    if (token.trim()) names.add(token.trim().toLowerCase());
  }
  return names;
}

function secureCookie(request) {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim();
  return forwardedProtocol === 'https';
}

function sessionCookieHeader(request, value, maxAge) {
  const secure = secureCookie(request) ? '; Secure' : '';
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function servePage(response, fileName) {
  const page = await readFile(new URL(`./${fileName}`, import.meta.url));
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(page);
}

function rewriteResponseHeaders(upstreamHeaders, requestPath) {
  const output = {};
  const blocked = hopByHopHeaders(Object.fromEntries(upstreamHeaders.entries()));
  const proxyPrefix = requestPath === '/cloudmoon' || requestPath.startsWith('/cloudmoon/')
    ? '/cloudmoon'
    : '';
  const decodedRepresentationHeaders = new Set([
    'content-encoding',
    'content-length',
    'content-md5',
    'digest',
    'etag',
  ]);

  for (const [name, value] of upstreamHeaders) {
    const lowerName = name.toLowerCase();
    if (blocked.has(lowerName) || decodedRepresentationHeaders.has(lowerName)) continue;

    if (lowerName === 'location') {
      try {
        const location = new URL(value, origin);
        output[name] = location.origin === origin.origin
          ? `${proxyPrefix}${location.pathname}${location.search}${location.hash}`
          : value;
      } catch {
        output[name] = value;
      }
      continue;
    }

    if (lowerName === 'set-cookie') {
      const cookies = typeof upstreamHeaders.getSetCookie === 'function'
        ? upstreamHeaders.getSetCookie()
        : [value];
      output[name] = cookies.map((cookie) => cookie.replace(
        /;\s*domain=\.?web\.cloudmoonapp\.com/ig,
        '',
      ));
      continue;
    }

    output[name] = value;
  }

  return output;
}

async function handleRequest(request, response) {
  const incoming = new URL(request.url ?? '/', 'http://proxy.local');
  const pathname = incoming.pathname;

  if (pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  if (pathname === '/auth/login' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) {
        response.writeHead(413, { 'content-type': 'application/json' });
        response.end('{"error":"Request too large"}');
        return;
      }
    }
    const form = new URLSearchParams(body);
    const valid = safeEqual(form.get('username') ?? '', expectedUsername)
      && safeEqual(form.get('password') ?? '', expectedPassword);
    if (!valid) {
      response.writeHead(401, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end('{"error":"That username and password do not match."}');
      return;
    }

    const expires = String(Date.now() + sessionDuration);
    response.writeHead(204, {
      'set-cookie': sessionCookieHeader(request, `${expires}.${sessionSignature(expires)}`, sessionDuration / 1000),
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }

  if (pathname === '/auth/logout' && request.method === 'POST') {
    response.writeHead(204, {
      'set-cookie': sessionCookieHeader(request, '', 0),
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }

  const authenticated = isAuthenticated(request);
  if (pathname === '/' || pathname === '/welcome' || pathname === '/login') {
    try {
      await servePage(response, authenticated ? 'welcome.html' : 'login.html');
    } catch (error) {
      console.error(`Unable to load portal page: ${error.message}`);
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Portal page is unavailable');
    }
    return;
  }

  if (pathname === '/hub' || pathname === '/hub/') {
    try {
      await servePage(response, authenticated ? 'hub.html' : 'login.html');
    } catch (error) {
      console.error(`Unable to load portal page: ${error.message}`);
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Portal page is unavailable');
    }
    return;
  }

  const assetPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  const assetName = assetPath.match(/^\/assets\/(gaming-arena|cloudmoon|boosteroid)\.webp$/)?.[1];
  if (assetName) {
    try {
      const asset = await readFile(new URL(`./assets/${assetName}.webp`, import.meta.url));
      response.writeHead(200, {
        'content-type': 'image/webp',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      response.end(asset);
    } catch (error) {
      console.error(`Unable to load hub asset: ${error.message}`);
      response.writeHead(404);
      response.end();
    }
    return;
  }

  if (!authenticated) {
    response.writeHead(401, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('Sign in through the game hub to continue.');
    return;
  }

  let target;
  try {
    target = getTarget(request);
  } catch {
    response.writeHead(400);
    response.end('Invalid request target');
    return;
  }

  const blocked = hopByHopHeaders(request.headers);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || blocked.has(name.toLowerCase())) continue;
    if (['host', 'authorization', 'proxy-authorization'].includes(name.toLowerCase())) continue;
    if (name.toLowerCase().startsWith('x-forwarded-')) continue;
    if (name.toLowerCase() === 'origin') {
      headers.set(name, origin.origin);
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  const controller = new AbortController();
  request.on('aborted', () => controller.abort());
  response.on('close', () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? Readable.toWeb(request) : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });

    response.writeHead(upstream.status, rewriteResponseHeaders(upstream.headers, incoming.pathname));
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(response);
    } else {
      response.end();
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error(`Upstream request failed: ${error.message}`);
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Cloudmoon upstream is unavailable');
    } else {
      response.destroy(error);
    }
  }
}

function handleUpgrade(request, clientSocket, head) {
  if (!isAuthenticated(request)) {
    clientSocket.end(
      'HTTP/1.1 401 Unauthorized\r\n'
      + 'Connection: close\r\n\r\n',
    );
    return;
  }

  let target;
  try {
    target = getTarget(request);
  } catch {
    clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }

  clientSocket.pause();
  const upstreamSocket = connectTls({
    host: origin.hostname,
    port: Number(origin.port || 443),
    servername: origin.hostname,
  });

  upstreamSocket.once('secureConnect', () => {
    const lines = [`${request.method} ${target.pathname}${target.search} HTTP/${request.httpVersion}`];
    const blocked = hopByHopHeaders(request.headers);
    blocked.delete('upgrade');
    for (const [name, value] of Object.entries(request.headers)) {
      const lowerName = name.toLowerCase();
      if (value === undefined || blocked.has(lowerName)) continue;
      if (['host', 'authorization', 'proxy-authorization'].includes(lowerName)) continue;
      if (lowerName.startsWith('x-forwarded-')) continue;
      if (lowerName === 'origin') {
        lines.push(`Origin: ${origin.origin}`);
        continue;
      }
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    lines.push(`Host: ${origin.host}`, 'Connection: Upgrade', '', '');
    upstreamSocket.write(lines.join('\r\n'));
    if (head.length) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
    clientSocket.resume();
  });

  upstreamSocket.once('error', () => {
    if (!clientSocket.destroyed) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    }
  });
  clientSocket.once('error', () => upstreamSocket.destroy());
  clientSocket.once('close', () => upstreamSocket.destroy());
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on('upgrade', handleUpgrade);
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Shayan's Sons Proxy listening on port ${port}; upstream: ${origin.origin}`);
});