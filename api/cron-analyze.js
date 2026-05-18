// /api/cron-analyze.js — Hourly Vercel Cron Job
// Loops 4 pairs, analyzes each, sends summary to Telegram

const { PAIR_CONFIG, analyzePair } = require('./_shared');

const VERDICT_EMOJI = {
  DEPLOY: '🟢',
  STANDBY: '🟡',
  NO_TRADE: '🔴'
};

const PAIR_EMOJI = {
  SOL: '◎',
  ETH: 'Ξ',
  VIRTUAL: '◈',
  BTC: '₿'
};

function formatTelegramMessage(results, errors) {
  const now = new Date();
  const wibTime = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(11, 16);

  let msg = `🤖 *JSM Multi-Pair Scan* • ${wibTime} WIB\n\n`;

  // Sort: DEPLOY first, STANDBY, NO_TRADE last
  const sortOrder = { DEPLOY: 0, STANDBY: 1, NO_TRADE: 2 };
  results.sort((a, b) => (sortOrder[a.verdict] || 9) - (sortOrder[b.verdict] || 9));

  results.forEach(r => {
    const cfg = PAIR_CONFIG[r.pair];
    const emoji = VERDICT_EMOJI[r.verdict] || '⚪';
    const pairIcon = PAIR_EMOJI[r.pair] || '•';
    const price = r.indicators.price.toFixed(r.indicators.price < 10 ? 4 : 2);

    msg += `${emoji} ${pairIcon} *${cfg.name}*: ${r.score} ${r.verdict}`;
    if (r.verdict !== 'NO_TRADE') msg += ` (${r.capital_pct}%)`;
    msg += `\n`;
    msg += `   $${price} • RSI ${r.indicators.rsi.toFixed(0)} • ${r.indicators.trend}\n`;
    if (r.verdict !== 'NO_TRADE') {
      msg += `   _${r.analisa.slice(0, 120)}_\n`;
    } else if (r.no_trade_reasons?.length) {
      msg += `   _${r.no_trade_reasons[0]}_\n`;
    }
    msg += `\n`;
  });

  if (errors.length > 0) {
    msg += `\n⚠️ Errors:\n`;
    errors.forEach(e => msg += `• ${e.pair}: ${e.error.slice(0, 100)}\n`);
  }

  msg += `\n🔗 [Open Dashboard](https://multi-pair-dashboard.vercel.app)`;
  return msg;
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

  const message = formatTelegramMessage(results, errors);

  try {
    await sendTelegram(telegramToken, telegramChatId, message);
  } catch (e) {
    return res.status(500).json({
      error: 'Telegram send failed',
      detail: e.message,
      analysis: results
    });
  }

  const totalTokens = results.reduce((s, r) => s + (r.tokens || 0), 0);
  const cost = (totalTokens / 1_000_000) * 1.5; // rough avg blended price

  return res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    pairs_analyzed: results.length,
    errors: errors.length,
    total_tokens: totalTokens,
    cost_usd: cost.toFixed(4),
    message_preview: message.slice(0, 300)
  });
};
