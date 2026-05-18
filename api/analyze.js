// /api/analyze.js — Vercel serverless function
// Proxies request to Anthropic Haiku API for per-pair scoring
// User provides their own ANTHROPIC_API_KEY in dashboard settings

const PAIR_CONFIG = {
  SOL:     { name: 'SOL/USDC',     symbol: 'SOLUSDT',     range_up: 1, range_down: 3, trigger: 1.1, threshold_high: 75 },
  ETH:     { name: 'ETH/USDC',     symbol: 'ETHUSDT',     range_up: 1, range_down: 3, trigger: 1.1, threshold_high: 75 },
  VIRTUAL: { name: 'VIRTUAL/USDC', symbol: 'VIRTUALUSDT', range_up: 1, range_down: 5, trigger: 1.1, threshold_high: 75 },
  BTC:     { name: 'USDC/cbBTC',   symbol: 'BTCUSDT',     range_up: 1, range_down: 2, trigger: 0.5, threshold_high: 75 }
};

const MODEL = 'claude-haiku-4-5-20251001';

async function fetchKlines(symbol, interval, limit) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  const raw = await r.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Binance ${symbol} ${interval}: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return raw.map(c => ({
    time: new Date(c[0]).toISOString(),
    open: parseFloat(c[1]), high: parseFloat(c[2]),
    low: parseFloat(c[3]), close: parseFloat(c[4]),
    volume: parseFloat(c[5])
  }));
}

async function fetchTicker(symbol) {
  const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`;
  const r = await fetch(url);
  return await r.json();
}

function computeIndicators(candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const price = closes[closes.length - 1];

  // EMA
  const ema = (period) => {
    const k = 2 / (period + 1);
    let e = closes[0];
    for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
  };
  const ema20 = ema(20);
  const ema50 = ema(50);

  // ATR(14)
  let atrSum = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1] || 0),
      Math.abs(lows[i] - closes[i - 1] || 0)
    );
    atrSum += tr;
  }
  const atr = atrSum / 14;

  // RSI(14)
  let gains = 0, losses = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / (losses || 0.0001);
  const rsi = 100 - 100 / (1 + rs);

  // Pivot
  const last = candles[candles.length - 2];
  const pivot = (last.high + last.low + last.close) / 3;
  const r1 = 2 * pivot - last.low;
  const s1 = 2 * pivot - last.high;

  // Structure
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = candles.length - 10; i < candles.length - 1; i++) {
    if (highs[i + 1] > highs[i]) hh++; else lh++;
    if (lows[i + 1] > lows[i]) hl++; else ll++;
  }

  const isUp = ema20 > ema50 && hh + hl > 10;
  const isDown = ema20 < ema50 && lh + ll > 10;

  // Volume
  const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const lastVol = volumes[volumes.length - 1];
  const volSpike = lastVol > avgVol * 2;

  // Impulse
  const avgRange = candles.slice(-20).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 20;
  const impulse = candles.slice(-3).some(c => Math.abs(c.close - c.open) > avgRange * 2);

  // Last 6 range
  const l6h = Math.max(...highs.slice(-6));
  const l6l = Math.min(...lows.slice(-6));
  const last6RangePct = (l6h - l6l) / price * 100;

  // MA30 (last 30 candles avg, proxy for trend)
  const ma30 = closes.slice(-30).reduce((s, c) => s + c, 0) / 30;
  const ma30Dev = (price - ma30) / ma30 * 100;

  // Cum drop 18 candles
  const last18h = Math.max(...highs.slice(-18));
  const cumDrop18 = (last18h - price) / last18h * 100;

  return {
    price, ema20, ema50, atr, atrPct: atr / price * 100, rsi,
    pivot, r1, s1, isUp, isDown, isSideways: !isUp && !isDown,
    hh, hl, lh, ll, volSpike, impulse, last6RangePct, ma30, ma30Dev, cumDrop18,
    avgVol, lastVol
  };
}

function buildMarketData(pair, c1h, c4h, i1h, ticker) {
  const last20_1h = c1h.slice(-20).map(c =>
    `${new Date(c.time).toISOString().slice(0, 16)} O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${c.volume.toFixed(0)}`
  ).join('\n');

  const last10_4h = c4h.slice(-10).map(c =>
    `${new Date(c.time).toISOString().slice(0, 16)} O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)}`
  ).join('\n');

  return `LIVE MARKET DATA — ${pair.name} (Binance) — ${new Date().toISOString()}

CURRENT: $${i1h.price.toFixed(4)} | 24h: ${parseFloat(ticker.priceChangePercent).toFixed(2)}% | H:${parseFloat(ticker.highPrice).toFixed(4)} L:${parseFloat(ticker.lowPrice).toFixed(4)} Vol:${parseFloat(ticker.volume).toFixed(0)}

1H INDICATORS:
ATR(14): ${i1h.atr.toFixed(4)} (${i1h.atrPct.toFixed(2)}%) | EMA20: ${i1h.ema20.toFixed(4)} | EMA50: ${i1h.ema50.toFixed(4)} | RSI: ${i1h.rsi.toFixed(1)}
Pivot: ${i1h.pivot.toFixed(4)} | R1: ${i1h.r1.toFixed(4)} | S1: ${i1h.s1.toFixed(4)}
Trend: ${i1h.isUp ? 'UP' : i1h.isDown ? 'DOWN' : 'SIDEWAYS'} | HH:${i1h.hh} HL:${i1h.hl} LH:${i1h.lh} LL:${i1h.ll}
VolSpike: ${i1h.volSpike} | Impulse: ${i1h.impulse} | last6Range: ${i1h.last6RangePct.toFixed(2)}%
MA30 dev: ${i1h.ma30Dev.toFixed(2)}% | Cum drop 18 candle: ${i1h.cumDrop18.toFixed(2)}%

1H LAST 20:
${last20_1h}

4H LAST 10:
${last10_4h}`;
}

function buildPrompt(pair) {
  return `You are JSM Multi-Pair LP Analyzer for ${pair.name} di pool concentrated liquidity Base chain (Asym ${pair.range_up}/${pair.range_down} range + dual hedge Hyperliquid).

STRATEGY CONTEXT:
- LP range Asymmetric: +${pair.range_up}% atas / -${pair.range_down}% bawah
- Hedge trigger: -${pair.trigger}% dari entry
- Dual hedge: H1 (sized net=0 di Pa), H2 (cover gap past Pa)
- Drop apapun = $0 locked via dual hedge math
- Worst case: whipsaw H1 = -${pair.trigger * 0.5}% loss

EVALUASI ENTRY untuk ${pair.name}:

STEP 1: HARD BLOCK (NO_TRADE)
1. MA30 deviation > +8% (overbought, drop risk tinggi)
2. Cum drop 18 candle > 3% (recent dump, post-dump zone belum stabil)
3. last6Range > 4% (volatility tinggi, range LP rentan keluar)
4. impulse=true atau volSpike+bearish (momentum kontra)
5. lhCount+llCount ≥6 dalam 10 candle (struktur lemah)
6. RSI <30 atau >75 (extreme)

STEP 2: ENTRY CONFIRMATION (semua harus PASS)
1. Sideways atau micro-bullish (isUp atau isSideways)
2. last6Range stable <2.5%
3. Tidak ada dump/pump ≥2% dalam 6 candle terakhir
4. RSI 40-70 (mid-zone)
5. ATR% reasonable (0.3-1.5%)

SCORING:
- A — Position vs Pivot (0-30): FAVORABLE (dekat pivot ±0.5%), NEUTRAL (±1.5%), UNFAVORABLE (>1.5%)
- B — 4H Structure (0-30): IDEAL (sideways/up steady), OK (mixed), BURUK (downtrend)
- C — 1H Stabilization (0-25): OK (last6 stable, no impulse), LEMAH (mild spike), BURUK (high vol/impulse)
- D — Micro Volatility (0-15): FAVORABLE (ATR <0.8%), NEUTRAL (0.8-1.5%), UNFAVORABLE (>1.5%)

TIER:
- ≥75 = DEPLOY HIGH (60% modal)
- 70-74 = DEPLOY MODERATE (40% modal)
- 55-69 = STANDBY (20% modal)
- <55 atau STEP 1 FAIL = NO_TRADE (0%)

Return JSON only (no markdown, no extra text):
{
  "score": 0-100,
  "verdict": "DEPLOY"|"STANDBY"|"NO_TRADE",
  "capital_pct": 0-60,
  "no_trade_reasons": ["alasan1", "alasan2"],
  "kondisi": {
    "A": {"label": "FAVORABLE/NEUTRAL/UNFAVORABLE", "pts": 0-30},
    "B": {"label": "IDEAL/OK/BURUK", "pts": 0-30},
    "C": {"label": "OK/LEMAH/BURUK", "pts": 0-25},
    "D": {"label": "FAVORABLE/NEUTRAL/UNFAVORABLE", "pts": 0-15}
  },
  "entry_zone": "X.XX - X.XX",
  "analisa": "2-3 kalimat ringkas: kondisi mendukung/memblok specifically"
}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'Missing/invalid X-Api-Key header' });
  }

  const body = req.body || (await new Promise(r => {
    let s = ''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s)); } catch { r({}); } });
  }));

  const pairKey = body.pair;
  const pair = PAIR_CONFIG[pairKey];
  if (!pair) return res.status(400).json({ error: 'Invalid pair' });

  try {
    const [c1h, c4h, ticker] = await Promise.all([
      fetchKlines(pair.symbol, '1h', 60),
      fetchKlines(pair.symbol, '4h', 30),
      fetchTicker(pair.symbol)
    ]);
    const i1h = computeIndicators(c1h);
    const marketData = buildMarketData(pair, c1h, c4h, i1h, ticker);
    const systemPrompt = buildPrompt(pair);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: marketData }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: 'Anthropic API error', detail: err.slice(0, 500) });
    }

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text || '{}';
    let parsed = null;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      return res.status(200).json({ error: 'Parse fail', raw: text.slice(0, 500) });
    }

    return res.status(200).json({
      pair: pairKey,
      timestamp: new Date().toISOString(),
      indicators: {
        price: i1h.price, rsi: i1h.rsi, atr_pct: i1h.atrPct,
        ma30_dev: i1h.ma30Dev, cum_drop_18: i1h.cumDrop18,
        last6_range_pct: i1h.last6RangePct,
        pivot: i1h.pivot, r1: i1h.r1, s1: i1h.s1,
        trend: i1h.isUp ? 'UP' : i1h.isDown ? 'DOWN' : 'SIDEWAYS'
      },
      analysis: parsed,
      tokens_used: data.usage?.input_tokens + data.usage?.output_tokens
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
};
