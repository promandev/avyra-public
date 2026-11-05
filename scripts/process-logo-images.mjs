/**
 * Processes the Avyra brand images:
 * - Removes dark backgrounds (makes them transparent)
 * - Creates dark-theme variant (white logo, transparent bg)
 * - Creates light-theme variant (dark logo, transparent bg)
 * - Generates favicon sizes from the icon
 */
import { createReadStream, createWriteStream, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PNG } = require('C:/Users/you/AppData/Roaming/npm/node_modules/pngjs');

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source images from VS Code chat (pasted image 2 = icon, pasted image 4 = wordmark)
const ICON_SRC = 'C:/Users/you/AppData/Roaming/Code/User/workspaceStorage/vscode-chat-images/image-1780054228693.png';
const WORDMARK_SRC = 'C:/Users/you/AppData/Roaming/Code/User/workspaceStorage/vscode-chat-images/image-1780054289179.png';

// Output directory
const OUT_DIR = join(__dirname, '../apps/web/public/icons');
mkdirSync(OUT_DIR, { recursive: true });

/**
 * Load a PNG file and return as PNG object
 */
function loadPNG(filepath) {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    createReadStream(filepath)
      .pipe(png)
      .on('parsed', function () { resolve(this); })
      .on('error', reject);
  });
}

/**
 * Save a PNG object to file
 */
function savePNG(png, filepath) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filepath);
    png.pack().pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Get luminance of a pixel (0-255)
 */
function getLuminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Remove dark background: dark pixels → transparent, bright pixels → keep
 * Threshold: pixels with luminance below threshold become transparent
 */
function removeDarkBackground(src, threshold = 60) {
  const dst = new PNG({ width: src.width, height: src.height });
  dst.data = Buffer.alloc(src.width * src.height * 4);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (src.width * y + x) * 4;
      const r = src.data[idx];
      const g = src.data[idx + 1];
      const b = src.data[idx + 2];
      const lum = getLuminance(r, g, b);

      if (lum < threshold) {
        // Dark pixel → transparent
        dst.data[idx] = 0;
        dst.data[idx + 1] = 0;
        dst.data[idx + 2] = 0;
        dst.data[idx + 3] = 0;
      } else {
        // Bright pixel → keep, interpolate alpha based on luminance
        const alpha = Math.min(255, Math.round(((lum - threshold) / (255 - threshold)) * 255));
        dst.data[idx] = r;
        dst.data[idx + 1] = g;
        dst.data[idx + 2] = b;
        dst.data[idx + 3] = alpha;
      }
    }
  }
  return dst;
}

/**
 * Convert white pixels to dark (for light theme)
 * Takes a transparent-bg image with white logo and makes the logo dark
 */
function whiteToColor(src, targetR, targetG, targetB) {
  const dst = new PNG({ width: src.width, height: src.height });
  dst.data = Buffer.alloc(src.width * src.height * 4);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (src.width * y + x) * 4;
      const a = src.data[idx + 3];
      // Recolor non-transparent pixels to target color
      dst.data[idx] = targetR;
      dst.data[idx + 1] = targetG;
      dst.data[idx + 2] = targetB;
      dst.data[idx + 3] = a;
    }
  }
  return dst;
}

/**
 * Get RGBA at (x, y) clamped to image bounds
 */
function getPixel(png, x, y) {
  const cx = Math.max(0, Math.min(png.width - 1, x));
  const cy = Math.max(0, Math.min(png.height - 1, y));
  const idx = (png.width * cy + cx) * 4;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

/**
 * Resize PNG using bilinear interpolation for better quality upscaling
 */
function resizePNG(src, newWidth, newHeight) {
  const dst = new PNG({ width: newWidth, height: newHeight });
  dst.data = Buffer.alloc(newWidth * newHeight * 4);

  const scaleX = src.width / newWidth;
  const scaleY = src.height / newHeight;

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcXf = (x + 0.5) * scaleX - 0.5;
      const srcYf = (y + 0.5) * scaleY - 0.5;
      const x0 = Math.floor(srcXf);
      const y0 = Math.floor(srcYf);
      const dx = srcXf - x0;
      const dy = srcYf - y0;

      const [r00, g00, b00, a00] = getPixel(src, x0, y0);
      const [r10, g10, b10, a10] = getPixel(src, x0 + 1, y0);
      const [r01, g01, b01, a01] = getPixel(src, x0, y0 + 1);
      const [r11, g11, b11, a11] = getPixel(src, x0 + 1, y0 + 1);

      const dstIdx = (newWidth * y + x) * 4;
      dst.data[dstIdx]     = Math.round(r00*(1-dx)*(1-dy) + r10*dx*(1-dy) + r01*(1-dx)*dy + r11*dx*dy);
      dst.data[dstIdx + 1] = Math.round(g00*(1-dx)*(1-dy) + g10*dx*(1-dy) + g01*(1-dx)*dy + g11*dx*dy);
      dst.data[dstIdx + 2] = Math.round(b00*(1-dx)*(1-dy) + b10*dx*(1-dy) + b01*(1-dx)*dy + b11*dx*dy);
      dst.data[dstIdx + 3] = Math.round(a00*(1-dx)*(1-dy) + a10*dx*(1-dy) + a01*(1-dx)*dy + a11*dx*dy);
    }
  }
  return dst;
}

/**
 * Add a solid background color to a transparent PNG (for app icons)
 */
function addBackground(src, bgR, bgG, bgB) {
  const dst = new PNG({ width: src.width, height: src.height });
  dst.data = Buffer.alloc(src.width * src.height * 4);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (src.width * y + x) * 4;
      const a = src.data[idx + 3] / 255;
      const fgR = src.data[idx];
      const fgG = src.data[idx + 1];
      const fgB = src.data[idx + 2];

      // Alpha composite over background
      dst.data[idx] = Math.round(fgR * a + bgR * (1 - a));
      dst.data[idx + 1] = Math.round(fgG * a + bgG * (1 - a));
      dst.data[idx + 2] = Math.round(fgB * a + bgB * (1 - a));
      dst.data[idx + 3] = 255;
    }
  }
  return dst;
}

async function main() {
  console.log('Loading source images...');
  const iconSrc = await loadPNG(ICON_SRC);
  const wordmarkSrc = await loadPNG(WORDMARK_SRC);

  console.log(`Icon: ${iconSrc.width}x${iconSrc.height}`);
  console.log(`Wordmark: ${wordmarkSrc.width}x${wordmarkSrc.height}`);

  // --- ICON PROCESSING ---
  console.log('\nProcessing icon...');

  // 1. Remove dark background → white "A" on transparent
  const iconDark = removeDarkBackground(iconSrc, 50);
  await savePNG(iconDark, join(OUT_DIR, 'logo-mark-dark.png'));
  console.log('  ✓ logo-mark-dark.png (white A, transparent bg)');

  // 2. Convert white to dark for light theme
  const iconLight = whiteToColor(iconDark, 11, 18, 32); // #0b1220 dark color
  await savePNG(iconLight, join(OUT_DIR, 'logo-mark-light.png'));
  console.log('  ✓ logo-mark-light.png (dark A, transparent bg)');

  // 3. App icons with dark background (for PWA/iOS)
  // Use the original image resized (it already has the right dark bg look)
  const iconWithBg = addBackground(iconDark, 11, 18, 32); // #0b1220

  const icon192 = resizePNG(iconWithBg, 192, 192);
  await savePNG(icon192, join(OUT_DIR, 'icon-192.png'));
  console.log('  ✓ icon-192.png');

  const icon512 = resizePNG(iconWithBg, 512, 512);
  await savePNG(icon512, join(OUT_DIR, 'icon-512.png'));
  console.log('  ✓ icon-512.png');

  // 4. Apple touch icon (180x180)
  const appleIcon = resizePNG(iconWithBg, 180, 180);
  await savePNG(appleIcon, join(OUT_DIR, 'apple-touch-icon.png'));
  console.log('  ✓ apple-touch-icon.png');

  // 5. Favicon sizes (dark bg: a white mark on transparent is invisible on light browser tabs)
  const favicon32 = resizePNG(iconWithBg, 32, 32);
  await savePNG(favicon32, join(OUT_DIR, 'favicon-32x32.png'));
  console.log('  ✓ favicon-32x32.png');

  const favicon16 = resizePNG(iconWithBg, 16, 16);
  await savePNG(favicon16, join(OUT_DIR, 'favicon-16x16.png'));
  console.log('  ✓ favicon-16x16.png');

  // --- WORDMARK PROCESSING ---
  console.log('\nProcessing wordmark...');

  // 1. Remove dark background → white "AVYRA" on transparent
  const wordmarkDark = removeDarkBackground(wordmarkSrc, 50);
  await savePNG(wordmarkDark, join(OUT_DIR, 'wordmark-dark.png'));
  console.log('  ✓ wordmark-dark.png (white AVYRA, transparent bg)');

  // 2. Convert white to dark for light theme
  const wordmarkLight = whiteToColor(wordmarkDark, 11, 18, 32);
  await savePNG(wordmarkLight, join(OUT_DIR, 'wordmark-light.png'));
  console.log('  ✓ wordmark-light.png (dark AVYRA, transparent bg)');

  console.log('\nDone! All images saved to:', OUT_DIR);
}

main().catch(console.error);
