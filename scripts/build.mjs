import { copyFile, cp, mkdir, rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await copyFile(
  new URL('../src/server.mjs', import.meta.url),
  new URL('../dist/server.mjs', import.meta.url),
);
await copyFile(
  new URL('../src/hub.html', import.meta.url),
  new URL('../dist/hub.html', import.meta.url),
);
await copyFile(
  new URL('../src/welcome.html', import.meta.url),
  new URL('../dist/welcome.html', import.meta.url),
);
await copyFile(
  new URL('../src/login.html', import.meta.url),
  new URL('../dist/login.html', import.meta.url),
);
await cp(
  new URL('../src/assets/', import.meta.url),
  new URL('../dist/assets/', import.meta.url),
  { recursive: true },
);
console.log('Build complete: dist/server.mjs');