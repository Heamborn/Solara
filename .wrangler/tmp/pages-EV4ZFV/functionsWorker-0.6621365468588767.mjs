var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../.wrangler/tmp/bundle-ff7aL2/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// ../.wrangler/tmp/bundle-ff7aL2/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// api/login.ts
var MAX_AGE_SECONDS = 48 * 60 * 60;
async function onRequestPost(context) {
  const { request, env } = context;
  const passwordEnv = env.PASSWORD;
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({ password: "" }));
  const providedPassword = typeof body.password === "string" ? body.password : "";
  if (typeof passwordEnv !== "string") {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (providedPassword === passwordEnv) {
    const cookieSegments = [
      `auth=${btoa(passwordEnv)}`,
      `Max-Age=${MAX_AGE_SECONDS}`,
      "Path=/",
      "SameSite=Lax",
      "HttpOnly"
    ];
    if (url.protocol === "https:") {
      cookieSegments.push("Secure");
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookieSegments.join("; ")
      }
    });
  }
  return new Response(JSON.stringify({ success: false }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
__name(onRequestPost, "onRequestPost");

// api/storage.ts
var JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var FAVORITE_KEYS = /* @__PURE__ */ new Set([
  "favoriteSongs",
  "currentFavoriteIndex",
  "favoritePlayMode",
  "favoritePlaybackTime"
]);
var TABLES = {
  playback: "playback_store",
  favorites: "favorites_store"
};
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
__name(jsonResponse, "jsonResponse");
function hasD1(env) {
  return Boolean(env.DB && typeof env.DB.prepare === "function");
}
__name(hasD1, "hasD1");
function getTableForKey(key) {
  if (FAVORITE_KEYS.has(key)) {
    return TABLES.favorites;
  }
  return TABLES.playback;
}
__name(getTableForKey, "getTableForKey");
async function ensureTables(env) {
  if (!hasD1(env)) {
    return;
  }
  const createStatements = [
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS playback_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS favorites_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
  ];
  await env.DB.batch(createStatements);
}
__name(ensureTables, "ensureTables");
async function handleGet(request, env) {
  const url = new URL(request.url);
  if (!hasD1(env)) {
    return jsonResponse({ d1Available: false, data: {} });
  }
  const statusOnly = url.searchParams.get("status");
  if (statusOnly) {
    return jsonResponse({ d1Available: true });
  }
  const keysParam = url.searchParams.get("keys") || "";
  const keys = keysParam.split(",").map((key) => key.trim()).filter(Boolean);
  await ensureTables(env);
  const data = {};
  let rows = [];
  if (keys.length > 0) {
    const groupedKeys = keys.reduce(
      (acc, key) => {
        const table = getTableForKey(key);
        acc[table].push(key);
        return acc;
      },
      { [TABLES.playback]: [], [TABLES.favorites]: [] }
    );
    const results = [];
    for (const [table, tableKeys] of Object.entries(groupedKeys)) {
      if (tableKeys.length === 0)
        continue;
      const placeholders = tableKeys.map(() => "?").join(",");
      const statement = env.DB.prepare(
        `SELECT key, value FROM ${table} WHERE key IN (${placeholders})`
      ).bind(...tableKeys);
      const result = await statement.all();
      const rowsResult = result.results || result.results || [];
      results.push(...rowsResult);
    }
    rows = results;
    keys.forEach((key) => {
      data[key] = null;
    });
  } else {
    const playbackResult = await env.DB.prepare(
      "SELECT key, value FROM playback_store"
    ).all();
    const favoriteResult = await env.DB.prepare(
      "SELECT key, value FROM favorites_store"
    ).all();
    rows = [
      ...playbackResult.results || playbackResult.results || [],
      ...favoriteResult.results || favoriteResult.results || []
    ];
  }
  rows.forEach((row) => {
    if (!row || typeof row.key !== "string")
      return;
    data[row.key] = row.value;
  });
  return jsonResponse({ d1Available: true, data });
}
__name(handleGet, "handleGet");
async function handlePost(request, env) {
  if (!hasD1(env)) {
    return jsonResponse({ d1Available: false, data: {} });
  }
  const body = await request.json().catch(() => ({}));
  const payload = body.data && typeof body.data === "object" ? body.data : null;
  if (!payload || Array.isArray(payload)) {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }
  const entries = Object.entries(payload).filter(([key]) => Boolean(key));
  if (entries.length === 0) {
    return jsonResponse({ d1Available: true, updated: 0 });
  }
  await ensureTables(env);
  const groupedStatements = {
    [TABLES.playback]: [],
    [TABLES.favorites]: []
  };
  entries.forEach(([key, value]) => {
    const storedValue = value == null ? "" : String(value);
    const table = getTableForKey(key);
    groupedStatements[table].push(
      env.DB.prepare(
        `INSERT INTO ${table} (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, storedValue)
    );
  });
  const batches = [];
  Object.values(groupedStatements).forEach((statements) => {
    if (statements.length > 0) {
      batches.push(env.DB.batch(statements));
    }
  });
  await Promise.all(batches);
  return jsonResponse({ d1Available: true, updated: entries.length });
}
__name(handlePost, "handlePost");
async function handleDelete(request, env) {
  if (!hasD1(env)) {
    return jsonResponse({ d1Available: false });
  }
  const body = await request.json().catch(() => ({}));
  const keys = Array.isArray(body.keys) ? body.keys.filter((key) => typeof key === "string" && Boolean(key)) : [];
  if (keys.length === 0) {
    return jsonResponse({ d1Available: true, deleted: 0 });
  }
  await ensureTables(env);
  const groupedStatements = {
    [TABLES.playback]: [],
    [TABLES.favorites]: []
  };
  keys.forEach((key) => {
    const table = getTableForKey(key);
    groupedStatements[table].push(
      env.DB.prepare(`DELETE FROM ${table} WHERE key = ?1`).bind(key)
    );
  });
  const batches = [];
  Object.values(groupedStatements).forEach((statements) => {
    if (statements.length > 0) {
      batches.push(env.DB.batch(statements));
    }
  });
  await Promise.all(batches);
  return jsonResponse({ d1Available: true, deleted: keys.length });
}
__name(handleDelete, "handleDelete");
async function onRequest(context) {
  const { request, env } = context;
  const method = (request.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (method === "GET") {
    return handleGet(request, env);
  }
  if (method === "POST") {
    return handlePost(request, env);
  }
  if (method === "DELETE") {
    return handleDelete(request, env);
  }
  return jsonResponse({ error: "Method not allowed" }, 405);
}
__name(onRequest, "onRequest");

// lib/vendor/jpeg-decoder.js
var JpegImage = (/* @__PURE__ */ __name(function jpegImage() {
  "use strict";
  var dctZigZag = new Int32Array([
    0,
    1,
    8,
    16,
    9,
    2,
    3,
    10,
    17,
    24,
    32,
    25,
    18,
    11,
    4,
    5,
    12,
    19,
    26,
    33,
    40,
    48,
    41,
    34,
    27,
    20,
    13,
    6,
    7,
    14,
    21,
    28,
    35,
    42,
    49,
    56,
    57,
    50,
    43,
    36,
    29,
    22,
    15,
    23,
    30,
    37,
    44,
    51,
    58,
    59,
    52,
    45,
    38,
    31,
    39,
    46,
    53,
    60,
    61,
    54,
    47,
    55,
    62,
    63
  ]);
  var dctCos1 = 4017;
  var dctSin1 = 799;
  var dctCos3 = 3406;
  var dctSin3 = 2276;
  var dctCos6 = 1567;
  var dctSin6 = 3784;
  var dctSqrt2 = 5793;
  var dctSqrt1d2 = 2896;
  function constructor() {
  }
  __name(constructor, "constructor");
  function buildHuffmanTable(codeLengths, values) {
    var k = 0, code = [], i, j, length = 16;
    while (length > 0 && !codeLengths[length - 1])
      length--;
    code.push({ children: [], index: 0 });
    var p = code[0], q;
    for (i = 0; i < length; i++) {
      for (j = 0; j < codeLengths[i]; j++) {
        p = code.pop();
        p.children[p.index] = values[k];
        while (p.index > 0) {
          if (code.length === 0)
            throw new Error("Could not recreate Huffman Table");
          p = code.pop();
        }
        p.index++;
        code.push(p);
        while (code.length <= i) {
          code.push(q = { children: [], index: 0 });
          p.children[p.index] = q.children;
          p = q;
        }
        k++;
      }
      if (i + 1 < length) {
        code.push(q = { children: [], index: 0 });
        p.children[p.index] = q.children;
        p = q;
      }
    }
    return code[0].children;
  }
  __name(buildHuffmanTable, "buildHuffmanTable");
  function decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive, opts) {
    var precision = frame.precision;
    var samplesPerLine = frame.samplesPerLine;
    var scanLines = frame.scanLines;
    var mcusPerLine = frame.mcusPerLine;
    var progressive = frame.progressive;
    var maxH = frame.maxH, maxV = frame.maxV;
    var startOffset = offset, bitsData = 0, bitsCount = 0;
    function readBit() {
      if (bitsCount > 0) {
        bitsCount--;
        return bitsData >> bitsCount & 1;
      }
      bitsData = data[offset++];
      if (bitsData == 255) {
        var nextByte = data[offset++];
        if (nextByte) {
          throw new Error("unexpected marker: " + (bitsData << 8 | nextByte).toString(16));
        }
      }
      bitsCount = 7;
      return bitsData >>> 7;
    }
    __name(readBit, "readBit");
    function decodeHuffman(tree) {
      var node = tree, bit;
      while ((bit = readBit()) !== null) {
        node = node[bit];
        if (typeof node === "number")
          return node;
        if (typeof node !== "object")
          throw new Error("invalid huffman sequence");
      }
      return null;
    }
    __name(decodeHuffman, "decodeHuffman");
    function receive(length) {
      var n2 = 0;
      while (length > 0) {
        var bit = readBit();
        if (bit === null)
          return;
        n2 = n2 << 1 | bit;
        length--;
      }
      return n2;
    }
    __name(receive, "receive");
    function receiveAndExtend(length) {
      var n2 = receive(length);
      if (n2 >= 1 << length - 1)
        return n2;
      return n2 + (-1 << length) + 1;
    }
    __name(receiveAndExtend, "receiveAndExtend");
    function decodeBaseline(component2, zz) {
      var t = decodeHuffman(component2.huffmanTableDC);
      var diff = t === 0 ? 0 : receiveAndExtend(t);
      zz[0] = component2.pred += diff;
      var k2 = 1;
      while (k2 < 64) {
        var rs = decodeHuffman(component2.huffmanTableAC);
        var s = rs & 15, r = rs >> 4;
        if (s === 0) {
          if (r < 15)
            break;
          k2 += 16;
          continue;
        }
        k2 += r;
        var z = dctZigZag[k2];
        zz[z] = receiveAndExtend(s);
        k2++;
      }
    }
    __name(decodeBaseline, "decodeBaseline");
    function decodeDCFirst(component2, zz) {
      var t = decodeHuffman(component2.huffmanTableDC);
      var diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
      zz[0] = component2.pred += diff;
    }
    __name(decodeDCFirst, "decodeDCFirst");
    function decodeDCSuccessive(component2, zz) {
      zz[0] |= readBit() << successive;
    }
    __name(decodeDCSuccessive, "decodeDCSuccessive");
    var eobrun = 0;
    function decodeACFirst(component2, zz) {
      if (eobrun > 0) {
        eobrun--;
        return;
      }
      var k2 = spectralStart, e = spectralEnd;
      while (k2 <= e) {
        var rs = decodeHuffman(component2.huffmanTableAC);
        var s = rs & 15, r = rs >> 4;
        if (s === 0) {
          if (r < 15) {
            eobrun = receive(r) + (1 << r) - 1;
            break;
          }
          k2 += 16;
          continue;
        }
        k2 += r;
        var z = dctZigZag[k2];
        zz[z] = receiveAndExtend(s) * (1 << successive);
        k2++;
      }
    }
    __name(decodeACFirst, "decodeACFirst");
    var successiveACState = 0, successiveACNextValue;
    function decodeACSuccessive(component2, zz) {
      var k2 = spectralStart, e = spectralEnd, r = 0;
      while (k2 <= e) {
        var z = dctZigZag[k2];
        var direction = zz[z] < 0 ? -1 : 1;
        switch (successiveACState) {
          case 0:
            var rs = decodeHuffman(component2.huffmanTableAC);
            var s = rs & 15, r = rs >> 4;
            if (s === 0) {
              if (r < 15) {
                eobrun = receive(r) + (1 << r);
                successiveACState = 4;
              } else {
                r = 16;
                successiveACState = 1;
              }
            } else {
              if (s !== 1)
                throw new Error("invalid ACn encoding");
              successiveACNextValue = receiveAndExtend(s);
              successiveACState = r ? 2 : 3;
            }
            continue;
          case 1:
          case 2:
            if (zz[z])
              zz[z] += (readBit() << successive) * direction;
            else {
              r--;
              if (r === 0)
                successiveACState = successiveACState == 2 ? 3 : 0;
            }
            break;
          case 3:
            if (zz[z])
              zz[z] += (readBit() << successive) * direction;
            else {
              zz[z] = successiveACNextValue << successive;
              successiveACState = 0;
            }
            break;
          case 4:
            if (zz[z])
              zz[z] += (readBit() << successive) * direction;
            break;
        }
        k2++;
      }
      if (successiveACState === 4) {
        eobrun--;
        if (eobrun === 0)
          successiveACState = 0;
      }
    }
    __name(decodeACSuccessive, "decodeACSuccessive");
    function decodeMcu(component2, decode2, mcu2, row, col) {
      var mcuRow = mcu2 / mcusPerLine | 0;
      var mcuCol = mcu2 % mcusPerLine;
      var blockRow = mcuRow * component2.v + row;
      var blockCol = mcuCol * component2.h + col;
      if (component2.blocks[blockRow] === void 0 && opts.tolerantDecoding)
        return;
      decode2(component2, component2.blocks[blockRow][blockCol]);
    }
    __name(decodeMcu, "decodeMcu");
    function decodeBlock(component2, decode2, mcu2) {
      var blockRow = mcu2 / component2.blocksPerLine | 0;
      var blockCol = mcu2 % component2.blocksPerLine;
      if (component2.blocks[blockRow] === void 0 && opts.tolerantDecoding)
        return;
      decode2(component2, component2.blocks[blockRow][blockCol]);
    }
    __name(decodeBlock, "decodeBlock");
    var componentsLength = components.length;
    var component, i, j, k, n;
    var decodeFn;
    if (progressive) {
      if (spectralStart === 0)
        decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
      else
        decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
    } else {
      decodeFn = decodeBaseline;
    }
    var mcu = 0, marker;
    var mcuExpected;
    if (componentsLength == 1) {
      mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
    } else {
      mcuExpected = mcusPerLine * frame.mcusPerColumn;
    }
    if (!resetInterval)
      resetInterval = mcuExpected;
    var h, v;
    while (mcu < mcuExpected) {
      for (i = 0; i < componentsLength; i++)
        components[i].pred = 0;
      eobrun = 0;
      if (componentsLength == 1) {
        component = components[0];
        for (n = 0; n < resetInterval; n++) {
          decodeBlock(component, decodeFn, mcu);
          mcu++;
        }
      } else {
        for (n = 0; n < resetInterval; n++) {
          for (i = 0; i < componentsLength; i++) {
            component = components[i];
            h = component.h;
            v = component.v;
            for (j = 0; j < v; j++) {
              for (k = 0; k < h; k++) {
                decodeMcu(component, decodeFn, mcu, j, k);
              }
            }
          }
          mcu++;
          if (mcu === mcuExpected)
            break;
        }
      }
      if (mcu === mcuExpected) {
        do {
          if (data[offset] === 255) {
            if (data[offset + 1] !== 0) {
              break;
            }
          }
          offset += 1;
        } while (offset < data.length - 2);
      }
      bitsCount = 0;
      marker = data[offset] << 8 | data[offset + 1];
      if (marker < 65280) {
        throw new Error("marker was not found");
      }
      if (marker >= 65488 && marker <= 65495) {
        offset += 2;
      } else
        break;
    }
    return offset - startOffset;
  }
  __name(decodeScan, "decodeScan");
  function buildComponentData(frame, component) {
    var lines = [];
    var blocksPerLine = component.blocksPerLine;
    var blocksPerColumn = component.blocksPerColumn;
    var samplesPerLine = blocksPerLine << 3;
    var R = new Int32Array(64), r = new Uint8Array(64);
    function quantizeAndInverse(zz, dataOut, dataIn) {
      var qt = component.quantizationTable;
      var v0, v1, v2, v3, v4, v5, v6, v7, t;
      var p = dataIn;
      var i2;
      for (i2 = 0; i2 < 64; i2++)
        p[i2] = zz[i2] * qt[i2];
      for (i2 = 0; i2 < 8; ++i2) {
        var row = 8 * i2;
        if (p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 && p[4 + row] == 0 && p[5 + row] == 0 && p[6 + row] == 0 && p[7 + row] == 0) {
          t = dctSqrt2 * p[0 + row] + 512 >> 10;
          p[0 + row] = t;
          p[1 + row] = t;
          p[2 + row] = t;
          p[3 + row] = t;
          p[4 + row] = t;
          p[5 + row] = t;
          p[6 + row] = t;
          p[7 + row] = t;
          continue;
        }
        v0 = dctSqrt2 * p[0 + row] + 128 >> 8;
        v1 = dctSqrt2 * p[4 + row] + 128 >> 8;
        v2 = p[2 + row];
        v3 = p[6 + row];
        v4 = dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128 >> 8;
        v7 = dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128 >> 8;
        v5 = p[3 + row] << 4;
        v6 = p[5 + row] << 4;
        t = v0 - v1 + 1 >> 1;
        v0 = v0 + v1 + 1 >> 1;
        v1 = t;
        t = v2 * dctSin6 + v3 * dctCos6 + 128 >> 8;
        v2 = v2 * dctCos6 - v3 * dctSin6 + 128 >> 8;
        v3 = t;
        t = v4 - v6 + 1 >> 1;
        v4 = v4 + v6 + 1 >> 1;
        v6 = t;
        t = v7 + v5 + 1 >> 1;
        v5 = v7 - v5 + 1 >> 1;
        v7 = t;
        t = v0 - v3 + 1 >> 1;
        v0 = v0 + v3 + 1 >> 1;
        v3 = t;
        t = v1 - v2 + 1 >> 1;
        v1 = v1 + v2 + 1 >> 1;
        v2 = t;
        t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
        v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
        v7 = t;
        t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
        v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
        v6 = t;
        p[0 + row] = v0 + v7;
        p[7 + row] = v0 - v7;
        p[1 + row] = v1 + v6;
        p[6 + row] = v1 - v6;
        p[2 + row] = v2 + v5;
        p[5 + row] = v2 - v5;
        p[3 + row] = v3 + v4;
        p[4 + row] = v3 - v4;
      }
      for (i2 = 0; i2 < 8; ++i2) {
        var col = i2;
        if (p[1 * 8 + col] == 0 && p[2 * 8 + col] == 0 && p[3 * 8 + col] == 0 && p[4 * 8 + col] == 0 && p[5 * 8 + col] == 0 && p[6 * 8 + col] == 0 && p[7 * 8 + col] == 0) {
          t = dctSqrt2 * dataIn[i2 + 0] + 8192 >> 14;
          p[0 * 8 + col] = t;
          p[1 * 8 + col] = t;
          p[2 * 8 + col] = t;
          p[3 * 8 + col] = t;
          p[4 * 8 + col] = t;
          p[5 * 8 + col] = t;
          p[6 * 8 + col] = t;
          p[7 * 8 + col] = t;
          continue;
        }
        v0 = dctSqrt2 * p[0 * 8 + col] + 2048 >> 12;
        v1 = dctSqrt2 * p[4 * 8 + col] + 2048 >> 12;
        v2 = p[2 * 8 + col];
        v3 = p[6 * 8 + col];
        v4 = dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048 >> 12;
        v7 = dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048 >> 12;
        v5 = p[3 * 8 + col];
        v6 = p[5 * 8 + col];
        t = v0 - v1 + 1 >> 1;
        v0 = v0 + v1 + 1 >> 1;
        v1 = t;
        t = v2 * dctSin6 + v3 * dctCos6 + 2048 >> 12;
        v2 = v2 * dctCos6 - v3 * dctSin6 + 2048 >> 12;
        v3 = t;
        t = v4 - v6 + 1 >> 1;
        v4 = v4 + v6 + 1 >> 1;
        v6 = t;
        t = v7 + v5 + 1 >> 1;
        v5 = v7 - v5 + 1 >> 1;
        v7 = t;
        t = v0 - v3 + 1 >> 1;
        v0 = v0 + v3 + 1 >> 1;
        v3 = t;
        t = v1 - v2 + 1 >> 1;
        v1 = v1 + v2 + 1 >> 1;
        v2 = t;
        t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
        v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
        v7 = t;
        t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
        v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
        v6 = t;
        p[0 * 8 + col] = v0 + v7;
        p[7 * 8 + col] = v0 - v7;
        p[1 * 8 + col] = v1 + v6;
        p[6 * 8 + col] = v1 - v6;
        p[2 * 8 + col] = v2 + v5;
        p[5 * 8 + col] = v2 - v5;
        p[3 * 8 + col] = v3 + v4;
        p[4 * 8 + col] = v3 - v4;
      }
      for (i2 = 0; i2 < 64; ++i2) {
        var sample2 = 128 + (p[i2] + 8 >> 4);
        dataOut[i2] = sample2 < 0 ? 0 : sample2 > 255 ? 255 : sample2;
      }
    }
    __name(quantizeAndInverse, "quantizeAndInverse");
    requestMemoryAllocation(samplesPerLine * blocksPerColumn * 8);
    var i, j;
    for (var blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
      var scanLine = blockRow << 3;
      for (i = 0; i < 8; i++)
        lines.push(new Uint8Array(samplesPerLine));
      for (var blockCol = 0; blockCol < blocksPerLine; blockCol++) {
        quantizeAndInverse(component.blocks[blockRow][blockCol], r, R);
        var offset = 0, sample = blockCol << 3;
        for (j = 0; j < 8; j++) {
          var line = lines[scanLine + j];
          for (i = 0; i < 8; i++)
            line[sample + i] = r[offset++];
        }
      }
    }
    return lines;
  }
  __name(buildComponentData, "buildComponentData");
  function clampTo8bit(a) {
    return a < 0 ? 0 : a > 255 ? 255 : a;
  }
  __name(clampTo8bit, "clampTo8bit");
  constructor.prototype = {
    load: /* @__PURE__ */ __name(function load(path) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", path, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = function() {
        var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
        this.parse(data);
        if (this.onload)
          this.onload();
      }.bind(this);
      xhr.send(null);
    }, "load"),
    parse: /* @__PURE__ */ __name(function parse2(data) {
      var maxResolutionInPixels = this.opts.maxResolutionInMP * 1e3 * 1e3;
      var offset = 0, length = data.length;
      function readUint16() {
        var value = data[offset] << 8 | data[offset + 1];
        offset += 2;
        return value;
      }
      __name(readUint16, "readUint16");
      function readDataBlock() {
        var length2 = readUint16();
        var array = data.subarray(offset, offset + length2 - 2);
        offset += array.length;
        return array;
      }
      __name(readDataBlock, "readDataBlock");
      function prepareComponents(frame2) {
        var maxH2 = 1, maxV2 = 1;
        var component2, componentId2;
        for (componentId2 in frame2.components) {
          if (frame2.components.hasOwnProperty(componentId2)) {
            component2 = frame2.components[componentId2];
            if (maxH2 < component2.h)
              maxH2 = component2.h;
            if (maxV2 < component2.v)
              maxV2 = component2.v;
          }
        }
        var mcusPerLine = Math.ceil(frame2.samplesPerLine / 8 / maxH2);
        var mcusPerColumn = Math.ceil(frame2.scanLines / 8 / maxV2);
        for (componentId2 in frame2.components) {
          if (frame2.components.hasOwnProperty(componentId2)) {
            component2 = frame2.components[componentId2];
            var blocksPerLine = Math.ceil(Math.ceil(frame2.samplesPerLine / 8) * component2.h / maxH2);
            var blocksPerColumn = Math.ceil(Math.ceil(frame2.scanLines / 8) * component2.v / maxV2);
            var blocksPerLineForMcu = mcusPerLine * component2.h;
            var blocksPerColumnForMcu = mcusPerColumn * component2.v;
            var blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;
            var blocks = [];
            requestMemoryAllocation(blocksToAllocate * 256);
            for (var i2 = 0; i2 < blocksPerColumnForMcu; i2++) {
              var row = [];
              for (var j2 = 0; j2 < blocksPerLineForMcu; j2++)
                row.push(new Int32Array(64));
              blocks.push(row);
            }
            component2.blocksPerLine = blocksPerLine;
            component2.blocksPerColumn = blocksPerColumn;
            component2.blocks = blocks;
          }
        }
        frame2.maxH = maxH2;
        frame2.maxV = maxV2;
        frame2.mcusPerLine = mcusPerLine;
        frame2.mcusPerColumn = mcusPerColumn;
      }
      __name(prepareComponents, "prepareComponents");
      var jfif = null;
      var adobe = null;
      var pixels = null;
      var frame, resetInterval;
      var quantizationTables = [], frames = [];
      var huffmanTablesAC = [], huffmanTablesDC = [];
      var fileMarker = readUint16();
      var malformedDataOffset = -1;
      this.comments = [];
      if (fileMarker != 65496) {
        throw new Error("SOI not found");
      }
      fileMarker = readUint16();
      while (fileMarker != 65497) {
        var i, j, l;
        switch (fileMarker) {
          case 65280:
            break;
          case 65504:
          case 65505:
          case 65506:
          case 65507:
          case 65508:
          case 65509:
          case 65510:
          case 65511:
          case 65512:
          case 65513:
          case 65514:
          case 65515:
          case 65516:
          case 65517:
          case 65518:
          case 65519:
          case 65534:
            var appData = readDataBlock();
            if (fileMarker === 65534) {
              var comment = String.fromCharCode.apply(null, appData);
              this.comments.push(comment);
            }
            if (fileMarker === 65504) {
              if (appData[0] === 74 && appData[1] === 70 && appData[2] === 73 && appData[3] === 70 && appData[4] === 0) {
                jfif = {
                  version: { major: appData[5], minor: appData[6] },
                  densityUnits: appData[7],
                  xDensity: appData[8] << 8 | appData[9],
                  yDensity: appData[10] << 8 | appData[11],
                  thumbWidth: appData[12],
                  thumbHeight: appData[13],
                  thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
                };
              }
            }
            if (fileMarker === 65505) {
              if (appData[0] === 69 && appData[1] === 120 && appData[2] === 105 && appData[3] === 102 && appData[4] === 0) {
                this.exifBuffer = appData.subarray(5, appData.length);
              }
            }
            if (fileMarker === 65518) {
              if (appData[0] === 65 && appData[1] === 100 && appData[2] === 111 && appData[3] === 98 && appData[4] === 101 && appData[5] === 0) {
                adobe = {
                  version: appData[6],
                  flags0: appData[7] << 8 | appData[8],
                  flags1: appData[9] << 8 | appData[10],
                  transformCode: appData[11]
                };
              }
            }
            break;
          case 65499:
            var quantizationTablesLength = readUint16();
            var quantizationTablesEnd = quantizationTablesLength + offset - 2;
            while (offset < quantizationTablesEnd) {
              var quantizationTableSpec = data[offset++];
              requestMemoryAllocation(64 * 4);
              var tableData = new Int32Array(64);
              if (quantizationTableSpec >> 4 === 0) {
                for (j = 0; j < 64; j++) {
                  var z = dctZigZag[j];
                  tableData[z] = data[offset++];
                }
              } else if (quantizationTableSpec >> 4 === 1) {
                for (j = 0; j < 64; j++) {
                  var z = dctZigZag[j];
                  tableData[z] = readUint16();
                }
              } else
                throw new Error("DQT: invalid table spec");
              quantizationTables[quantizationTableSpec & 15] = tableData;
            }
            break;
          case 65472:
          case 65473:
          case 65474:
            readUint16();
            frame = {};
            frame.extended = fileMarker === 65473;
            frame.progressive = fileMarker === 65474;
            frame.precision = data[offset++];
            frame.scanLines = readUint16();
            frame.samplesPerLine = readUint16();
            frame.components = {};
            frame.componentsOrder = [];
            var pixelsInFrame = frame.scanLines * frame.samplesPerLine;
            if (pixelsInFrame > maxResolutionInPixels) {
              var exceededAmount = Math.ceil((pixelsInFrame - maxResolutionInPixels) / 1e6);
              throw new Error(`maxResolutionInMP limit exceeded by ${exceededAmount}MP`);
            }
            var componentsCount = data[offset++], componentId;
            var maxH = 0, maxV = 0;
            for (i = 0; i < componentsCount; i++) {
              componentId = data[offset];
              var h = data[offset + 1] >> 4;
              var v = data[offset + 1] & 15;
              var qId = data[offset + 2];
              if (h <= 0 || v <= 0) {
                throw new Error("Invalid sampling factor, expected values above 0");
              }
              frame.componentsOrder.push(componentId);
              frame.components[componentId] = {
                h,
                v,
                quantizationIdx: qId
              };
              offset += 3;
            }
            prepareComponents(frame);
            frames.push(frame);
            break;
          case 65476:
            var huffmanLength = readUint16();
            for (i = 2; i < huffmanLength; ) {
              var huffmanTableSpec = data[offset++];
              var codeLengths = new Uint8Array(16);
              var codeLengthSum = 0;
              for (j = 0; j < 16; j++, offset++) {
                codeLengthSum += codeLengths[j] = data[offset];
              }
              requestMemoryAllocation(16 + codeLengthSum);
              var huffmanValues = new Uint8Array(codeLengthSum);
              for (j = 0; j < codeLengthSum; j++, offset++)
                huffmanValues[j] = data[offset];
              i += 17 + codeLengthSum;
              (huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] = buildHuffmanTable(codeLengths, huffmanValues);
            }
            break;
          case 65501:
            readUint16();
            resetInterval = readUint16();
            break;
          case 65500:
            readUint16();
            readUint16();
            break;
          case 65498:
            var scanLength = readUint16();
            var selectorsCount = data[offset++];
            var components = [], component;
            for (i = 0; i < selectorsCount; i++) {
              component = frame.components[data[offset++]];
              var tableSpec = data[offset++];
              component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
              component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
              components.push(component);
            }
            var spectralStart = data[offset++];
            var spectralEnd = data[offset++];
            var successiveApproximation = data[offset++];
            var processed = decodeScan(
              data,
              offset,
              frame,
              components,
              resetInterval,
              spectralStart,
              spectralEnd,
              successiveApproximation >> 4,
              successiveApproximation & 15,
              this.opts
            );
            offset += processed;
            break;
          case 65535:
            if (data[offset] !== 255) {
              offset--;
            }
            break;
          default:
            if (data[offset - 3] == 255 && data[offset - 2] >= 192 && data[offset - 2] <= 254) {
              offset -= 3;
              break;
            } else if (fileMarker === 224 || fileMarker == 225) {
              if (malformedDataOffset !== -1) {
                throw new Error(`first unknown JPEG marker at offset ${malformedDataOffset.toString(16)}, second unknown JPEG marker ${fileMarker.toString(16)} at offset ${(offset - 1).toString(16)}`);
              }
              malformedDataOffset = offset - 1;
              const nextOffset = readUint16();
              if (data[offset + nextOffset - 2] === 255) {
                offset += nextOffset - 2;
                break;
              }
            }
            throw new Error("unknown JPEG marker " + fileMarker.toString(16));
        }
        fileMarker = readUint16();
      }
      if (frames.length != 1)
        throw new Error("only single frame JPEGs supported");
      for (var i = 0; i < frames.length; i++) {
        var cp = frames[i].components;
        for (var j in cp) {
          cp[j].quantizationTable = quantizationTables[cp[j].quantizationIdx];
          delete cp[j].quantizationIdx;
        }
      }
      this.width = frame.samplesPerLine;
      this.height = frame.scanLines;
      this.jfif = jfif;
      this.adobe = adobe;
      this.components = [];
      for (var i = 0; i < frame.componentsOrder.length; i++) {
        var component = frame.components[frame.componentsOrder[i]];
        this.components.push({
          lines: buildComponentData(frame, component),
          scaleX: component.h / frame.maxH,
          scaleY: component.v / frame.maxV
        });
      }
    }, "parse"),
    getData: /* @__PURE__ */ __name(function getData(width, height) {
      var scaleX = this.width / width, scaleY = this.height / height;
      var component1, component2, component3, component4;
      var component1Line, component2Line, component3Line, component4Line;
      var x, y;
      var offset = 0;
      var Y, Cb, Cr, K, C, M, Ye, R, G, B;
      var colorTransform;
      var dataLength = width * height * this.components.length;
      requestMemoryAllocation(dataLength);
      var data = new Uint8Array(dataLength);
      switch (this.components.length) {
        case 1:
          component1 = this.components[0];
          for (y = 0; y < height; y++) {
            component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
            for (x = 0; x < width; x++) {
              Y = component1Line[0 | x * component1.scaleX * scaleX];
              data[offset++] = Y;
            }
          }
          break;
        case 2:
          component1 = this.components[0];
          component2 = this.components[1];
          for (y = 0; y < height; y++) {
            component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
            component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
            for (x = 0; x < width; x++) {
              Y = component1Line[0 | x * component1.scaleX * scaleX];
              data[offset++] = Y;
              Y = component2Line[0 | x * component2.scaleX * scaleX];
              data[offset++] = Y;
            }
          }
          break;
        case 3:
          colorTransform = true;
          if (this.adobe && this.adobe.transformCode)
            colorTransform = true;
          else if (typeof this.opts.colorTransform !== "undefined")
            colorTransform = !!this.opts.colorTransform;
          component1 = this.components[0];
          component2 = this.components[1];
          component3 = this.components[2];
          for (y = 0; y < height; y++) {
            component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
            component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
            component3Line = component3.lines[0 | y * component3.scaleY * scaleY];
            for (x = 0; x < width; x++) {
              if (!colorTransform) {
                R = component1Line[0 | x * component1.scaleX * scaleX];
                G = component2Line[0 | x * component2.scaleX * scaleX];
                B = component3Line[0 | x * component3.scaleX * scaleX];
              } else {
                Y = component1Line[0 | x * component1.scaleX * scaleX];
                Cb = component2Line[0 | x * component2.scaleX * scaleX];
                Cr = component3Line[0 | x * component3.scaleX * scaleX];
                R = clampTo8bit(Y + 1.402 * (Cr - 128));
                G = clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                B = clampTo8bit(Y + 1.772 * (Cb - 128));
              }
              data[offset++] = R;
              data[offset++] = G;
              data[offset++] = B;
            }
          }
          break;
        case 4:
          if (!this.adobe)
            throw new Error("Unsupported color mode (4 components)");
          colorTransform = false;
          if (this.adobe && this.adobe.transformCode)
            colorTransform = true;
          else if (typeof this.opts.colorTransform !== "undefined")
            colorTransform = !!this.opts.colorTransform;
          component1 = this.components[0];
          component2 = this.components[1];
          component3 = this.components[2];
          component4 = this.components[3];
          for (y = 0; y < height; y++) {
            component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
            component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
            component3Line = component3.lines[0 | y * component3.scaleY * scaleY];
            component4Line = component4.lines[0 | y * component4.scaleY * scaleY];
            for (x = 0; x < width; x++) {
              if (!colorTransform) {
                C = component1Line[0 | x * component1.scaleX * scaleX];
                M = component2Line[0 | x * component2.scaleX * scaleX];
                Ye = component3Line[0 | x * component3.scaleX * scaleX];
                K = component4Line[0 | x * component4.scaleX * scaleX];
              } else {
                Y = component1Line[0 | x * component1.scaleX * scaleX];
                Cb = component2Line[0 | x * component2.scaleX * scaleX];
                Cr = component3Line[0 | x * component3.scaleX * scaleX];
                K = component4Line[0 | x * component4.scaleX * scaleX];
                C = 255 - clampTo8bit(Y + 1.402 * (Cr - 128));
                M = 255 - clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                Ye = 255 - clampTo8bit(Y + 1.772 * (Cb - 128));
              }
              data[offset++] = 255 - C;
              data[offset++] = 255 - M;
              data[offset++] = 255 - Ye;
              data[offset++] = 255 - K;
            }
          }
          break;
        default:
          throw new Error("Unsupported color mode");
      }
      return data;
    }, "getData"),
    copyToImageData: /* @__PURE__ */ __name(function copyToImageData(imageData, formatAsRGBA) {
      var width = imageData.width, height = imageData.height;
      var imageDataArray = imageData.data;
      var data = this.getData(width, height);
      var i = 0, j = 0, x, y;
      var Y, K, C, M, R, G, B;
      switch (this.components.length) {
        case 1:
          for (y = 0; y < height; y++) {
            for (x = 0; x < width; x++) {
              Y = data[i++];
              imageDataArray[j++] = Y;
              imageDataArray[j++] = Y;
              imageDataArray[j++] = Y;
              if (formatAsRGBA) {
                imageDataArray[j++] = 255;
              }
            }
          }
          break;
        case 3:
          for (y = 0; y < height; y++) {
            for (x = 0; x < width; x++) {
              R = data[i++];
              G = data[i++];
              B = data[i++];
              imageDataArray[j++] = R;
              imageDataArray[j++] = G;
              imageDataArray[j++] = B;
              if (formatAsRGBA) {
                imageDataArray[j++] = 255;
              }
            }
          }
          break;
        case 4:
          for (y = 0; y < height; y++) {
            for (x = 0; x < width; x++) {
              C = data[i++];
              M = data[i++];
              Y = data[i++];
              K = data[i++];
              R = 255 - clampTo8bit(C * (1 - K / 255) + K);
              G = 255 - clampTo8bit(M * (1 - K / 255) + K);
              B = 255 - clampTo8bit(Y * (1 - K / 255) + K);
              imageDataArray[j++] = R;
              imageDataArray[j++] = G;
              imageDataArray[j++] = B;
              if (formatAsRGBA) {
                imageDataArray[j++] = 255;
              }
            }
          }
          break;
        default:
          throw new Error("Unsupported color mode");
      }
    }, "copyToImageData")
  };
  var totalBytesAllocated = 0;
  var maxMemoryUsageBytes = 0;
  function requestMemoryAllocation(increaseAmount = 0) {
    var totalMemoryImpactBytes = totalBytesAllocated + increaseAmount;
    if (totalMemoryImpactBytes > maxMemoryUsageBytes) {
      var exceededAmount = Math.ceil((totalMemoryImpactBytes - maxMemoryUsageBytes) / 1024 / 1024);
      throw new Error(`maxMemoryUsageInMB limit exceeded by at least ${exceededAmount}MB`);
    }
    totalBytesAllocated = totalMemoryImpactBytes;
  }
  __name(requestMemoryAllocation, "requestMemoryAllocation");
  constructor.resetMaxMemoryUsage = function(maxMemoryUsageBytes_) {
    totalBytesAllocated = 0;
    maxMemoryUsageBytes = maxMemoryUsageBytes_;
  };
  constructor.getBytesAllocated = function() {
    return totalBytesAllocated;
  };
  constructor.requestMemoryAllocation = requestMemoryAllocation;
  return constructor;
}, "jpegImage"))();
function decode(jpegData, userOpts = {}) {
  var defaultOpts = {
    // "undefined" means "Choose whether to transform colors based on the image’s color model."
    colorTransform: void 0,
    useTArray: false,
    formatAsRGBA: true,
    tolerantDecoding: true,
    maxResolutionInMP: 100,
    // Don't decode more than 100 megapixels
    maxMemoryUsageInMB: 512
    // Don't decode if memory footprint is more than 512MB
  };
  var opts = { ...defaultOpts, ...userOpts };
  var arr = new Uint8Array(jpegData);
  var decoder = new JpegImage();
  decoder.opts = opts;
  JpegImage.resetMaxMemoryUsage(opts.maxMemoryUsageInMB * 1024 * 1024);
  decoder.parse(arr);
  var channels = opts.formatAsRGBA ? 4 : 3;
  var bytesNeeded = decoder.width * decoder.height * channels;
  try {
    JpegImage.requestMemoryAllocation(bytesNeeded);
    var image = {
      width: decoder.width,
      height: decoder.height,
      exifBuffer: decoder.exifBuffer,
      data: opts.useTArray ? new Uint8Array(bytesNeeded) : Buffer.alloc(bytesNeeded)
    };
    if (decoder.comments.length > 0) {
      image["comments"] = decoder.comments;
    }
  } catch (err) {
    if (err instanceof RangeError) {
      throw new Error("Could not allocate enough memory for the image. Required: " + bytesNeeded);
    }
    if (err instanceof ReferenceError) {
      if (err.message === "Buffer is not defined") {
        throw new Error("Buffer is not globally defined in this environment. Consider setting useTArray to true");
      }
    }
    throw err;
  }
  decoder.copyToImageData(image, opts.formatAsRGBA);
  return image;
}
__name(decode, "decode");
var jpeg_decoder_default = decode;

// palette.ts
var MAX_DIMENSION = 96;
var TARGET_SAMPLE_COUNT = 2400;
var UnsupportedImageFormatError = class extends Error {
  constructor(format) {
    super(`Unsupported image format: ${format}`);
    this.name = "UnsupportedImageFormatError";
  }
};
__name(UnsupportedImageFormatError, "UnsupportedImageFormatError");
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
__name(clamp, "clamp");
function componentToHex(value) {
  const clamped = clamp(Math.round(value), 0, 255);
  return clamped.toString(16).padStart(2, "0");
}
__name(componentToHex, "componentToHex");
function rgbToHex({ r, g, b }) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}
__name(rgbToHex, "rgbToHex");
function rgbToHsl(r, g, b) {
  const rNorm = clamp(r / 255, 0, 1);
  const gNorm = clamp(g / 255, 0, 1);
  const bNorm = clamp(b / 255, 0, 1);
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      h = (gNorm - bNorm) / delta % 6;
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2;
    } else {
      h = (rNorm - gNorm) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}
__name(rgbToHsl, "rgbToHsl");
function hueToRgb(p, q, t) {
  if (t < 0)
    t += 1;
  if (t > 1)
    t -= 1;
  if (t < 1 / 6)
    return p + (q - p) * 6 * t;
  if (t < 1 / 2)
    return q;
  if (t < 2 / 3)
    return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
__name(hueToRgb, "hueToRgb");
function hslToRgb(h, s, l) {
  const saturation = clamp(s, 0, 1);
  const lightness = clamp(l, 0, 1);
  const normalizedHue = (h % 360 + 360) % 360 / 360;
  if (saturation === 0) {
    const value = lightness * 255;
    return { r: value, g: value, b: value };
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const r = hueToRgb(p, q, normalizedHue + 1 / 3) * 255;
  const g = hueToRgb(p, q, normalizedHue) * 255;
  const b = hueToRgb(p, q, normalizedHue - 1 / 3) * 255;
  return { r, g, b };
}
__name(hslToRgb, "hslToRgb");
function hslToHex(color) {
  const rgb = hslToRgb(color.h, color.s, color.l);
  return rgbToHex(rgb);
}
__name(hslToHex, "hslToHex");
function relativeLuminance(r, g, b) {
  const normalize = /* @__PURE__ */ __name((value) => {
    const channel = clamp(value / 255, 0, 1);
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }, "normalize");
  const rLin = normalize(r);
  const gLin = normalize(g);
  const bLin = normalize(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}
__name(relativeLuminance, "relativeLuminance");
function pickContrastColor(color) {
  const luminance = relativeLuminance(color.r, color.g, color.b);
  return luminance > 0.45 ? "#1f2937" : "#f8fafc";
}
__name(pickContrastColor, "pickContrastColor");
function adjustSaturation(base, factor, offset = 0) {
  return clamp(base * factor + offset, 0, 1);
}
__name(adjustSaturation, "adjustSaturation");
function adjustLightness(base, offset, factor = 1) {
  return clamp(base * factor + offset, 0, 1);
}
__name(adjustLightness, "adjustLightness");
function analyzeImageColors(image) {
  const { data } = image;
  const totalPixels = data.length / 4;
  const step = Math.max(1, Math.floor(totalPixels / TARGET_SAMPLE_COUNT));
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;
  let accent = null;
  for (let index = 0; index < data.length; index += step * 4) {
    const alpha = data[index + 3];
    if (alpha < 48) {
      continue;
    }
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    totalR += r;
    totalG += g;
    totalB += b;
    count++;
    const hsl = rgbToHsl(r, g, b);
    const vibrance = hsl.s;
    const balance = 1 - Math.abs(hsl.l - 0.5);
    const score = vibrance * 0.65 + balance * 0.35;
    if (!accent || score > accent.score) {
      accent = { color: hsl, score };
    }
  }
  if (count === 0) {
    throw new Error("No opaque pixels available for analysis");
  }
  const averageR = totalR / count;
  const averageG = totalG / count;
  const averageB = totalB / count;
  const average = rgbToHsl(averageR, averageG, averageB);
  const accentColor = accent ? accent.color : average;
  return {
    average,
    accent: accentColor
  };
}
__name(analyzeImageColors, "analyzeImageColors");
function buildGradientStops(accent) {
  const lightColors = [
    hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.4, 0.08), l: adjustLightness(accent.l, 0.42, 0.52) }),
    hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.52, 0.05), l: adjustLightness(accent.l, 0.26, 0.62) }),
    hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.65), l: adjustLightness(accent.l, 0.12, 0.72) })
  ];
  const darkColors = [
    hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.55, 0.04), l: adjustLightness(accent.l, 0.14, 0.38) }),
    hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.62, 0.02), l: adjustLightness(accent.l, 0.04, 0.3) }),
    hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.72), l: adjustLightness(accent.l, -0.04, 0.22) })
  ];
  return {
    light: {
      colors: lightColors,
      gradient: `linear-gradient(140deg, ${lightColors[0]} 0%, ${lightColors[1]} 45%, ${lightColors[2]} 100%)`
    },
    dark: {
      colors: darkColors,
      gradient: `linear-gradient(135deg, ${darkColors[0]} 0%, ${darkColors[1]} 55%, ${darkColors[2]} 100%)`
    }
  };
}
__name(buildGradientStops, "buildGradientStops");
function buildThemeTokens(accent) {
  return {
    light: {
      primaryColor: hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.6, 0.06), l: adjustLightness(accent.l, 0.22, 0.6) }),
      primaryColorDark: hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.72, 0.02), l: adjustLightness(accent.l, 0.06, 0.52) })
    },
    dark: {
      primaryColor: hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.58, 0.04), l: adjustLightness(accent.l, 0.16, 0.42) }),
      primaryColorDark: hslToHex({ h: accent.h, s: adjustSaturation(accent.s, 0.68), l: adjustLightness(accent.l, 0.02, 0.32) })
    }
  };
}
__name(buildThemeTokens, "buildThemeTokens");
function resizeImage(image) {
  const maxSide = Math.max(image.width, image.height);
  if (maxSide <= MAX_DIMENSION) {
    return image;
  }
  const scale = MAX_DIMENSION / maxSide;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const resized = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(image.width - 1, Math.floor(x / scale));
      const srcIndex = (srcY * image.width + srcX) * 4;
      const destIndex = (y * width + x) * 4;
      resized[destIndex] = image.data[srcIndex];
      resized[destIndex + 1] = image.data[srcIndex + 1];
      resized[destIndex + 2] = image.data[srcIndex + 2];
      resized[destIndex + 3] = image.data[srcIndex + 3];
    }
  }
  return {
    width,
    height,
    data: resized
  };
}
__name(resizeImage, "resizeImage");
function decodeImage(arrayBuffer, contentType) {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "";
  const supported = ["jpeg", "jpg", "pjpeg"];
  if (!supported.includes(subtype)) {
    throw new UnsupportedImageFormatError(subtype);
  }
  const bytes = new Uint8Array(arrayBuffer);
  const decoded = jpeg_decoder_default(bytes, {
    useTArray: true,
    formatAsRGBA: true
  });
  const image = {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data)
  };
  return resizeImage(image);
}
__name(decodeImage, "decodeImage");
async function buildPalette(arrayBuffer, contentType) {
  const imageData = decodeImage(arrayBuffer, contentType);
  const analyzed = analyzeImageColors(imageData);
  const gradientStops = buildGradientStops(analyzed.accent);
  const tokens = buildThemeTokens(analyzed.accent);
  const accentRgb = hslToRgb(analyzed.accent.h, analyzed.accent.s, analyzed.accent.l);
  return {
    source: "",
    baseColor: hslToHex(analyzed.accent),
    averageColor: hslToHex(analyzed.average),
    accentColor: hslToHex(analyzed.accent),
    contrastColor: pickContrastColor(accentRgb),
    gradients: {
      light: gradientStops.light,
      dark: gradientStops.dark
    },
    tokens
  };
}
__name(buildPalette, "buildPalette");
function createCorsHeaders(init) {
  const headers = new Headers(init);
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}
__name(createCorsHeaders, "createCorsHeaders");
function createJsonHeaders(status) {
  const headers = createCorsHeaders({
    "Content-Type": "application/json; charset=utf-8"
  });
  headers.set("Cache-Control", status === 200 ? "public, max-age=3600" : "no-store");
  return headers;
}
__name(createJsonHeaders, "createJsonHeaders");
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400"
    }
  });
}
__name(handleOptions, "handleOptions");
async function onRequest2({ request }) {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: createJsonHeaders(405)
    });
  }
  const url = new URL(request.url);
  const imageParam = url.searchParams.get("image") ?? url.searchParams.get("url");
  if (!imageParam) {
    return new Response(JSON.stringify({ error: "Missing image parameter" }), {
      status: 400,
      headers: createJsonHeaders(400)
    });
  }
  let target;
  try {
    target = new URL(imageParam);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid image URL" }), {
      status: 400,
      headers: createJsonHeaders(400)
    });
  }
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }
  let finalImageUrl = target.toString();
  if (target.pathname.includes("/proxy") && target.searchParams.get("type") === "pic") {
    try {
      const redirectResponse = await fetch(target.toString(), {
        redirect: "manual"
      });
      const location = redirectResponse.headers.get("Location");
      if (location) {
        finalImageUrl = location;
      }
    } catch (error) {
      console.warn("Failed to resolve proxy redirect, using original URL", error);
    }
  }
  let upstream;
  try {
    upstream = await fetch(finalImageUrl, {
      cf: {
        cacheTtl: 3600,
        cacheEverything: true,
        image: {
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: "scale-down",
          quality: 85,
          format: "jpeg"
        }
      }
    });
  } catch (error) {
    console.warn("Image resizing fetch failed, falling back to original", error);
    upstream = await fetch(finalImageUrl, {
      cf: {
        cacheTtl: 3600,
        cacheEverything: true
      }
    });
  }
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: `Upstream request failed with status ${upstream.status}` }), {
      status: upstream.status,
      headers: createJsonHeaders(upstream.status)
    });
  }
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return new Response(JSON.stringify({ error: "Unsupported content type" }), {
      status: 415,
      headers: createJsonHeaders(415)
    });
  }
  const buffer = await upstream.arrayBuffer();
  try {
    const palette = await buildPalette(buffer, contentType);
    palette.source = target.toString();
    const response = new Response(JSON.stringify(palette), {
      status: 200,
      headers: createJsonHeaders(200)
    });
    try {
      await cache.put(cacheKey, response.clone());
    } catch (cacheError) {
      console.warn("Failed to cache palette response", cacheError);
    }
    return response;
  } catch (error) {
    if (error instanceof UnsupportedImageFormatError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 415,
        headers: createJsonHeaders(415)
      });
    }
    console.error("Palette generation failed", error);
    return new Response(JSON.stringify({ error: "Failed to analyze image" }), {
      status: 500,
      headers: createJsonHeaders(500)
    });
  }
}
__name(onRequest2, "onRequest");

// proxy.ts
var API_BASE_URL = "https://music-dl.sayqz.com/api/";
var KUWO_HOST_PATTERN = /(^|\\.)kuwo\\.cn$/i;
var SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];
function createCorsHeaders2(init) {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}
__name(createCorsHeaders2, "createCorsHeaders");
function handleOptions2() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400"
    }
  });
}
__name(handleOptions2, "handleOptions");
function isAllowedKuwoHost(hostname) {
  if (!hostname)
    return false;
  return KUWO_HOST_PATTERN.test(hostname);
}
__name(isAllowedKuwoHost, "isAllowedKuwoHost");
function normalizeKuwoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.protocol = "http:";
    return parsed;
  } catch {
    return null;
  }
}
__name(normalizeKuwoUrl, "normalizeKuwoUrl");
async function proxyKuwoAudio(targetUrl, request) {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    return new Response("Invalid target", { status: 400 });
  }
  const init = {
    method: request.method,
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Referer": "https://www.kuwo.cn/"
    }
  };
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    init.headers["Range"] = rangeHeader;
  }
  const upstream = await fetch(normalized.toString(), init);
  const headers = createCorsHeaders2(upstream.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}
__name(proxyKuwoAudio, "proxyKuwoAudio");
async function proxyApiRequest(url, request) {
  const apiUrl = new URL(API_BASE_URL);
  const paramMapping = {
    "types": "type",
    "name": "keyword",
    "count": "limit",
    "pages": "page"
  };
  url.searchParams.forEach((value, key) => {
    if (key === "target" || key === "callback" || key === "s") {
      return;
    }
    const mappedKey = paramMapping[key] || key;
    apiUrl.searchParams.set(mappedKey, value);
  });
  if (!apiUrl.searchParams.has("type")) {
    return new Response("Missing type parameter", { status: 400 });
  }
  const requestType = apiUrl.searchParams.get("type");
  if (requestType === "realurl") {
    apiUrl.searchParams.set("type", "url");
    try {
      const upstream2 = await fetch(apiUrl.toString(), {
        headers: {
          "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0"
        },
        redirect: "manual"
      });
      const realUrl = upstream2.headers.get("Location");
      if (!realUrl) {
        return new Response(JSON.stringify({
          code: 500,
          message: "Failed to get real audio URL",
          data: null
        }), {
          status: 500,
          headers: createCorsHeaders2(new Headers({
            "Content-Type": "application/json; charset=utf-8"
          }))
        });
      }
      const headers2 = createCorsHeaders2(new Headers());
      headers2.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({
        code: 200,
        message: "success",
        data: {
          url: realUrl
        }
      }), {
        status: 200,
        headers: headers2
      });
    } catch (error) {
      return new Response(JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
        data: null
      }), {
        status: 500,
        headers: createCorsHeaders2(new Headers({
          "Content-Type": "application/json; charset=utf-8"
        }))
      });
    }
  }
  const upstream = await fetch(apiUrl.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Accept": "application/json"
    }
  });
  const headers = createCorsHeaders2(upstream.headers);
  const proxyRequestType = apiUrl.searchParams.get("type");
  const isMediaType = proxyRequestType === "pic" || proxyRequestType === "lrc" || proxyRequestType === "url";
  if (!isMediaType && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}
__name(proxyApiRequest, "proxyApiRequest");
async function onRequest3({ request }) {
  if (request.method === "OPTIONS") {
    return handleOptions2();
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const target = url.searchParams.get("target");
  if (target) {
    return proxyKuwoAudio(target, request);
  }
  return proxyApiRequest(url, request);
}
__name(onRequest3, "onRequest");

// _middleware.ts
var PUBLIC_PATH_PATTERNS = [/^\/login(?:\/|$)/, /^\/api\/login(?:\/|$)/];
var PUBLIC_FILE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".css",
  ".js",
  ".png",
  ".svg",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".txt",
  ".map",
  ".json",
  ".woff",
  ".woff2"
]);
function hasPublicExtension(pathname) {
  const lastDotIndex = pathname.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return false;
  }
  const extension = pathname.slice(lastDotIndex).toLowerCase();
  return PUBLIC_FILE_EXTENSIONS.has(extension);
}
__name(hasPublicExtension, "hasPublicExtension");
function isPublicPath(pathname) {
  return PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) || hasPublicExtension(pathname);
}
__name(isPublicPath, "isPublicPath");
async function onRequest4(context) {
  const { request, env } = context;
  const password = env.PASSWORD;
  if (typeof password !== "string") {
    return context.next();
  }
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (isPublicPath(pathname)) {
    return context.next();
  }
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = {};
  cookieHeader.split(";").forEach((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  });
  if (cookies.auth && cookies.auth === btoa(password)) {
    return context.next();
  }
  const loginUrl = new URL("/login", url);
  return Response.redirect(loginUrl.toString(), 302);
}
__name(onRequest4, "onRequest");

// ../.wrangler/tmp/pages-EV4ZFV/functionsRoutes-0.24646445805498807.mjs
var routes = [
  {
    routePath: "/api/login",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/storage",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/palette",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/proxy",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [onRequest4],
    modules: []
  }
];

// ../node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode2 = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode2(value, key);
        });
      } else {
        params[key.name] = decode2(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: () => {
            isFailOpen = true;
          }
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-ff7aL2/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-ff7aL2/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.6621365468588767.mjs.map
