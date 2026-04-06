import { useState } from 'react';
import { Marker, Popup } from 'react-map-gl/maplibre';
import './LandmarkMarkers.css';

interface Landmark {
  id: string;
  name: string;
  description: string;
  coordinates: [number, number];
  icon: string;
}

const LANDMARKS: Landmark[] = [
  {
    id: 'gibraltar-lighthouse',
    name: 'Gibraltar Point Lighthouse',
    description:
      'Built in 1808, one of the oldest surviving lighthouses on the Great Lakes. A designated National Historic Site of Canada.',
    coordinates: [-79.3919, 43.6156],
    icon: '🏛',
  },
  {
    id: 'centreville',
    name: 'Centreville Amusement Park',
    description:
      'A family amusement park open seasonally (May–Sep) on Centre Island. Features rides, a petting zoo, and classic fairground attractions.',
    coordinates: [-79.3820, 43.6198],
    icon: '🎡',
  },
  {
    id: 'toronto-island-airport',
    name: 'Billy Bishop Toronto City Airport',
    description:
      'A downtown island airport serving regional and leisure destinations. Connected to the mainland by a pedestrian tunnel.',
    coordinates: [-79.3961, 43.6275],
    icon: '✈',
  },
  {
    id: 'wards-beach',
    name: "Ward's Island Beach",
    description:
      'A quiet sandy beach on the eastern tip of the island, popular with residents and day-trippers seeking a peaceful escape.',
    coordinates: [-79.3520, 43.6295],
    icon: '🏖',
  },
  {
    id: 'hanlan-beach',
    name: "Hanlan's Point Beach",
    description:
      "Toronto's clothing-optional beach on the western tip of the island, with views of the city skyline and Lake Ontario.",
    coordinates: [-79.3965, 43.6245],
    icon: '🏖',
  },
  {
    id: 'toronto-island-park',
    name: 'Toronto Island Park',
    description:
      'Over 550 acres of parkland, gardens, sports fields, and trails spread across 15 islands — a beloved green escape from the city.',
    coordinates: [-79.3784, 43.6260],
    icon: '🌿',
  },
];

export function LandmarkMarkers() {
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeLandmark = LANDMARKS.find((l) => l.id === activeId) ?? null;

  return (
    <>
      {LANDMARKS.map((landmark) => (
        <Marker
          key={landmark.id}
          longitude={landmark.coordinates[0]}
          latitude={landmark.coordinates[1]}
          anchor="center"
        >
          <button
            className="landmark-marker"
            type="button"
            aria-label={`Show info for ${landmark.name}`}
            onClick={() => setActiveId(landmark.id)}
          >
            {landmark.icon}
          </button>
        </Marker>
      ))}

      {activeLandmark && (
        <Popup
          longitude={activeLandmark.coordinates[0]}
          latitude={activeLandmark.coordinates[1]}
          anchor="bottom"
          closeButton={false}
          closeOnClick={false}
          className="landmark-popup"
          onClose={() => setActiveId(null)}
        >
          <button
            className="landmark-popup__close"
            type="button"
            aria-label="Close landmark info"
            onClick={() => setActiveId(null)}
          >
            &times;
          </button>
          <p className="landmark-popup__title">{activeLandmark.name}</p>
          <p className="landmark-popup__desc">{activeLandmark.description}</p>
        </Popup>
      )}
    </>
  );
}
