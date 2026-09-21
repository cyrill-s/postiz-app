// Run inside Postiz with the S3 env loaded. Original files are never removed.
// copy: upload and verify all files. apply: repeat copy, then migrate exact DB URLs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const root = '/uploads';
const prefix =
  (process.env.S3_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '') + '/';
const base = process.env.CLOUDFLARE_BUCKET_URL.replace(/\/$/, '');
const oldOrigin = 'https://poster.generationl.ru/uploads/';
const s = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.CLOUDFLARE_REGION,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const hash = (body) => crypto.createHash('sha256').update(body).digest('hex');
(async () => {
  assert.equal(
    prefix,
    'postiz/',
    'Refusing migration outside Postiz namespace'
  );
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((x) => fs.statSync(path.join(root, x)).isFile());
  assert.equal(
    new Set(files.map((x) => path.basename(x))).size,
    files.length,
    'Duplicate filenames'
  );
  let next = 0,
    uploaded = 0,
    verified = 0,
    bytes = 0;
  const manifest = {};
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < files.length) {
        const relative = files[next++];
        const body = fs.readFileSync(path.join(root, relative));
        const name = path.basename(relative),
          Key = prefix + name,
          sha256 = hash(body),
          url = base + '/' + name;
        let existing;
        try {
          existing = await s.send(
            new HeadObjectCommand({
              Bucket: process.env.CLOUDFLARE_BUCKETNAME,
              Key,
            })
          );
        } catch (e) {
          if (e.$metadata?.httpStatusCode !== 404) throw e;
        }
        if (existing) {
          assert.equal(
            existing.Metadata?.sha256,
            sha256,
            'Existing S3 object does not match migration: ' + Key
          );
        } else {
          await s.send(
            new PutObjectCommand({
              Bucket: process.env.CLOUDFLARE_BUCKETNAME,
              Key,
              Body: body,
              ContentType:
                require('mime-types').lookup(name) ||
                'application/octet-stream',
              ACL: 'public-read',
              Metadata: { sha256 },
            })
          );
          uploaded++;
        }
        const r = await fetch(url);
        assert.equal(r.status, 200, 'Public GET failed: ' + Key);
        assert.equal(
          hash(Buffer.from(await r.arrayBuffer())),
          sha256,
          'Content mismatch: ' + Key
        );
        manifest[relative] = { url, sha256, bytes: body.length };
        verified++;
        bytes += body.length;
      }
    })
  );
  fs.writeFileSync(
    '/config/s3-migration-files.json',
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 }
  );
  console.log(JSON.stringify({ uploaded, verified, bytes }));
  if (process.env.S3_MIGRATION_MODE !== 'apply') return;
  function replace(value) {
    if (typeof value === 'string' && value.startsWith(oldOrigin)) {
      const url = new URL(value),
        relative = decodeURIComponent(url.pathname.slice('/uploads/'.length));
      assert.ok(manifest[relative], 'Referenced file missing: ' + relative);
      return manifest[relative].url + url.search;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, replace(v)])
      );
    return value;
  }
  const changes = [];
  for (const row of await p.media.findMany({
    select: { id: true, path: true, thumbnail: true },
  })) {
    const before = {},
      after = {};
    for (const field of ['path', 'thumbnail']) {
      const value = replace(row[field]);
      if (value !== row[field]) {
        before[field] = row[field];
        after[field] = value;
      }
    }
    if (Object.keys(after).length)
      changes.push({ model: 'media', id: row.id, before, after });
  }
  for (const row of await p.post.findMany({
    select: { id: true, image: true },
  })) {
    if (!row.image?.includes(oldOrigin)) continue;
    const after = JSON.stringify(replace(JSON.parse(row.image)));
    if (after !== row.image)
      changes.push({
        model: 'post',
        id: row.id,
        before: { image: row.image },
        after: { image: after },
      });
  }
  const backup = '/config/s3-migration-links-' + Date.now() + '.json';
  fs.writeFileSync(backup, JSON.stringify(changes, null, 2), { mode: 0o600 });
  await p.$transaction(
    async (tx) => {
      for (const c of changes) {
        const result = await tx[c.model].updateMany({
          where: { id: c.id, ...c.before },
          data: c.after,
        });
        assert.equal(result.count, 1, 'Concurrent edit; migration rolled back');
      }
    },
    { timeout: 30000 }
  );
  console.log(
    JSON.stringify({
      applied: changes.reduce(
        (a, c) => ((a[c.model] = (a[c.model] || 0) + 1), a),
        {}
      ),
      rollbackSnapshot: backup,
    })
  );
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
