import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '../public/icons');
const svgPath = path.join(iconsDir, 'icon.svg');

async function generate() {
  await sharp(svgPath).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'));
  console.log('Generated icon-192.png');

  await sharp(svgPath).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'));
  console.log('Generated icon-512.png');

  await sharp(svgPath).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512-maskable.png'));
  console.log('Generated icon-512-maskable.png');

  console.log('Icons generated successfully.');
}

generate().catch(console.error);
