export const VESSEL_MMSIS = [316045066, 316045069, 316045081, 316045082, 316050853] as const;

export const VESSEL_NAMES: Record<number, string> = {
  316045066: 'Ongiara',
  316045069: 'Sam McBride',
  316045081: 'Wm Inglis',
  316045082: 'Thomas Rennie',
  316050853: 'Marilyn Bell I',
};

export const VESSEL_COLORS: Record<number, string> = {
  316045069: '#f97316', // Sam McBride — orange
  316045081: '#a78bfa', // Wm Inglis — violet
  316045082: '#34d399', // Thomas Rennie — green
  316050853: '#fb7185', // Marilyn Bell I — rose
};

// Pre-computed rgba strings for line-gradient expressions (avoids runtime hex parsing)
export const VESSEL_COLOR_RGBA: Record<number, { r: number; g: number; b: number }> = {
  316045069: { r: 249, g: 115, b: 22  }, // Sam McBride — orange
  316045081: { r: 167, g: 139, b: 250 }, // Wm Inglis — violet
  316045082: { r: 52,  g: 211, b: 153 }, // Thomas Rennie — green
  316050853: { r: 251, g: 113, b: 133 }, // Marilyn Bell I — rose
};

export const HARBOUR_CENTER = { lng: -79.3750, lat: 43.6402 } as const;

export const DEFAULT_ZOOM = 13;
