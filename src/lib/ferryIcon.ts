import type { Map as MaplibreMap } from 'maplibre-gl';

const ICON_NAME = 'ferry-icon';
const SIZE = 48;

const SVG_DATA_URL =
  `data:image/svg+xml,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
      `<ellipse cx="24" cy="38" rx="14" ry="4" fill="rgba(0,0,0,0.3)"/>` +
      `<path d="M24 6 L36 18 L36 34 Q36 38 32 38 L16 38 Q12 38 12 34 L12 18 Z" fill="#e8f4f8" stroke="#b0ccd8" stroke-width="1"/>` +
      `<rect x="17" y="18" width="14" height="12" rx="2" fill="#00b4cc" opacity="0.85"/>` +
      `<polygon points="24,6 20,14 28,14" fill="#00e5ff" opacity="0.9"/>` +
      `<circle cx="20" cy="22" r="2" fill="rgba(255,255,255,0.9)"/>` +
      `<circle cx="24" cy="22" r="2" fill="rgba(255,255,255,0.9)"/>` +
      `<circle cx="28" cy="22" r="2" fill="rgba(255,255,255,0.9)"/>` +
    `</svg>`
  );

export async function loadFerryIcon(map: MaplibreMap): Promise<void> {
  if (map.hasImage(ICON_NAME)) return;

  return new Promise<void>((resolve, reject) => {
    const img = new Image(SIZE, SIZE);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve();
        return;
      }
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
      map.addImage(ICON_NAME, {
        width: SIZE,
        height: SIZE,
        data: new Uint8ClampedArray(imageData.data),
      });
      resolve();
    };
    img.onerror = reject;
    img.src = SVG_DATA_URL;
  });
}
