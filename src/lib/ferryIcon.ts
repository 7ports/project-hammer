import type { Map as MaplibreMap } from 'maplibre-gl';

const ICON_NAME = 'ferry-icon';
const SIZE = 48;

/**
 * Draw the ferry icon directly onto a canvas using 2D API (synchronous).
 * This avoids the img.onload race condition where MapLibre tries to use
 * the symbol layer before the async image load completes.
 */
function drawFerryIcon(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Drop shadow
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(24, 39, 13, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Hull body
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(24, 7);
  ctx.lineTo(35, 18);
  ctx.lineTo(35, 34);
  ctx.quadraticCurveTo(35, 38, 31, 38);
  ctx.lineTo(17, 38);
  ctx.quadraticCurveTo(13, 38, 13, 34);
  ctx.lineTo(13, 18);
  ctx.closePath();
  ctx.fillStyle = '#e8f4f8';
  ctx.strokeStyle = '#a8c8d8';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Superstructure deck
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(17, 18, 14, 12, 2);
  ctx.fillStyle = '#00b4cc';
  ctx.globalAlpha = 0.88;
  ctx.fill();
  ctx.restore();

  // Bow direction triangle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(24, 6);
  ctx.lineTo(20, 14);
  ctx.lineTo(28, 14);
  ctx.closePath();
  ctx.fillStyle = '#00e5ff';
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.restore();

  // Windows
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const x of [20, 24, 28]) {
    ctx.beginPath();
    ctx.arc(x, 22, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  return ctx.getImageData(0, 0, SIZE, SIZE);
}

export function loadFerryIcon(map: MaplibreMap): void {
  if (map.hasImage(ICON_NAME)) return;
  const imageData = drawFerryIcon();
  map.addImage(ICON_NAME, {
    width: SIZE,
    height: SIZE,
    data: new Uint8ClampedArray(imageData.data),
  });
}
