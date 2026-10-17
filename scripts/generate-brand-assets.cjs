const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const outputs = new Map();
const sizes = [16, 32, 48, 64, 128, 256, 512];

function readPngSize(filePath) {
  const png = fs.readFileSync(path.join(root, filePath));
  if (png.subarray(1, 4).toString() !== 'PNG') {
    throw new Error(`Not a PNG file: ${filePath}`);
  }

  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function renderSvg(svgPath, width, height) {
  const svg = fs.readFileSync(path.join(root, svgPath), 'utf8');
  return await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
}

function makeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = [];
  const images = [];
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

function makeIcns(frames) {
  const typeBySize = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
  ]);
  const chunks = frames.map(({ size, png }) => {
    const chunk = Buffer.alloc(8);
    chunk.write(typeBySize.get(size), 0, 4, 'ascii');
    chunk.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([chunk, png]);
  });
  const totalSize = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalSize, 4);
  return Buffer.concat([header, ...chunks]);
}

async function main() {
  const renderedIcons = new Map();
  for (const size of sizes) {
    renderedIcons.set(size, await renderSvg('build/icon.svg', size, size));
    outputs.set(`build/icons/${size}x${size}.png`, renderedIcons.get(size));
  }
  outputs.set('build/icon.png', renderedIcons.get(512));

  const appIconFrames = [16, 32, 48, 64, 128, 256].map((size) => ({
    size,
    png: renderedIcons.get(size),
  }));
  const appIco = makeIco(appIconFrames);
  outputs.set('build/icon.ico', appIco);
  outputs.set('build/installerIcon.ico', appIco);
  outputs.set('build/uninstallerIcon.ico', appIco);
  outputs.set(
    'build/icon.icns',
    makeIcns([16, 32, 64, 128, 256, 512].map((size) => ({
      size,
      png: renderedIcons.get(size),
    })))
  );

  const faviconFrames = [];
  for (const size of [16, 32, 48]) {
    const png = await renderSvg('docs/public/favicon.svg', size, size);
    faviconFrames.push({ size, png });
    if (size !== 48) outputs.set(`docs/public/favicon-${size}x${size}.png`, png);
  }
  outputs.set('docs/public/favicon.ico', makeIco(faviconFrames));

  for (const size of [192, 512]) {
    outputs.set(
      `docs/public/android-chrome-${size}x${size}.png`,
      await renderSvg('build/icon.svg', size, size)
    );
  }
  outputs.set(
    'docs/public/apple-touch-icon.png',
    await renderSvg('build/icon.svg', 180, 180)
  );
  outputs.set(
    'docs/public/maskable-icon-512x512.png',
    await renderSvg('build/icon.svg', 512, 512)
  );
  outputs.set(
    'docs/public/icon.png',
    await renderSvg('build/icon.svg', ...Object.values(readPngSize('docs/public/icon.png')))
  );

  for (const file of ['social-card.png', 'github-social-preview.png']) {
    const { width, height } = readPngSize(`docs/public/${file}`);
    outputs.set(
      `docs/public/${file}`,
      await renderSvg('docs/public/social-card.svg', width, height)
    );
  }

  const { width: logoWidth, height: logoHeight } = readPngSize('src/assets/img/app-logo.png');
  outputs.set(
    'src/assets/img/app-logo.png',
    await renderSvg('src/assets/img/app-logo.svg', logoWidth, logoHeight)
  );

  for (const [filePath, buffer] of outputs) {
    fs.writeFileSync(path.join(root, filePath), buffer);
  }
  console.log(`Regenerated ${outputs.size} brand assets from the maintained SVG sources.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
