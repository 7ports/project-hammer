import type { Map as MaplibreMap } from 'maplibre-gl';

const ICON_NAME = 'ferry-icon';
const WIDTH = 24;
const HEIGHT = 48;

export async function loadFerryIcon(map: MaplibreMap): Promise<void> {
  if (map.hasImage(ICON_NAME)) return;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Hull — elongated rounded rectangle
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(4, 8, WIDTH - 8, HEIGHT - 16, 4);
  ctx.fill();

  // Bow — pointed top
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2, 0);
  ctx.lineTo(4, 8);
  ctx.lineTo(WIDTH - 4, 8);
  ctx.closePath();
  ctx.fill();

  // Superstructure
  ctx.fillStyle = '#b0bec5';
  ctx.fillRect(7, 16, WIDTH - 14, 12);

  const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  map.addImage(ICON_NAME, {
    width: WIDTH,
    height: HEIGHT,
    data: new Uint8ClampedArray(imageData.data),
  });
}
