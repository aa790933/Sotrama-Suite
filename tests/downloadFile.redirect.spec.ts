import fs from 'fs-extra';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import test from 'tape';
import { downloadFile } from '../utils/packages';

function tmpDest(): string {
  return path.join(os.tmpdir(), `sotrama-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
}

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function withServer(
  routes: Record<string, RouteHandler>,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const handler = routes[url] || routes['*'];
    if (handler) handler(req, res);
    else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('downloadFile follows 301 relative Location', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        res.writeHead(301, { Location: '/target' });
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200, { 'Content-Length': '5' });
        res.end('hello');
      },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/redirect`, dest);
      t.equal(fs.readFileSync(dest, 'utf-8'), 'hello', '301 relative redirect followed');
      fs.removeSync(dest);
    }
  );
  t.end();
});

test('downloadFile follows 302 relative Location', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        res.writeHead(302, { Location: '/target' });
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200);
        res.end('world');
      },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/redirect`, dest);
      t.equal(fs.readFileSync(dest, 'utf-8'), 'world');
      fs.removeSync(dest);
    }
  );
  t.end();
});

test('downloadFile follows 303 relative Location', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        res.writeHead(303, { Location: '/target' });
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200);
        res.end('303ok');
      },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/redirect`, dest);
      t.equal(fs.readFileSync(dest, 'utf-8'), '303ok');
      fs.removeSync(dest);
    }
  );
  t.end();
});

test('downloadFile follows 307 relative Location', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        res.writeHead(307, { Location: '/target' });
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200);
        res.end('307ok');
      },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/redirect`, dest);
      t.equal(fs.readFileSync(dest, 'utf-8'), '307ok');
      fs.removeSync(dest);
    }
  );
  t.end();
});

test('downloadFile follows 308 relative Location', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        res.writeHead(308, { Location: '/target' });
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200);
        res.end('308ok');
      },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/redirect`, dest);
      t.equal(fs.readFileSync(dest, 'utf-8'), '308ok');
      fs.removeSync(dest);
    }
  );
  t.end();
});

test('downloadFile follows absolute Location', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        // absolute URL will be filled after server starts; use 302 to /target2
        // we handle absolute via base url captured in closure
        res.writeHead(302, { Location: '' });
        res.end();
      },
    },
    async (base) => {
      // recreate server for absolute test to get correct base
    }
  );
  // second server where we know base upfront
  await withServer(
    {
      '/start': (_req, res) => {
        // absolute redirect to /end on same host
        // need base inside handler; use closure via server.address not available at definition time,
        // so we store base in variable and set handler dynamically:
        res.writeHead(302, { Location: '' });
        res.end();
      },
      '/end': (_req, res) => {
        res.writeHead(200);
        res.end('abs');
      },
    },
    async (_base) => {
      // To properly test absolute, create a dedicated server inside
      const inner = http.createServer((req, res) => {
        if (req.url === '/start') {
          const addr = inner.address() as { port: number };
          const abs = `http://127.0.0.1:${addr.port}/end`;
          res.writeHead(302, { Location: abs });
          res.end();
        } else if (req.url === '/end') {
          res.writeHead(200);
          res.end('abs');
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      await new Promise<void>((r) => inner.listen(0, '127.0.0.1', () => r()));
      const a = inner.address() as { port: number };
      const base2 = `http://127.0.0.1:${a.port}`;
      const dest = tmpDest();
      try {
        await downloadFile(`${base2}/start`, dest);
        t.equal(fs.readFileSync(dest, 'utf-8'), 'abs', 'absolute Location followed');
      } finally {
        fs.removeSync(dest);
        await new Promise<void>((r) => inner.close(() => r()));
      }
    }
  );
  t.end();
});

test('downloadFile does not follow 304 (treated as error) and cleans up', async (t) => {
  await withServer(
    {
      '/redirect': (_req, res) => {
        res.writeHead(304, { Location: '/target' });
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200);
        res.end('should not reach');
      },
    },
    async (base) => {
      const dest = tmpDest();
      // create a partial file beforehand to verify cleanup
      fs.writeFileSync(dest, 'partial');
      t.ok(fs.existsSync(dest), 'partial exists before');
      let threw = false;
      try {
        await downloadFile(`${base}/redirect`, dest);
      } catch (e) {
        threw = true;
        t.match((e as Error).message, /304/, '304 treated as failure');
      }
      t.ok(threw, 'should throw on 304');
      t.notOk(fs.existsSync(dest), 'partial file cleaned up after 304');
    }
  );
  t.end();
});

test('downloadFile enforces redirect limit and cleans up partial file', async (t) => {
  await withServer(
    {
      '/loop': (_req, res) => {
        res.writeHead(302, { Location: '/loop' });
        res.end();
      },
    },
    async (base) => {
      const dest = tmpDest();
      fs.writeFileSync(dest, 'old');
      let threw = false;
      try {
        await downloadFile(`${base}/loop`, dest, undefined, 2);
      } catch (e) {
        threw = true;
        t.match((e as Error).message, /302/, 'loop limit exceeded');
      }
      t.ok(threw);
      t.notOk(fs.existsSync(dest), 'partial file removed after loop limit');
    }
  );
  t.end();
});

test('downloadFile cleans up on 404 and on download failure', async (t) => {
  await withServer(
    {
      '/missing': (_req, res) => {
        res.writeHead(404);
        res.end('not found');
      },
    },
    async (base) => {
      const dest = tmpDest();
      fs.writeFileSync(dest, 'stale');
      let threw = false;
      try {
        await downloadFile(`${base}/missing`, dest);
      } catch (e) {
        threw = true;
        t.match((e as Error).message, /404/);
      }
      t.ok(threw);
      t.notOk(fs.existsSync(dest), 'dest removed after 404');
    }
  );
  t.end();
});

test('downloadFile handles string[] Location (takes first)', async (t) => {
  await withServer(
    {
      '/multi': (_req, res) => {
        // Node allows array for duplicate headers; ServerResponse will send multiple Location headers
        // The client will see string[] due to duplicate
        res.setHeader('Location', ['/target', '/other'] as unknown as string);
        res.writeHead(302);
        res.end();
      },
      '/target': (_req, res) => {
        res.writeHead(200);
        res.end('first');
      },
      '/other': (_req, res) => {
        res.writeHead(200);
        res.end('second');
      },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/multi`, dest);
      // should follow first location /target
      t.equal(fs.readFileSync(dest, 'utf-8'), 'first', 'first Location in array followed');
      fs.removeSync(dest);
    }
  );
  t.end();
});

test('downloadFile follows chain of 5 redirects then succeeds', async (t) => {
  await withServer(
    {
      '/a': (_req, res) => { res.writeHead(301, { Location: '/b' }); res.end(); },
      '/b': (_req, res) => { res.writeHead(302, { Location: '/c' }); res.end(); },
      '/c': (_req, res) => { res.writeHead(303, { Location: '/d' }); res.end(); },
      '/d': (_req, res) => { res.writeHead(307, { Location: '/e' }); res.end(); },
      '/e': (_req, res) => { res.writeHead(308, { Location: '/f' }); res.end(); },
      '/f': (_req, res) => { res.writeHead(200); res.end('chain-ok'); },
    },
    async (base) => {
      const dest = tmpDest();
      await downloadFile(`${base}/a`, dest);
      t.equal(fs.readFileSync(dest, 'utf-8'), 'chain-ok', '5-hop chain followed');
      fs.removeSync(dest);
    }
  );
  t.end();
});
