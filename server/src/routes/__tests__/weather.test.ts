/**
 * Unit tests for the observation-derived weather condition logic.
 *
 * Background: the upstream MSC SWOB feed at CYTZ emits NAV CANADA AWOS
 * `prsnt_wx_1` codes (values like 300) that fall outside the WMO 4677
 * synoptic table. A single-code lookup is unreliable. `transformGeoMet`
 * must derive `condition` from real observations (precipitation amount,
 * cloud cover, visibility, temperature) instead.
 *
 * The live fixture under __fixtures__ is a captured response from the
 * production upstream URL — field names here come from the real ECCC API,
 * not from invention.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { transformGeoMet } from '../weather';

const fixturePath = path.join(
  __dirname,
  '..',
  '__fixtures__',
  'geomet-cytz-live.json',
);
const liveFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function withProps(patch: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(liveFixture));
  clone.features[0].properties = {
    ...clone.features[0].properties,
    ...patch,
  };
  return clone;
}

describe('transformGeoMet — observation-derived condition', () => {
  it('clear sky: no precipitation, clear cloud code, good visibility → "Clear"', () => {
    const raw = withProps({
      pcpn_amt_pst1hr: 0.0,
      cld_amt_code_1: 0,
      avg_vis_pst10mts: 20,
      prsnt_wx_1: null,
    });
    const obs = transformGeoMet(raw);
    expect(obs.condition).toBe('Clear');
    expect(obs.precipitationWarning).toBe(false);
  });

  it('drizzle: light precipitation (~0.2 mm in the past hour) → "Drizzle" with warning', () => {
    const raw = withProps({
      pcpn_amt_pst1hr: 0.2,
      cld_amt_code_1: 7,
      avg_vis_pst10mts: 12,
      air_temp: 6,
      prsnt_wx_1: null,
    });
    const obs = transformGeoMet(raw);
    expect(obs.condition).toBe('Drizzle');
    expect(obs.precipitationWarning).toBe(true);
  });

  it('thunderstorm: WMO 4677 thunder code (95) is the one narrow code-trust exception', () => {
    const raw = withProps({
      pcpn_amt_pst1hr: 2.0,
      cld_amt_code_1: 8,
      avg_vis_pst10mts: 5,
      prsnt_wx_1: 95,
    });
    const obs = transformGeoMet(raw);
    expect(obs.condition).toBe('Thunderstorm');
    expect(obs.precipitationWarning).toBe(true);
  });

  it('fog: visibility < 1 km, no precipitation → "Fog"', () => {
    const raw = withProps({
      pcpn_amt_pst1hr: 0,
      avg_vis_pst10mts: 0.4,
      cld_amt_code_1: 8,
      prsnt_wx_1: null,
    });
    const obs = transformGeoMet(raw);
    expect(obs.condition).toBe('Fog');
    expect(obs.precipitationWarning).toBe(false);
  });

  it('prsnt_wx_1=300 sentinel: AWOS-only code never produces the old stub "Drizzle"', () => {
    // The live fixture has prsnt_wx_1=300 with pcpn=0, cld=3, vis=16.09 km.
    // Old behaviour returned "Drizzle" from the 300-399 stub.
    // New behaviour: derive from observations (cld=3 → "Partly Cloudy").
    const obs = transformGeoMet(liveFixture);
    expect(obs.condition).toBe('Partly Cloudy');
    expect(obs.precipitationWarning).toBe(false);
    expect(obs.presentWeatherCode).toBe('300');
  });
});

describe('transformGeoMet — extended observation fields', () => {
  it('parses dew point, cloud oktas, and 1h/24h precipitation from the live fixture', () => {
    const obs = transformGeoMet(liveFixture);
    expect(obs.dewPointCelsius).toBe(5.2);
    expect(obs.cloudAmountOktas).toBe(3);
    expect(obs.precipitationLastHourMm).toBe(0);
    expect(obs.precipitationLast24hMm).toBe(22.9);
    expect(obs.observedAt).toBe('2026-04-26T00:00:00.000Z');
    expect(obs.visibilityKm).toBe(16.09);
  });

  it('returns null for new fields when upstream omits them', () => {
    const raw = withProps({
      dwpt_temp: null,
      cld_amt_code_1: null,
      pcpn_amt_pst1hr: null,
      pcpn_amt_pst24hrs: null,
    });
    const obs = transformGeoMet(raw);
    expect(obs.dewPointCelsius).toBeNull();
    expect(obs.cloudAmountOktas).toBeNull();
    expect(obs.precipitationLastHourMm).toBeNull();
    expect(obs.precipitationLast24hMm).toBeNull();
  });
});
