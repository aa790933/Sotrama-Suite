import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readFile(filePath) {
  return readFileSync(path.join(root, filePath));
}

function readPngSize(buffer, filePath) {
  assert.ok(
    buffer.subarray(0, 8).equals(pngSignature),
    `${filePath} must be a PNG`
  );
  assert.equal(
    buffer.toString('ascii', 12, 16),
    'IHDR',
    `${filePath} must contain IHDR`
  );
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function checkPng(filePath, expectedSize) {
  const size = readPngSize(readFile(filePath), filePath);
  if (expectedSize) {
    assert.deepEqual(
      size,
      { width: expectedSize, height: expectedSize },
      filePath
    );
  }
}

function checkIco(filePath, expectedSizes) {
  const buffer = readFile(filePath);
  assert.equal(buffer.readUInt16LE(0), 0, `${filePath} reserved header`);
  assert.equal(buffer.readUInt16LE(2), 1, `${filePath} icon type`);
  const count = buffer.readUInt16LE(4);
  assert.equal(count, expectedSizes.length, `${filePath} frame count`);

  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = buffer.readUInt8(entryOffset) || 256;
    const height = buffer.readUInt8(entryOffset + 1) || 256;
    const imageLength = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);
    assert.ok(
      imageOffset + imageLength <= buffer.length,
      `${filePath} frame bounds`
    );
    const image = buffer.subarray(imageOffset, imageOffset + imageLength);
    assert.deepEqual(
      readPngSize(image, `${filePath} frame ${index}`),
      { width, height },
      `${filePath} frame ${index} dimensions`
    );
    assert.equal(
      width,
      expectedSizes[index],
      `${filePath} frame ${index} width`
    );
  }
}

function checkIcns(filePath, expectedSizes) {
  const buffer = readFile(filePath);
  assert.equal(buffer.toString('ascii', 0, 4), 'icns', `${filePath} signature`);
  assert.equal(
    buffer.readUInt32BE(4),
    buffer.length,
    `${filePath} total length`
  );

  let offset = 8;
  const sizes = [];
  while (offset < buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    assert.ok(
      length >= 8 && offset + length <= buffer.length,
      `${filePath} chunk bounds`
    );
    const sizeByType = {
      icp4: 16,
      icp5: 32,
      icp6: 64,
      ic07: 128,
      ic08: 256,
      ic09: 512,
    };
    const expectedSize = sizeByType[type];
    assert.ok(expectedSize, `${filePath} unexpected chunk type ${type}`);
    assert.deepEqual(
      readPngSize(
        buffer.subarray(offset + 8, offset + length),
        `${filePath} ${type}`
      ),
      { width: expectedSize, height: expectedSize },
      `${filePath} ${type} dimensions`
    );
    sizes.push(expectedSize);
    offset += length;
  }

  assert.deepEqual(sizes, expectedSizes, `${filePath} frame sizes`);
}

for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  checkPng(`build/icons/${size}x${size}.png`, size);
}
checkPng('build/icon.png', 512);
checkIco('build/icon.ico', [16, 32, 48, 64, 128, 256]);
checkIco('build/installerIcon.ico', [16, 32, 48, 64, 128, 256]);
checkIco('build/uninstallerIcon.ico', [16, 32, 48, 64, 128, 256]);
checkIcns('build/icon.icns', [16, 32, 64, 128, 256, 512]);
checkIco('docs/public/favicon.ico', [16, 32, 48]);

for (const filePath of [
  'docs/public/android-chrome-192x192.png',
  'docs/public/android-chrome-512x512.png',
  'docs/public/apple-touch-icon.png',
  'docs/public/favicon-16x16.png',
  'docs/public/favicon-32x32.png',
  'docs/public/github-social-preview.png',
  'docs/public/icon.png',
  'docs/public/maskable-icon-512x512.png',
  'docs/public/social-card.png',
  'src/assets/img/app-logo.png',
]) {
  readPngSize(readFile(filePath), filePath);
}

for (const filePath of [
  'build/icon.svg',
  'docs/public/favicon.svg',
  'docs/public/sotrama-mark.svg',
  'docs/public/sotrama-suite-logo.svg',
  'docs/public/sotrama-suite-logo-dark.svg',
  'docs/public/social-card.svg',
  'src/assets/img/app-logo.svg',
  'src/assets/img/sotrama-mark.svg',
]) {
  const svg = readFile(filePath).toString('utf8');
  assert.ok(
    svg.includes('#E11D48'),
    `${filePath} must use the Sotrama brand red`
  );
  assert.ok(
    !/#d94736|#202124|#faf7f0/i.test(svg),
    `${filePath} contains an outdated brand color`
  );
}

const manifest = JSON.parse(
  readFile('docs/public/site.webmanifest').toString('utf8')
);
assert.equal(manifest.theme_color, '#E11D48');
assert.equal(manifest.background_color, '#0F172A');

console.log(
  'Brand assets validated: SVG colors, PNG dimensions, ICO frames, and ICNS chunks.'
);
