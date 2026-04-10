export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type RouteId =
  | 'jack-layton-wards'
  | 'jack-layton-centre'
  | 'jack-layton-hanlans'
  | 'jack-layton-billy-bishop';

export type SeasonId = 'winter' | 'spring' | 'summer' | 'fall' | 'ice';

export interface Departure {
  direction: 'outbound' | 'inbound'; // outbound = Jack Layton → island
  time: string; // HH:MM 24-hour
  days: DayOfWeek[];
  peakOnly?: boolean; // true if only runs on peak operating days
}

export interface RouteSchedule {
  routeId: RouteId;
  name: string;
  seasonal: boolean;
  seasonStart: string | null;
  seasonEnd: string | null;
  departures: Departure[];
}

export interface ScheduleSeason {
  seasonId: SeasonId;
  name: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveUntil: string; // YYYY-MM-DD
  note?: string; // e.g., beltline info
  routes: RouteSchedule[];
}

export interface ScheduleData {
  generatedAt: string; // ISO 8601
  source: string;
  seasons: ScheduleSeason[];
}
