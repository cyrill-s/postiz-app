// Run inside the storage-only release with its private S3 env file.
// Exercises server uploads, presigned PUT, browser multipart upload, CORS and deletion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const {
  S3Client,
  DeleteObjectCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const base = '/app/apps/backend/dist/libraries/nestjs-libraries/src/upload/';
const { UploadFactory } = require(base + 'upload.factory.js');
const multipart = require(base + 'r2.uploader.js');
const { s3ObjectKey } = require(base + 's3.object-key.js');
const storage = UploadFactory.createStorage();
const body = fs.readFileSync(process.env.SMOKE_IMAGE);
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.CLOUDFLARE_REGION,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const objects = new Set();
let pending;
function response() {
  return {
    code: 200,
    status(n) {
      this.code = n;
      return this;
    },
    json(value) {
      this.value = value;
      return value;
    },
  };
}
async function publicCheck(url) {
  objects.add(s3ObjectKey(new URL(url).pathname.split('/').pop()));
  const r = await fetch(url);
  assert.equal(r.status, 200, `Public GET failed for ${url}`);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
  assert.ok(new URL(url).pathname.startsWith('/postiz/'));
}
(async () => {
  const file = await storage.uploadFile({
    buffer: body,
    mimetype: 'image/png',
    size: body.length,
  });
  console.log('server file');
  await publicCheck(file.path);
  console.log('server data URL');
  await publicCheck(
    await storage.uploadSimple(
      'data:image/png;base64,' + body.toString('base64')
    )
  );
  console.log('server stream');
  await publicCheck(
    (
      await storage.uploadStream(Readable.from(body), 'image/png', 'png')
    ).path
  );
  const name = 'smoke-signed-' + Date.now() + '.png';
  objects.add(s3ObjectKey(name));
  const put = await fetch(await storage.signUploadUrl(name, 'image/png'), {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body,
  });
  assert.ok(put.ok, 'presigned PUT failed: ' + put.status);
  console.log('signed PUT');
  await publicCheck(storage.publicUrl(name));
  const res = response();
  await multipart.createMultipartUpload(
    { body: { file: { name: 'probe.png' }, fileHash: 'postiz-s3-smoke' } },
    res
  );
  assert.equal(res.code, 200);
  pending = res.value;
  objects.add(pending.key);
  assert.ok(pending.key.startsWith('postiz/'));
  const signed = response();
  await multipart.signPart({ body: { ...pending, partNumber: 1 } }, signed);
  assert.equal(signed.code, 200);
  const part = await fetch(signed.value.url, { method: 'PUT', body });
  assert.ok(part.ok, 'multipart PUT failed: ' + part.status);
  const complete = response();
  const done = await multipart.completeMultipartUpload(
    {
      body: {
        ...pending,
        parts: [{ PartNumber: 1, ETag: part.headers.get('etag') }],
      },
    },
    complete
  );
  assert.equal(complete.code, 200);
  pending = undefined;
  console.log('multipart');
  await publicCheck(done.Location);
  const cors = await fetch(file.path, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://poster.generationl.ru',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.ok(cors.ok);
  assert.equal(
    cors.headers.get('access-control-allow-origin'),
    'https://poster.generationl.ru'
  );
  await storage.removeFile(file.path);
  objects.delete(s3ObjectKey(file.filename));
  assert.notEqual(
    (await fetch(file.path)).status,
    200,
    'deleted object remains readable'
  );
  console.log(
    'PASS: server file/data/stream uploads, signed PUT, multipart completion, public HTTPS, prefix, CORS, deletion'
  );
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (pending)
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: process.env.CLOUDFLARE_BUCKETNAME,
          Key: pending.key,
          UploadId: pending.uploadId,
        })
      );
    for (const Key of objects)
      await client.send(
        new DeleteObjectCommand({
          Bucket: process.env.CLOUDFLARE_BUCKETNAME,
          Key,
        })
      );
    console.log('Smoke objects removed');
  });
