/**
 * Curated Baltic seabed-infrastructure incidents. Every fact below was read
 * on the cited pages on 2026-09-30. Locations are estimates from what the
 * sources say (an economic zone, a distance from a town, a cable route);
 * `uncertaintyKm` is the radius the damage point is believed to lie within,
 * and `locationBasis` says how it was placed. Review `status` and
 * `statusAsOf` as investigations and trials conclude, then bump
 * `SEABED_DATASET_AS_OF`.
 *
 * Status choice: `suspected` when crew are charged with or tried for
 * deliberate damage and no verdict exists; `attributed` when investigators
 * tie the damage to a ship's anchor but intent was not established;
 * `ruled_accidental` when prosecutors concluded it was not sabotage.
 *
 * Left out for lack of a source reachable when compiled: the Arelion
 * Šventoji–Liepāja cable damage of 2 January 2026 (Latvian EEZ).
 */

export const SEABED_DATASET_AS_OF = '2026-09-30';

export const SEABED_INCIDENTS = Object.freeze([
  {
    id: 'fitburg-2025-12',
    date: '2025-12-31',
    title: 'Elisa and Arelion cables',
    assets: [
      'Elisa telecom cable (Helsinki–Tallinn)',
      'Arelion telecom cable (Finland–Estonia)',
    ],
    vessel: 'Fitburg (Saint Vincent and the Grenadines)',
    status: 'suspected',
    statusAsOf: '2026-09-08',
    lon: 24.85,
    lat: 59.68,
    uncertaintyKm: 15,
    locationBasis:
      "ERR: the damage was in Estonia's exclusive economic zone on the Helsinki–Tallinn route. Placed in that part of the Gulf of Finland; the exact point is not in the sources.",
    summary:
      "Two telecom cables were damaged on New Year's Eve. Finnish authorities seized the Fitburg with its anchor chain in the water; investigators say it dragged a broken anchor at least 130 km. Its captain and bosun are on trial for aggravated sabotage and deny the charges.",
    sources: [
      {
        title:
          'Fitburg defendants deny sabotage as second anchor-dragging trial begins',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20245189',
        date: '2026-09-08',
      },
      {
        title:
          'Finland detains vessel after cable damaged between Tallinn and Helsinki',
        publisher: 'ERR',
        url: 'https://news.err.ee/1609898537/finland-detains-vessel-after-cable-damaged-between-tallinn-and-helsinki',
        date: '2025-12-31',
      },
      {
        title:
          'Finnish authorities seize vessel following sea cable disruption',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20202087',
        date: '2025-12-31',
      },
      {
        title: "Charges filed over New Year's cable damage in Gulf of Finland",
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20231651',
        date: '2026-06-15',
      },
    ],
  },
  {
    id: 'lvrtc-2025-01',
    date: '2025-01-26',
    title: 'Latvia–Gotland cable',
    assets: ['LVRTC telecom cable (Ventspils–Gotland)'],
    vessel: 'Vezhen (Malta)',
    status: 'ruled_accidental',
    statusAsOf: '2025-02-03',
    lon: 19.55,
    lat: 57.4,
    uncertaintyKm: 40,
    locationBasis:
      "ERR (citing LETA): damage on the Ventspils–Gotland section, within Sweden's economic zone. Placed on the Swedish part of that route.",
    summary:
      'The cable was damaged early on 26 January 2025 and Sweden seized the Vezhen. Prosecutors found the ship caused the break but that it was not sabotage: weather and deficiencies in equipment and seamanship contributed.',
    sources: [
      {
        title: 'Inte fråga om kabelsabotage mellan Sverige och Lettland',
        publisher: 'Svenska Yle',
        url: 'https://yle.fi/a/7-10071933',
        date: '2025-02-03',
      },
      {
        title:
          "Latvian State Radio and TV Center's optic cable damaged in Baltic Sea",
        publisher: 'ERR',
        url: 'https://news.err.ee/1609587038/latvian-state-radio-and-tv-center-s-optic-cable-damaged-in-baltic-sea',
        date: '2025-01-26',
      },
      {
        title:
          'Sjökabel mellan Sverige och Lettland har skadats – Sverige har tagit ett misstänkt fartyg i beslag',
        publisher: 'Svenska Yle',
        url: 'https://yle.fi/a/7-10071419',
        date: '2025-01-26',
      },
    ],
  },
  {
    id: 'clion1-2025-01',
    date: '2025-01-26',
    title: 'C-Lion1 (sheath)',
    assets: ['C-Lion1 telecom cable (Helsinki–Rostock), outer sheath only'],
    vessel: null,
    status: 'unresolved',
    statusAsOf: '2025-02-24',
    lon: 19.45,
    lat: 57.3,
    uncertaintyKm: 45,
    locationBasis:
      "Cinia (via Yle): in Sweden's economic zone near where the Gotland–Ventspils cable broke the same night. Placed near that break.",
    summary:
      "Cinia reported a defect in C-Lion1's sheathing in February 2025 and dated it to the night of the Gotland–Ventspils break. The fibres were not damaged. Whether the Vezhen's anchor also caused this is possible but unconfirmed.",
    sources: [
      {
        title: 'New disruption of Finland-Germany cable reported in Baltic Sea',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20145195',
        date: '2025-02-21',
      },
      {
        title:
          'Cinia tarkentaa: Uusin Itämeren kaapelivaurio sattui toisen vaurion aikaan tammikuussa',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20145735',
        date: '2025-02-24',
      },
      {
        title:
          'Datakabel mellan Finland och Tyskland skadad för tredje gången – kan ha skadats redan i januari',
        publisher: 'Svenska Yle',
        url: 'https://yle.fi/a/7-10073062',
        date: '2025-02-21',
      },
    ],
  },
  {
    id: 'estlink2-2024-12',
    date: '2024-12-25',
    title: 'Estlink 2',
    assets: [
      'Estlink 2 power cable (Finland–Estonia)',
      'Four other cables in the Gulf of Finland',
    ],
    vessel: 'Eagle S (Cook Islands)',
    status: 'suspected',
    statusAsOf: '2026-08-27',
    lon: 26.23,
    lat: 59.96,
    uncertaintyKm: 10,
    locationBasis:
      "Finnish Government: Estlink 2 was cut in Finland's exclusive economic zone about 55 km south of Loviisa. Applies to Estlink 2; the telecom cables broke elsewhere on the drag path.",
    summary:
      'The tanker Eagle S is suspected of dragging its anchor about 90 km and damaging five cables on Christmas Day 2024. Its captain and two officers were tried for suspected sabotage; the district court found it lacked jurisdiction, and the Court of Appeal reversed that in August 2026.',
    sources: [
      {
        title:
          'Estlink 2 electricity transmission cable damaged in the Baltic Sea on 25 Dec 2024',
        publisher: 'Finnish Government',
        url: 'https://valtioneuvosto.fi/en/-/44957406/estlink-2-electricity-transmission-cable-damaged-in-the-baltic-sea-on-25-dec-2024',
        date: '2024-12-26',
      },
      {
        title:
          'Court u-turn: Finland does have jurisdiction in Eagle S cable damage case',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20243196',
        date: '2026-08-27',
      },
      {
        title:
          'Eagle S captain, two officers to face trial over suspected sabotage of undersea cables',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20176864',
        date: '2025-08-11',
      },
      {
        title: 'Finnish court: We have no jurisdiction in Eagle S case',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20186464',
        date: '2025-10-03',
      },
    ],
  },
  {
    id: 'clion1-2024-11',
    date: '2024-11-18',
    title: 'C-Lion1',
    assets: ['C-Lion1 telecom cable (Helsinki–Rostock)'],
    vessel: 'Yi Peng 3 (China)',
    status: 'attributed',
    statusAsOf: '2025-04-15',
    lon: 17.2,
    lat: 56.2,
    uncertaintyKm: 35,
    locationBasis:
      "Cinia (via Yle): broken in Sweden's exclusive economic zone, east of the southern end of Öland, about 700 km from Helsinki.",
    summary:
      "C-Lion1 broke early on Monday 18 November 2024, a day after the Sweden–Lithuania cable. Sweden's accident investigators found that the Yi Peng 3 dragged its anchor 180 nautical miles and damaged the cables, but could not prove it was deliberate.",
    sources: [
      {
        title: "Team starts fixing Finland's broken telecom cable",
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20127099',
        date: '2024-11-25',
      },
      {
        title:
          'Ruotsi ei ole pystynyt osoittamaan, että kiinalaisalus Yi Peng vahingoitti Itämeren kaapeleita tahallaan',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20156270',
        date: '2025-04-15',
      },
      {
        title:
          "Finnish PM 'not jumping to conclusions' about damaged telecoms cables",
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20125773',
        date: '2024-11-19',
      },
    ],
  },
  {
    id: 'sweden-lithuania-2024-11',
    date: '2024-11-17',
    title: 'Sweden–Lithuania cable',
    assets: [
      'Sweden–Lithuania telecom cable (Gotland–Šventoji, managed by Arelion)',
    ],
    vessel: 'Yi Peng 3 (China)',
    status: 'attributed',
    statusAsOf: '2025-04-15',
    lon: 19.96,
    lat: 56.73,
    uncertaintyKm: 110,
    locationBasis:
      'The sources checked give no break point, only that it was dozens of nautical miles from the C-Lion1 break. Placed at the middle of the Gotland–Šventoji route; the circle covers the route.',
    summary:
      "The Sweden–Lithuania cable broke on Sunday 17 November 2024, the day before C-Lion1. Sweden's accident investigators found the Yi Peng 3 dragged its anchor and damaged the cables but could not prove intent. Arelion repaired the cable within days.",
    sources: [
      {
        title:
          'Ruotsi ei ole pystynyt osoittamaan, että kiinalaisalus Yi Peng vahingoitti Itämeren kaapeleita tahallaan',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20156270',
        date: '2025-04-15',
      },
      {
        title:
          "Finnish PM 'not jumping to conclusions' about damaged telecoms cables",
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20125773',
        date: '2024-11-19',
      },
      {
        title: 'Finland, Sweden complete repairs on Baltic Sea cables',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20128140',
        date: '2024-11-29',
      },
    ],
  },
  {
    id: 'balticconnector-2023-10',
    date: '2023-10-08',
    title: 'Balticconnector',
    assets: ['Balticconnector gas pipeline (Finland–Estonia)'],
    vessel: 'NewNew Polar Bear (Hong Kong)',
    status: 'attributed',
    statusAsOf: '2025-05-09',
    lon: 24.03,
    lat: 59.83,
    uncertaintyKm: 20,
    locationBasis:
      "Finnish Government: the leak is in Finland's economic zone. Placed on the Finnish part of the Inkoo–Paldiski pipeline route; the exact point is not in the sources.",
    summary:
      "A leak was detected early on 8 October 2023. Finnish investigators found an anchor and drag marks by the pipeline and concluded the NewNew Polar Bear's anchor caused the damage. China acknowledged its ship did it but called it an accident in a severe storm.",
    sources: [
      {
        title: 'Cooperation in Balticconnector case to continue',
        publisher: 'Finnish Government',
        url: 'https://valtioneuvosto.fi/en/-/25235045/cooperation-in-balticconnector-case-to-continue',
        date: '2025-05-09',
      },
      {
        title:
          "Location of leak in Balticconnector gas pipeline identified in Finland's economic zone",
        publisher: 'Finnish Government',
        url: 'https://valtioneuvosto.fi/en/-//10616/location-of-leak-in-balticconnector-gas-pipeline-identified-in-finland-s-economic-zone',
        date: '2023-10-10',
      },
      {
        title:
          'Media: China admits cargo ship damaged Balticconnector pipeline',
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20104546',
        date: '2024-08-12',
      },
      {
        title:
          "Finnish investigators suspect Chinese vessel's anchor caused Balticconnector pipeline damage",
        publisher: 'Yle',
        url: 'https://yle.fi/a/74-20056827',
        date: '2023-10-24',
      },
    ],
  },
]);
