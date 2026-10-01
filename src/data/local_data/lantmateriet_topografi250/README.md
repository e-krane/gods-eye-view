# Lantmäteriet Topografi 250 — power lines, railways, main roads

Bundled line datasets for the Power Lines (SE), Railways (SE) and Main Roads
(SE) layers, built from Lantmäteriet's open
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

`source.json` records line and point counts and SHA-256 hashes.

## Format

`gev-static-lines/1`: `classes` names the line classes and each entry of
`lines` is `[classIndex, label|null, coordinates]`. Coordinates are WGS84 in
1e-5 degree integers, the first point absolute and each later point a
difference from the previous one. Segments were merged per class and road
number and simplified (15–20 m) in SWEREF 99 TM before conversion.

## Rebuild

```sh
node scripts/build-lantmateriet.mjs --from <folder with the theme zips or .gpkg files>
# or, once the Geotorget API accepts the account:
node scripts/build-lantmateriet.mjs   # LANTMATERIET_USERNAME/PASSWORD + LANTMATERIET_TOPT_250_ORDER_ID
```
