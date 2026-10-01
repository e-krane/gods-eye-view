# Third-party software notices

The project depends on third-party npm packages whose own licenses apply. This
file records the Apache-licensed packages added for the browser-local SDR
feature and the GNSS Interference layer; the complete resolved dependency
inventory remains in `package-lock.json`.

## Web RTL-SDR

- Package: `@jtarrio/webrtlsdr` 3.0.6
- Author: Jacobo Tarrio Barreiro; portions copyright Google Inc.
- Source: <https://github.com/jtarrio/webrtlsdr>
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

## Signals

- Package: `@jtarrio/signals` 0.10.1
- Author: Jacobo Tarrio Barreiro
- Source: <https://github.com/jtarrio/signals>
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

## geotiff.js

- Package: `geotiff` 2.1.3 (a development dependency, used only by
  `scripts/build-lantmateriet-hillshade.mjs` to read Lantmäteriet's elevation
  GeoTIFFs; it is not part of the app bundle)
- Author: EOX IT Services GmbH and contributors
- Source: <https://github.com/geotiffjs/geotiff.js>
- License: MIT
- License text: <https://github.com/geotiffjs/geotiff.js/blob/master/LICENSE>

## H3

- Package: `h3-js` 4.5.0 (used server-side by the `/api/gpsjam` proxy to turn
  H3 cells into hexagon boundaries)
- Author: Uber Technologies, Inc.
- Source: <https://github.com/uber/h3-js>
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>
