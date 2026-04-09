export const VESSEL_MMSIS = [316045066, 316045069, 316045081, 316045082, 316050853] as const;

export const VESSEL_NAMES: Record<number, string> = {
  316045066: 'Ongiara',
  316045069: 'Sam McBride',
  316045081: 'Wm Inglis',
  316045082: 'Thomas Rennie',
  316050853: 'Marilyn Bell I',
};

export const HARBOUR_CENTER = { lng: -79.3750, lat: 43.6402 } as const;

export const DEFAULT_ZOOM = 13;
