# Lantmäteriet Topografi 250 — power lines, railways, main roads, military areas

Bundled datasets for the Power Lines (SE), Railways (SE), Main Roads (SE) and
Military Areas (SE) layers, built from Lantmäteriet's open
[Topografi 250 Nedladdning, vektor](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/topografi-250-nedladdning-vektor/)
(delivered 2026-09-28).

## License

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): free to use and
publish. Attribution is not required; the app credits "© Lantmäteriet".

## Files

| File | Source table | Classes kept |
|---|---|---|
| `power.json` | `ledningar_sverige.gpkg` `ledningslinje` | Kraftledning stam (1702), region (1703) |
| `rail.json` | `kommunikation_sverige.gpkg` `ralstrafik` | Järnväg (1861), Museijärnväg (1862) |
| `roads.json` | `kommunikation_sverige.gpkg` `vaglinje` | Motorväg (1801), Motortrafikled (1802), Mötesfri väg (1803), Landsväg (1804), with road numbers |
| `military.json` | `militartomrade_sverige.gpkg` `militart_omrade` | Militärt övningsfält (5501), Militärt skjutfält (5503) |

`source.json` records line and point counts and SHA-256 hashes.

## Format

`gev-static-lines/1`: `classes` names the line classes and each entry of
`lines` is `[classIndex, label|null, coordinates]`. Coordinates are WGS84 in
1e-5 degree integers, the first point absolute and each later point a
difference from the previous one. Segments were merged per class and road
number and simplified (15–20 m) in SWEREF 99 TM before conversion.

Areas use `gev-static-areas/1`: each entry of `areas` is
`[classIndex, null, rings]`, the outer ring first and then holes, each ring
encoded like a line and closed. Rings are simplified at 10 m.

## Rebuild

```sh
node scripts/build-lantmateriet.mjs --from <folder with the theme zips or .gpkg files>
# themes left out keep their previous build
# or, once the Geotorget API accepts the account:
node scripts/build-lantmateriet.mjs   # LANTMATERIET_USERNAME/PASSWORD + LANTMATERIET_TOPT_250_ORDER_ID
```
