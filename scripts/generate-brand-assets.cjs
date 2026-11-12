/* Derive web and native icon sizes from the approved logo without redrawing it. */
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets/brand/rahdari-logo-v2.png');
const transparent = { r: 255, g: 255, b: 255, alpha: 0 };

async function emblem(width, height, fraction = .9, background = '#ffffff') {
  const bound = Math.max(1, Math.round(Math.min(width, height) * fraction));
  const image = await sharp(source).resize({ width: bound, height: bound, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background } }).composite([{ input: image, gravity: 'centre' }]).png().toBuffer();
}

async function write(relative, buffer) {
  const dest = path.join(root, relative);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);
}

async function main() {
  const meta = await sharp(source).metadata();
  const big = await sharp(source).resize({ width: 1000 }).webp({ quality: 92 }).toBuffer();
  const bigMeta = await sharp(big).metadata();
  await write('public/brand/rahdari-logo-v2.webp', big);
  await write('public/brand/rahdari-mark-v2.webp', await sharp(source).resize({ width: 256 }).webp({ quality: 92 }).toBuffer());

  for (const size of [32, 192, 512]) {
    const buffer = await emblem(size, size, .94, transparent);
    await write(`public/brand/icon-${size}-v2.png`, buffer);
    await write(size === 32 ? 'public/favicon-32.png' : `public/icon-${size}.png`, buffer);
  }
  for (const size of [192, 512]) {
    const buffer = await emblem(size, size, .78);
    await write(`public/brand/icon-maskable-${size}-v2.png`, buffer);
    await write(`public/icon-maskable-${size}.png`, buffer);
  }
  const apple = await emblem(180, 180, .9);
  await write('public/brand/apple-icon-v2.png', apple);
  await write('public/apple-icon.png', apple);

  await write('mobile/assets/icon-only.png', await emblem(1024, 1024, .9));
  await write('mobile/assets/icon-foreground.png', await emblem(1024, 1024, .94, transparent));
  for (const size of [48,72,96,128,192,256,512]) {
    const buffer = await emblem(size, size, .9);
    await write(`mobile/icons/icon-${size}.webp`, await sharp(buffer).webp({ quality: 92 }).toBuffer());
  }

  const res = path.join(root, 'mobile/android/app/src/main/res');
  for (const dir of await fs.readdir(res, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (dir.name.startsWith('mipmap-') && !dir.name.includes('anydpi')) {
      for (const name of ['ic_launcher.png','ic_launcher_round.png','ic_launcher_foreground.png']) {
        const relative = `mobile/android/app/src/main/res/${dir.name}/${name}`;
        const existing = await sharp(path.join(root, relative)).metadata();
        const foreground = name.includes('foreground');
        let buffer = await emblem(existing.width, existing.height, foreground ? .94 : .8, foreground ? transparent : '#ffffff');
        if (name.includes('round')) {
          const mask = Buffer.from(`<svg width="${existing.width}" height="${existing.height}"><ellipse cx="${existing.width/2}" cy="${existing.height/2}" rx="${existing.width/2}" ry="${existing.height/2}"/></svg>`);
          buffer = await sharp(buffer).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
        }
        await write(relative, buffer);
      }
    }
    if (dir.name.startsWith('drawable')) {
      const relative = `mobile/android/app/src/main/res/${dir.name}/splash.png`;
      try {
        const existing = await sharp(path.join(root, relative)).metadata();
        await write(relative, await emblem(existing.width, existing.height, .68));
      } catch (error) { if (error.message.includes('Input file is missing')) continue; throw error; }
    }
  }
  await write('mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', await emblem(1024,1024,.9));
  const iosSplash = 'mobile/ios/App/App/Assets.xcassets/Splash.imageset';
  for (const name of await fs.readdir(path.join(root, iosSplash))) {
    if (!name.endsWith('.png')) continue;
    const current = await sharp(path.join(root, iosSplash, name)).metadata();
    await write(`${iosSplash}/${name}`, await emblem(current.width,current.height,.68));
  }
  await write('mobile/www/rahdari-logo.webp', await sharp(source).resize({width:256}).webp({quality:90}).toBuffer());
  console.log(JSON.stringify({ source: { width: meta.width, height: meta.height }, webLogo: { width: bigMeta.width, height: bigMeta.height }, nativeAssets: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
