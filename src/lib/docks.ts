export interface DockLocation {
  id: string;
  name: string;
  coordinates: [number, number]; // [longitude, latitude]
}

export const DOCK_LOCATIONS: DockLocation[] = [
  { id: 'jack-layton', name: 'Jack Layton Ferry Terminal', coordinates: [-79.3750, 43.6402] },
  { id: 'wards-island', name: "Ward's Island", coordinates: [-79.3578, 43.6314] },
  { id: 'centre-island', name: 'Centre Island', coordinates: [-79.3784, 43.6224] },
  { id: 'hanlans-point', name: "Hanlan's Point", coordinates: [-79.3890, 43.6279] },
];
