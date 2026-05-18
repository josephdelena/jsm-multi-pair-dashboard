// /api/cron-analyze.js — Hourly Vercel Cron Job
// Loops 4 pairs, analyzes each, sends summary to Telegram

const { PAIR_CONFIG, analyzePair } = require('./_shared');

// Format per-pair Telegram message (style matches Terminal 1)
function formatPairMessage(r) {
  const cfg = PAIR_CONFIG[r.pair];
  const tier = r.score >= 80
    ? 'DEPLOY HIGH (60%)'
    : r.score >= 75
      ? 'DEPLOY HIGH (60%)'
      : r.score >= 70
        ? 'DEPLOY MODERATE (40%)'
        : 'STANDBY (20%)';
  const emoji = r.score >= 75 ? '🚀' : r.score >= 70 ? '✅' : '🟡';
  const price = r.indicators.price.toFixed(r.indicators.price < 10 ? 4 : 2);

  return [
    `${emoji} *JSM Multi-Pair — ${cfg.name}*`,
    `_${tier}_`,
    '',
    `Score: *${r.score}*`,
    `Price: \`$${price}\``,
    `Verdict: \`${r.verdict}\``,
    `Trend: \`${r.indicators.trend}\` • RSI: \`${r.indicators.rsi.toFixed(0)}\``,
    '',
    `_${r.analisa.slice(0, 200)}_`,
    '',
    `🔗 [Open Dashboard](https://multi-pair-dashboard.vercel.app)`
  ].join('\n');
}

async function sendTelegram(token, chatId, message) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Telegram error ${r.status}: ${err.slice(0, 200)}`);
  }
  return await r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Verify cron auth (Vercel sends Authorization: Bearer ${CRON_SECRET})
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY env var not set' });
  if (!telegramToken || !telegramChatId) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars not set' });
  }

  const results = [];
  const errors = [];

  // Analyze all 4 pairs in parallel
  const pairs = Object.keys(PAIR_CONFIG);
  const analyses = await Promise.allSettled(
    pairs.map(p => analyzePair(p, apiKey))
  );

  analyses.forEach((result, idx) => {
    const pair = pairs[idx];
    if (result.status === 'fulfilled') {
      const r = result.value;
      results.push({
        pair: r.pair,
        score: r.analysis.score,
        verdict: r.analysis.verdict,
        capital_pct: r.analysis.capital_pct,
        analisa: r.analysis.analisa,
        no_trade_reasons: r.analysis.no_trade_reasons,
        indicators: r.indicators,
        tokens: r.tokens_used
      });
    } else {
      errors.push({ pair, error: result.reason?.message || String(result.reason) });
    }
  });

  // Filter actionable: score >= 70 AND verdict !== NO_TRADE
  const actionable = results.filter(r => r.score >= 70 && r.verdict !== 'NO_TRADE');

  // Send 1 telegram per actionable pair
  const sentMessages = [];
  const sendErrors = [];
  for (const r of actionable) {
    const msg = formatPairMessage(r);
    try {
      await sendTelegram(telegramToken, telegramChatId, msg);
      sentMessages.push(r.pair);
    } catch (e) {
      sendErrors.push({ pair: r.pair, error: e.message });
    }
  }

  const totalTokens = results.reduce((s, r) => s + (r.tokens || 0), 0);
  const cost = (totalTokens / 1_000_000) * 1.5;

  return res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    pairs_analyzed: results.length,
    actionable_pairs: actionable.length,
    sent: sentMessages,
    skipped: results.filter(r => !actionable.includes(r)).map(r => `${r.pair}:${r.verdict}(${r.score})`),
    errors: [...errors, ...sendErrors],
    total_tokens: totalTokens,
    cost_usd: cost.toFixed(4)
  });
};
