export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type RouteId =
  | 'jack-layton-wards'
  | 'jack-layton-centre'
  | 'jack-layton-hanlans';

export interface Departure {
  direction: 'outbound' | 'inbound'; // outbound = Jack Layton → island
  time: string;                        // HH:MM 24-hour
  days: DayOfWeek[];
}

export interface RouteSchedule {
  routeId: RouteId;
  name: string;
  seasonal: boolean;
  seasonStart: string | null; // "MM-DD" e.g. "04-15"
  seasonEnd: string | null;   // "MM-DD" e.g. "10-15"
  departures: Departure[];
}

export interface ScheduleData {
  generatedAt: string; // ISO 8601
  routes: RouteSchedule[];
}
