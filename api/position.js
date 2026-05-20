// /api/position.js — Read Uniswap V3 / Aerodrome SlipStream NFT position from Base chain
// Returns: actual LP value (token amounts × USD prices) + uncollected fees
//
// Usage:
//   POST { pair: "ETH", tokenId: 12345, npmAddress: "0x...", poolAddress: "0x..." }
//
// Returns JSON with liquidity, range, current price, token amounts, uncollected fees in USD

const RPC_URLS = [
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://mainnet.base.org'
];

// Token decimals on Base
const TOKEN_DECIMALS = {
  WETH:  18,
  USDC:  6,
  cbBTC: 8,
  SOL:   9,    // wormhole-wrapped SOL on Base
  VIRTUAL: 18
};

// ── RPC helpers (with fallback chain) ──
async function rpcCall(method, params) {
  let lastErr;
  for (const url of RPC_URLS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status} @ ${url}`); continue; }
      const data = await r.json();
      if (data.error) {
        // Rate limit or transient — try next RPC
        const msg = (data.error.message || '').toLowerCase();
        if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many')) {
          lastErr = new Error(`RPC: ${data.error.message}`);
          continue;
        }
        throw new Error(`RPC: ${data.error.message}`);
      }
      return data.result;
    } catch (e) {
      lastErr = e;
      // Network error → try next
    }
  }
  throw lastErr || new Error('All RPCs failed');
}

async function ethCall(to, data) {
  return rpcCall('eth_call', [{ to, data }, 'latest']);
}

async function ethCallAtBlock(to, data, blockTag) {
  return rpcCall('eth_call', [{ to, data }, blockTag]);
}

// ── Read original deposit (IncreaseLiquidity events for tokenId) ──
async function getOriginalDeposit(npmAddress, poolAddress, tokenId, token0Info, token1Info) {
  const eventTopic = '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f';
  const tokenIdTopic = '0x' + pad(toHex(tokenId));

  // Get latest block, then try progressively wider ranges
  const latestHex = await rpcCall('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const ranges = [18000]; // ~10 jam (Base ~2s/block)
  let logs = null;
  for (const range of ranges) {
    const fromBlock = '0x' + Math.max(0, latest - range).toString(16);
    try {
      logs = await rpcCall('eth_getLogs', [{
        address: npmAddress,
        topics: [eventTopic, tokenIdTopic],
        fromBlock,
        toBlock: 'latest'
      }]);
      if (logs && logs.length) break;
    } catch (e) {
      // 413 or rate limit — try next smaller... wait, we go bigger. If small fails too, just stop.
      if (range === ranges[0]) continue;
    }
  }
  if (!logs || !logs.length) return null;

  let totalUsd = 0, totalAmount0 = 0n, totalAmount1 = 0n;
  let mintBlock = null;
  const s0 = (token0Info.symbol || '').toUpperCase();
  const s1 = (token1Info.symbol || '').toUpperCase();

  for (const log of logs) {
    const data = log.data.replace('0x', '');
    const amount0 = hex2BN(data.slice(64, 128));
    const amount1 = hex2BN(data.slice(128, 192));
    totalAmount0 += amount0;
    totalAmount1 += amount1;

    const amt0H = Number(amount0) / Math.pow(10, token0Info.decimals);
    const amt1H = Number(amount1) / Math.pow(10, token1Info.decimals);

    // Pool price at this block
    const slot0Hex = (await ethCallAtBlock(poolAddress, '0x3850c7bd', log.blockNumber)).replace('0x', '');
    const sqrtPriceX96 = hex2BN(slot0Hex.slice(0, 64));
    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtFloat = Number(sqrtPriceX96) / Number(Q96);
    const priceRatio = sqrtFloat * sqrtFloat * Math.pow(10, token0Info.decimals - token1Info.decimals);

    let depositUsd = 0;
    if (s0 === 'USDC' || s0 === 'USDBC') depositUsd = amt0H + (priceRatio ? amt1H / priceRatio : 0);
    else if (s1 === 'USDC' || s1 === 'USDBC') depositUsd = amt1H + amt0H * priceRatio;
    totalUsd += depositUsd;
    if (!mintBlock) mintBlock = parseInt(log.blockNumber, 16);
  }

  // Ambil timestamp blok mint pertama (untuk hitung umur posisi)
  let mintTimestamp = null;
  if (mintBlock != null) {
    try {
      const blk = await rpcCall('eth_getBlockByNumber', ['0x' + mintBlock.toString(16), false]);
      if (blk && blk.timestamp) mintTimestamp = parseInt(blk.timestamp, 16);
    } catch {}
  }

  return {
    amount0Total: Number(totalAmount0) / Math.pow(10, token0Info.decimals),
    amount1Total: Number(totalAmount1) / Math.pow(10, token1Info.decimals),
    usdValue: totalUsd,
    mintBlock,
    mintTimestamp,
    mintCount: logs.length
  };
}

// ── ABI encoders/decoders ──
function pad(hex, len = 64) { return hex.replace('0x', '').padStart(len, '0'); }
function toHex(n) { return BigInt(n).toString(16); }
function hex2BN(hex) { return BigInt('0x' + hex.replace('0x', '')); }

function decodeInt24(hex) {
  // hex is 32-byte word, last 3 bytes = int24 (signed)
  const cleaned = hex.replace('0x', '').slice(-6);
  let n = parseInt(cleaned, 16);
  if (n >= 0x800000) n -= 0x1000000; // two's complement
  return n;
}

// ── NPM.positions(tokenId) ──
// Returns: (nonce, operator, token0, token1, fee|tickSpacing, tickLower, tickUpper, liquidity,
//          feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1)
async function readPosition(npmAddress, tokenId) {
  const sel = '0x99fbab88'; // positions(uint256)
  const data = sel + pad(toHex(tokenId));
  const result = await ethCall(npmAddress, data);
  const hex = result.replace('0x', '');
  // 12 fields × 32 bytes = 384 bytes = 768 hex chars
  const fields = [];
  for (let i = 0; i < 12; i++) fields.push(hex.slice(i*64, (i+1)*64));
  return {
    nonce: hex2BN(fields[0]),
    operator: '0x' + fields[1].slice(-40),
    token0: '0x' + fields[2].slice(-40),
    token1: '0x' + fields[3].slice(-40),
    fee: parseInt(fields[4], 16),  // fee tier (Uniswap) atau tickSpacing (Aerodrome)
    tickLower: decodeInt24(fields[5]),
    tickUpper: decodeInt24(fields[6]),
    liquidity: hex2BN(fields[7]),
    feeGrowthInside0LastX128: hex2BN(fields[8]),
    feeGrowthInside1LastX128: hex2BN(fields[9]),
    tokensOwed0: hex2BN(fields[10]),
    tokensOwed1: hex2BN(fields[11])
  };
}

// ── Pool.slot0() ──
async function readSlot0(poolAddress) {
  const result = await ethCall(poolAddress, '0x3850c7bd');
  const hex = result.replace('0x', '');
  return {
    sqrtPriceX96: hex2BN(hex.slice(0, 64)),
    tickCurrent: decodeInt24(hex.slice(64, 128))
  };
}

// ── Pool.feeGrowthGlobal0X128() / feeGrowthGlobal1X128() ──
async function readFeeGrowthGlobals(poolAddress) {
  const [g0, g1] = await Promise.all([
    ethCall(poolAddress, '0xf3058399'),
    ethCall(poolAddress, '0x46141319')
  ]);
  return {
    feeGrowthGlobal0X128: hex2BN(g0),
    feeGrowthGlobal1X128: hex2BN(g1)
  };
}

// ── Pool.ticks(int24) ──
async function readTickInfo(poolAddress, tick) {
  // ticks selector 0xf30dba93
  let tickHex;
  if (tick >= 0) {
    tickHex = pad(tick.toString(16));
  } else {
    // two's complement for int24 padded to 32 bytes (sign-extended)
    const positive = (BigInt(1) << BigInt(256)) + BigInt(tick);
    tickHex = pad(positive.toString(16));
  }
  const data = '0xf30dba93' + tickHex;
  const result = await ethCall(poolAddress, data);
  const hex = result.replace('0x', '');
  // (liquidityGross uint128, liquidityNet int128, feeGrowthOutside0 uint256, feeGrowthOutside1 uint256, ...)
  return {
    feeGrowthOutside0X128: hex2BN(hex.slice(2*64, 3*64)),
    feeGrowthOutside1X128: hex2BN(hex.slice(3*64, 4*64))
  };
}

// ── V3 LP token amounts from liquidity + range + current sqrtPrice ──
function getTokenAmounts(liquidity, sqrtPriceX96, tickLower, tickUpper) {
  const Q96 = BigInt(2) ** BigInt(96);
  // sqrtPrice at lower/upper bound = 1.0001^(tick/2) × 2^96, but easier to convert via JS math then BigInt
  const sqrtLower = Math.sqrt(Math.pow(1.0001, tickLower));
  const sqrtUpper = Math.sqrt(Math.pow(1.0001, tickUpper));
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);

  let amount0 = 0, amount1 = 0;
  const L = Number(liquidity);

  if (sqrtPrice <= sqrtLower) {
    amount0 = L * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
    amount1 = 0;
  } else if (sqrtPrice >= sqrtUpper) {
    amount0 = 0;
    amount1 = L * (sqrtUpper - sqrtLower);
  } else {
    amount0 = L * (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
    amount1 = L * (sqrtPrice - sqrtLower);
  }
  return { amount0, amount1 };
}

// ── Compute uncollected fees ──
function computeUncollectedFees(position, slot0, feeGrowthGlobals, tickLowerInfo, tickUpperInfo) {
  const { tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1 } = position;
  const tickCurrent = slot0.tickCurrent;
  const { feeGrowthGlobal0X128, feeGrowthGlobal1X128 } = feeGrowthGlobals;

  // feeGrowthBelow(tickLower)
  let feeGrowthBelow0, feeGrowthBelow1;
  if (tickCurrent >= tickLower) {
    feeGrowthBelow0 = tickLowerInfo.feeGrowthOutside0X128;
    feeGrowthBelow1 = tickLowerInfo.feeGrowthOutside1X128;
  } else {
    feeGrowthBelow0 = feeGrowthGlobal0X128 - tickLowerInfo.feeGrowthOutside0X128;
    feeGrowthBelow1 = feeGrowthGlobal1X128 - tickLowerInfo.feeGrowthOutside1X128;
  }

  // feeGrowthAbove(tickUpper)
  let feeGrowthAbove0, feeGrowthAbove1;
  if (tickCurrent < tickUpper) {
    feeGrowthAbove0 = tickUpperInfo.feeGrowthOutside0X128;
    feeGrowthAbove1 = tickUpperInfo.feeGrowthOutside1X128;
  } else {
    feeGrowthAbove0 = feeGrowthGlobal0X128 - tickUpperInfo.feeGrowthOutside0X128;
    feeGrowthAbove1 = feeGrowthGlobal1X128 - tickUpperInfo.feeGrowthOutside1X128;
  }

  // feeGrowthInside = feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove (mod 2^256)
  const MASK = (BigInt(1) << BigInt(256));
  const feeGrowthInside0X128 = (feeGrowthGlobal0X128 - feeGrowthBelow0 - feeGrowthAbove0 + MASK + MASK) % MASK;
  const feeGrowthInside1X128 = (feeGrowthGlobal1X128 - feeGrowthBelow1 - feeGrowthAbove1 + MASK + MASK) % MASK;

  // delta × liquidity / 2^128
  // If feeGrowthInside < feeGrowthInsideLast (e.g. fees already auto-collected by gauge),
  // treat delta as 0 instead of wrapping to huge number.
  const Q128 = BigInt(1) << BigInt(128);
  const delta0 = feeGrowthInside0X128 >= feeGrowthInside0LastX128
    ? (feeGrowthInside0X128 - feeGrowthInside0LastX128)
    : 0n;
  const delta1 = feeGrowthInside1X128 >= feeGrowthInside1LastX128
    ? (feeGrowthInside1X128 - feeGrowthInside1LastX128)
    : 0n;

  const fees0 = (delta0 * liquidity) / Q128 + tokensOwed0;
  const fees1 = (delta1 * liquidity) / Q128 + tokensOwed1;

  return { fees0, fees1 };
}

// ── Pool metadata: token0, token1, tickSpacing (Aerodrome) atau fee (Uniswap V3) ──
async function readPoolMeta(poolAddress) {
  // token0() = 0x0dfe1681, token1() = 0xd21220a7, tickSpacing() = 0xd0c93a7c, fee() = 0xddca3f43
  const [t0r, t1r] = await Promise.all([
    ethCall(poolAddress, '0x0dfe1681'),
    ethCall(poolAddress, '0xd21220a7')
  ]);
  const token0 = ('0x' + t0r.replace('0x','').slice(-40)).toLowerCase();
  const token1 = ('0x' + t1r.replace('0x','').slice(-40)).toLowerCase();
  // Coba tickSpacing dulu (Aerodrome SlipStream / Uniswap V3 sama-sama punya tickSpacing)
  let tickSpacing = null, fee = null;
  try {
    const tsr = await ethCall(poolAddress, '0xd0c93a7c');
    tickSpacing = parseInt(tsr, 16);
  } catch {}
  try {
    const fr = await ethCall(poolAddress, '0xddca3f43');
    fee = parseInt(fr, 16);
  } catch {}
  return { token0, token1, tickSpacing, fee };
}

// ── NPM.balanceOf(wallet) → uint256 ──
async function readNftBalance(npmAddress, wallet) {
  // balanceOf(address) = 0x70a08231
  const data = '0x70a08231' + pad(wallet.replace('0x','').toLowerCase());
  const r = await ethCall(npmAddress, data);
  return parseInt(r, 16);
}

// ── NPM.tokenOfOwnerByIndex(wallet, i) → uint256 tokenId ──
async function readTokenOfOwnerByIndex(npmAddress, wallet, idx) {
  // tokenOfOwnerByIndex(address,uint256) = 0x2f745c59
  const data = '0x2f745c59' + pad(wallet.replace('0x','').toLowerCase()) + pad(toHex(idx));
  const r = await ethCall(npmAddress, data);
  return BigInt(r).toString();
}

// Known NPM addresses on Base
const KNOWN_NPMS = [
  { name: 'Aerodrome SlipStream', address: '0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53', kind: 'slipstream' },
  { name: 'Uniswap V3',           address: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', kind: 'uniswap' }
];

// ── Enumerate user's NFTs on a NPM, filter by pool match ──
async function findPositionsByPool(walletAddress, poolAddress, poolMeta) {
  const results = [];
  for (const npm of KNOWN_NPMS) {
    let count;
    try { count = await readNftBalance(npm.address, walletAddress); }
    catch { continue; } // NPM might not be deployed, skip
    if (!count || count === 0) continue;
    // Hard cap untuk safety (RPC budget) — user gak mungkin punya >50 NFT LP aktif di 1 NPM
    const limit = Math.min(count, 50);
    for (let i = 0; i < limit; i++) {
      let tokenId;
      try { tokenId = await readTokenOfOwnerByIndex(npm.address, walletAddress, i); }
      catch { continue; }
      let pos;
      try { pos = await readPosition(npm.address, tokenId); }
      catch { continue; }
      // Match by token pair
      const matchToken0 = pos.token0.toLowerCase() === poolMeta.token0;
      const matchToken1 = pos.token1.toLowerCase() === poolMeta.token1;
      if (!matchToken0 || !matchToken1) continue;
      // Match by tickSpacing (slipstream) atau fee (uniswap). Pos.fee field carries either.
      const tickOrFee = pos.fee;
      const poolKey = poolMeta.tickSpacing != null ? poolMeta.tickSpacing : poolMeta.fee;
      if (poolKey != null && tickOrFee !== poolKey) continue;
      results.push({ tokenId, npmAddress: npm.address, npmName: npm.name, npmKind: npm.kind, position: pos });
    }
    // Found something on this NPM → no need try the other (still try in case user has positions on both, but to save RPC, stop)
    if (results.length) break;
  }
  return results;
}

// ── Get token info (decimals + symbol) ──
async function readErc20Info(addr) {
  // symbol() = 0x95d89b41, decimals() = 0x313ce567
  const [symResult, decResult] = await Promise.all([
    ethCall(addr, '0x95d89b41'),
    ethCall(addr, '0x313ce567')
  ]);
  // Decode symbol (string)
  let symbol = '';
  try {
    const hex = symResult.replace('0x', '');
    // Standard ABI string: offset (32B), length (32B), data
    if (hex.length >= 128) {
      const len = parseInt(hex.slice(64, 128), 16);
      const dataHex = hex.slice(128, 128 + len * 2);
      symbol = Buffer.from(dataHex, 'hex').toString('utf8');
    } else {
      // Some tokens return bytes32 directly (MKR-style)
      symbol = Buffer.from(hex.replace(/0+$/, ''), 'hex').toString('utf8');
    }
  } catch { symbol = '?'; }
  const decimals = parseInt(decResult, 16);
  return { symbol, decimals };
}

// ── Full position read (parallelized) — dipakai untuk single tokenId atau batch findByPool ──
async function readFullPosition(npmAddress, tokenId, poolAddress, gaugeAddress, walletAddress, prefetchedPosition) {
  const position = prefetchedPosition || await readPosition(npmAddress, tokenId);
  const [slot0, feeGrowthGlobals, tickLowerInfo, tickUpperInfo, token0Info, token1Info] = await Promise.all([
    readSlot0(poolAddress),
    readFeeGrowthGlobals(poolAddress),
    readTickInfo(poolAddress, position.tickLower),
    readTickInfo(poolAddress, position.tickUpper),
    readErc20Info(position.token0),
    readErc20Info(position.token1)
  ]);

  const { amount0, amount1 } = getTokenAmounts(position.liquidity, slot0.sqrtPriceX96, position.tickLower, position.tickUpper);
  const amount0_human = amount0 / Math.pow(10, token0Info.decimals);
  const amount1_human = amount1 / Math.pow(10, token1Info.decimals);

  const { fees0, fees1 } = computeUncollectedFees(position, slot0, feeGrowthGlobals, tickLowerInfo, tickUpperInfo);
  const fees0_human = Number(fees0) / Math.pow(10, token0Info.decimals);
  const fees1_human = Number(fees1) / Math.pow(10, token1Info.decimals);

  const Q96 = BigInt(2) ** BigInt(96);
  const sqrtPriceFloat = Number(slot0.sqrtPriceX96) / Number(Q96);
  const priceRatio = sqrtPriceFloat * sqrtPriceFloat * Math.pow(10, token0Info.decimals - token1Info.decimals);
  const priceLower = Math.pow(1.0001, position.tickLower) * Math.pow(10, token0Info.decimals - token1Info.decimals);
  const priceUpper = Math.pow(1.0001, position.tickUpper) * Math.pow(10, token0Info.decimals - token1Info.decimals);

  let originalDeposit = null;
  try {
    originalDeposit = await getOriginalDeposit(npmAddress, poolAddress, tokenId, token0Info, token1Info);
  } catch (e) {
    originalDeposit = { error: e.message };
  }

  let aeroEarned = null;
  if (gaugeAddress) {
    try {
      let earnedData;
      if (walletAddress) {
        earnedData = '0x3e491d47' + pad(walletAddress.replace('0x','').toLowerCase()) + pad(toHex(tokenId));
      } else {
        earnedData = '0x4d6ed8c4' + pad(toHex(tokenId));
      }
      const earnedResult = await ethCall(gaugeAddress, earnedData);
      const earnedWei = hex2BN(earnedResult);
      aeroEarned = Number(earnedWei) / 1e18;
    } catch (e) {
      aeroEarned = { error: e.message };
    }
  }

  return {
    ok: true,
    tokenId,
    poolAddress,
    npmAddress,
    tickCurrent: slot0.tickCurrent,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    inRange: slot0.tickCurrent >= position.tickLower && slot0.tickCurrent < position.tickUpper,
    liquidity: position.liquidity.toString(),
    currentPrice: priceRatio,
    rangeLower: priceLower,
    rangeUpper: priceUpper,
    token0: { ...token0Info, address: position.token0, amount: amount0_human, fees: fees0_human },
    token1: { ...token1Info, address: position.token1, amount: amount1_human, fees: fees1_human },
    aeroEarned,
    originalDeposit,
    raw: {
      amount0_wei: Math.floor(amount0).toString(),
      amount1_wei: Math.floor(amount1).toString(),
      fees0_wei: fees0.toString(),
      fees1_wei: fees1.toString()
    }
  };
}

// ── Main handler ──
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || await new Promise(r => {
    let s=''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s)); } catch { r({}); } });
  });

  const { mode, tokenId, npmAddress, poolAddress, gaugeAddress, walletAddress } = body;

  // ── Mode B: findByPool (input pool address + wallet, output all matching positions) ──
  if (mode === 'findByPool') {
    if (!poolAddress || !walletAddress) {
      return res.status(400).json({ error: 'findByPool requires: poolAddress, walletAddress' });
    }
    try {
      const poolMeta = await readPoolMeta(poolAddress);
      const matches = await findPositionsByPool(walletAddress, poolAddress, poolMeta);
      if (!matches.length) {
        return res.status(200).json({ ok: true, mode: 'findByPool', poolAddress, walletAddress, poolMeta, positions: [], message: 'Tidak ada NFT LP milik wallet ini di pool tersebut.' });
      }
      // For each match, run full position-read pipeline
      const positions = [];
      for (const m of matches) {
        try {
          const inner = await readFullPosition(m.npmAddress, m.tokenId, poolAddress, gaugeAddress, walletAddress, m.position);
          positions.push({ ...inner, npmName: m.npmName, npmKind: m.npmKind });
        } catch (e) {
          positions.push({ ok: false, tokenId: m.tokenId, npmAddress: m.npmAddress, error: e.message });
        }
      }
      return res.status(200).json({ ok: true, mode: 'findByPool', poolAddress, walletAddress, poolMeta, positions });
    } catch (e) {
      return res.status(500).json({ error: 'findByPool failed', detail: e.message });
    }
  }

  // ── Mode A (default): tokenId-based read ──
  if (!tokenId || !npmAddress || !poolAddress) {
    return res.status(400).json({ error: 'Required: tokenId, npmAddress, poolAddress (atau pakai mode=findByPool)' });
  }

  try {
    const result = await readFullPosition(npmAddress, tokenId, poolAddress, gaugeAddress, walletAddress);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: 'Position read failed', detail: e.message });
  }
};
