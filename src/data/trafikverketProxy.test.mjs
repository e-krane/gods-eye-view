import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trafikverketIncidentQuery,
  trafikverketProxy,
} from '../../server/providers/trafikverket.js';

const NOW = Date.parse('2026-09-29T12:00:00Z');

function situationBody(deviations) {
  return {
    RESPONSE: {
      RESULT: [
        { Situation: [{ Id: 'SE_STA_TRISSID_1_1', Deviation: deviations }] },
      ],
    },
  };
}

const accident = {
  Id: 'SE_STA_TRISSID_1_2',
  MessageType: 'Olycka',
  Header: 'Trafikolycka',
  RoadNumber: 'E4',
  SeverityCode: 4,
  StartTime: '2026-09-29T11:30:00.000+02:00',
  Geometry: { Point: { WGS84: 'POINT (18.0686 59.3293)' } },
};

function install(options = {}) {
  let handler;
  const plugin = trafikverketProxy({ now: () => NOW, ...options });
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(path, callback) {
          assert.equal(path, '/api/trafikverket');
          handler = callback;
        },
      },
    });
  }
  return async (url = '/incidents', method = 'GET') => {
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await handler({ url, method, socket: { remoteAddress: 'local' } }, res);
    return res;
  };
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('without a key the proxy answers no_key and never calls upstream', async () => {
  let calls = 0;
  const request = install({
    apiKey: () => '',
    fetchImpl: async () => {
      calls++;
      return json(situationBody([]));
    },
  });
  const res = await request();
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'no_key' });
  assert.equal(calls, 0);
  assert.equal((await request('/incidents', 'POST')).status, 405);
  assert.equal((await request('/other')).status, 404);
});

test('query carries the escaped key in the POST body and filters incident types', async () => {
  const xml = trafikverketIncidentQuery('a"b<c>&');
  assert.match(xml, /authenticationkey="a&quot;b&lt;c&gt;&amp;"/);
  assert.match(
    xml,
    /objecttype="Situation" namespace="Road\.TrafficInfo" schemaversion="1\.6"/,
  );
  assert.match(
    xml,
    /<IN name="Deviation\.MessageType" value="Olycka,Hinder,Viktig trafikinformation,Restriktion,Trafikmeddelande" \/>/,
  );
  assert.doesNotMatch(xml, /Vägarbete/);
  let seen;
  const request = install({
    apiKey: () => 'secret-key',
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return json(situationBody([accident]));
    },
  });
  const res = await request();
  assert.equal(res.status, 200);
  assert.equal(seen.url, 'https://api.trafikinfo.trafikverket.se/v2/data.json');
  assert.equal(seen.init.method, 'POST');
  assert.match(seen.init.body, /authenticationkey="secret-key"/);
  assert.equal(res.body.stale, false);
  assert.equal(res.body.count, 1);
  assert.deepEqual(
    [res.body.rows[0].id, res.body.rows[0].category, res.body.rows[0].lon],
    ['SE_STA_TRISSID_1_2', 'accident', 18.0686],
  );
  assert.doesNotMatch(JSON.stringify(res.body), /secret-key/);
});

test('a rejected key reports auth_failed and drops the cached snapshot', async () => {
  let mode = 'ok';
  let clock = NOW;
  let calls = 0;
  let key = 'key-1';
  const request = install({
    now: () => clock,
    apiKey: () => key,
    fetchImpl: async () =>
      ++calls && mode === 'ok'
        ? json(situationBody([accident]))
        : json(
            {
              RESPONSE: {
                RESULT: [
                  {
                    ERROR: {
                      SOURCE: 'Security',
                      MESSAGE: 'Invalid authentication',
                    },
                  },
                ],
              },
            },
            401,
          ),
  });
  assert.equal((await request()).status, 200);
  mode = 'auth';
  clock += 10 * 60_000;
  const rejected = await request();
  assert.equal(rejected.status, 502);
  assert.deepEqual(rejected.body, { error: 'auth_failed' });
  assert.equal(calls, 2);

  clock += 60_000;
  assert.deepEqual((await request()).body, { error: 'auth_failed' });
  assert.equal(calls, 2, 'a rejected key is not retried within the TTL');

  mode = 'ok';
  key = 'key-2';
  assert.equal((await request()).status, 200, 'a new key is tried at once');
  assert.equal(calls, 3);
});

test('snapshots are cached, served stale on upstream failure, and keyed by API key', async () => {
  let calls = 0;
  let fail = false;
  let key = 'key-1';
  let clock = NOW;
  const request = install({
    now: () => clock,
    apiKey: () => key,
    fetchImpl: async () => {
      calls++;
      if (fail) return json({ error: 'boom' }, 500);
      return json(situationBody([accident]));
    },
  });
  await request();
  await request();
  assert.equal(calls, 1, 'fresh cache answers without upstream');

  fail = true;
  clock += 5 * 60_000;
  const stale = await request();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.count, 1);
  assert.equal(calls, 2);

  clock += 60_000;
  assert.equal((await request()).body.stale, true);
  assert.equal(calls, 2, 'a failure is not retried within the TTL');

  fail = false;
  clock += 60_000;
  const recovered = await request();
  assert.equal(recovered.body.stale, false);
  assert.equal(calls, 3, 'upstream is retried once the TTL has passed');

  fail = true;
  key = 'key-2';
  const other = await request();
  assert.equal(other.status, 502, 'a new key never inherits old rows');
  assert.deepEqual(other.body, { error: 'trafikverket_unavailable' });
});
