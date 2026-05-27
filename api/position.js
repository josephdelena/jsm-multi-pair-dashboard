// /api/position.js — Read Uniswap V3 / Aerodrome SlipStream NFT position from Base chain
// Returns: actual LP value (token amounts × USD prices) + uncollected fees
//
// Usage:
//   POST { pair: "ETH", tokenId: 12345, npmAddress: "0x...", poolAddress: "0x..." }
//
// Returns JSON with liquidity, range, current price, token amounts, uncollected fees in USD

// ── Multi-chain config ──
const { AsyncLocalStorage } = require('async_hooks');
const chainCtx = new AsyncLocalStorage();

const CHAINS = {
  base: {
    name: 'Base',
    rpcs: [
      'https://base.llamarpc.com',
      'https://base-rpc.publicnode.com',
      'https://1rpc.io/base',
      'https://base.drpc.org',
      'https://mainnet.base.org'
    ],
    npms: [
      { name: 'Aerodrome SlipStream', address: '0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53', kind: 'slipstream' },
      { name: 'Uniswap V3 (Base)',    address: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', kind: 'uniswap' },
      { name: 'PancakeSwap V3 (Base)', address: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', kind: 'uniswap' }
    ],
    voter: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5', // Aerodrome Voter (cuma kenal Aerodrome pool)
    reward: { symbol: 'AERO', coingeckoId: 'aerodrome-finance' },
    coingeckoPlatform: 'base',
    masterchefs: [
      { name: 'PancakeSwap MasterChef V3', address: '0xC6A2Db661D5a5690172d8eB0a7DEA2d3008665A3', npmKind: 'uniswap', npmHint: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364' }
    ],
    basescan: 'https://api.basescan.org/api',
    knownDexContracts: [
      // NPMs (already in npms list above tapi included untuk completeness scan)
      '0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53', // Aerodrome SlipStream NPM
      '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', // Uniswap V3 NPM
      '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', // PancakeSwap V3 NPM
      // MasterChef
      '0xC6A2Db661D5a5690172d8eB0a7DEA2d3008665A3', // PancakeSwap MasterChef V3
      // Voter
      '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5', // Aerodrome Voter
      // vfat known addresses (Base)
      '0xD62b33A7Df4D0ca5EdD373576E48F73366E36179', // vfat zap/router (dari tx user)
      '0x014cBA9268067dea6635a761e306561bB5d24f99'  // vfat strategy/proxy (dari tx user)
    ]
  },
  optimism: {
    name: 'Optimism',
    rpcs: [
      'https://optimism.llamarpc.com',
      'https://optimism-rpc.publicnode.com',
      'https://1rpc.io/op',
      'https://optimism.drpc.org',
      'https://mainnet.optimism.io'
    ],
    npms: [
      { name: 'Velodrome SlipStream', address: '0x416b433906b1B72FA758e166e239c43d68dC6F29', kind: 'slipstream' },
      { name: 'Uniswap V3 (OP)',      address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', kind: 'uniswap' }
    ],
    voter: '0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C', // Velodrome v2 Voter
    reward: { symbol: 'VELO', coingeckoId: 'velodrome-finance' },
    coingeckoPlatform: 'optimistic-ethereum',
    basescan: 'https://api-optimistic.etherscan.io/api',
    knownDexContracts: [
      '0x416b433906b1B72FA758e166e239c43d68dC6F29', // Velodrome SlipStream NPM
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Uniswap V3 NPM
      '0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C'  // Velodrome v2 Voter
    ]
  },
  arbitrum: {
    name: 'Arbitrum',
    rpcs: [
      'https://arbitrum.llamarpc.com',
      'https://arbitrum-one-rpc.publicnode.com',
      'https://1rpc.io/arb',
      'https://arbitrum.drpc.org',
      'https://arb1.arbitrum.io/rpc'
    ],
    npms: [
      { name: 'Uniswap V3 (Arb)',     address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', kind: 'uniswap' },
      { name: 'PancakeSwap V3 (Arb)', address: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', kind: 'uniswap' },
      { name: 'Camelot V3 (Arb)',     address: '0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15', kind: 'uniswap' }
    ],
    voter: null, // Uniswap/Pancake/Camelot gak ada Solidly-style Voter
    reward: null,
    coingeckoPlatform: 'arbitrum-one',
    masterchefs: [
      { name: 'PancakeSwap MasterChef V3', address: '0x5e09ACf80C0296740eC5d6F643005a4ef8DaA694', npmKind: 'uniswap', npmHint: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364' }
    ],
    basescan: 'https://api.arbiscan.io/api',
    knownDexContracts: [
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Uniswap V3 NPM
      '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', // PancakeSwap V3 NPM
      '0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15', // Camelot V3 NPM
      '0x5e09ACf80C0296740eC5d6F643005a4ef8DaA694'  // PancakeSwap MasterChef V3
    ]
  }
};

// Cache harga reward (in-memory, per-instance Vercel — TTL 60s)
const _priceCache = {};
async function fetchRewardPriceUsd(coingeckoId) {
  if (!coingeckoId) return null;
  const now = Date.now();
  const cached = _priceCache[coingeckoId];
  if (cached && (now - cached.at) < 60_000) return cached.price;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`);
    if (!r.ok) return null;
    const d = await r.json();
    const price = d?.[coingeckoId]?.usd;
    if (typeof price === 'number') {
      _priceCache[coingeckoId] = { price, at: now };
      return price;
    }
  } catch {}
  return null;
}

function getRewardConfig() {
  const ctx = chainCtx.getStore();
  const key = (ctx && ctx.chainKey) || 'base';
  return CHAINS[key].reward;
}

function getCoingeckoPlatform() {
  const ctx = chainCtx.getStore();
  const key = (ctx && ctx.chainKey) || 'base';
  return CHAINS[key].coingeckoPlatform;
}

function getMasterchefs() {
  const ctx = chainCtx.getStore();
  const key = (ctx && ctx.chainKey) || 'base';
  return CHAINS[key].masterchefs || [];
}

// ── Scan PancakeSwap MasterChef V3 Deposit events filtered by user ──
// Event: Deposit(address indexed user, uint256 indexed pid, uint256 indexed tokenId, uint256, int24, int24)
// Topic 0 = 0xb19157bf...82fbf. Reliable: works even if user staked via vfat/router proxy.
async function scanMasterChefDeposits(masterchefAddr, walletAddress) {
  const DEPOSIT_TOPIC = '0xb19157bff94fdd40c58c7d4a5d52e8eb8c2d570ca17b322b49a2bbbeedc82fbf';
  const userTopic = '0x' + pad(walletAddress.replace('0x','').toLowerCase());

  const latestHex = await rpcCall('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const tokenIds = new Set();

  let cursor = latest;
  let chunkSize = 500_000;
  const MIN_CHUNK = 25_000;
  const FLOOR_BLOCK = Math.max(0, latest - 6_000_000); // ~4 bulan di Base

  while (cursor > FLOOR_BLOCK) {
    const toBlk = cursor;
    const fromBlk = Math.max(FLOOR_BLOCK, cursor - chunkSize + 1);
    try {
      const logs = await rpcCall('eth_getLogs', [{
        address: masterchefAddr,
        topics: [DEPOSIT_TOPIC, userTopic], // topic[2]=pid, topic[3]=tokenId, unfiltered
        fromBlock: '0x' + fromBlk.toString(16),
        toBlock: '0x' + toBlk.toString(16)
      }]);
      if (logs && logs.length) {
        for (const log of logs) {
          // tokenId di topic[3]
          if (log.topics[3]) tokenIds.add(BigInt(log.topics[3]).toString());
        }
      }
      cursor = fromBlk - 1;
    } catch (e) {
      if (chunkSize > MIN_CHUNK) { chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2)); continue; }
      cursor = fromBlk - 1;
    }
  }
  return Array.from(tokenIds);
}

// ── Scan NPM Transfer events FROM wallet TO target (mis. masterchef) ──
// Pakai chunk besar (500k blok) karena filter sempit (3 topics) — result count kecil, payload aman.
// Cover ~6M blok ≈ 4 bulan di Base. Halve chunk kalau RPC reject.
async function scanTransfersFromWalletTo(npmAddress, fromWallet, toAddress) {
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const fromTopic = '0x' + pad(fromWallet.replace('0x','').toLowerCase());
  const toTopic = '0x' + pad(toAddress.replace('0x','').toLowerCase());

  const latestHex = await rpcCall('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const tokenIds = new Set();

  let cursor = latest;
  let chunkSize = 500_000;
  const MIN_CHUNK = 25_000;
  const FLOOR_BLOCK = Math.max(0, latest - 6_000_000); // batas ~4 bulan di Base

  while (cursor > FLOOR_BLOCK) {
    const toBlk = cursor;
    const fromBlk = Math.max(FLOOR_BLOCK, cursor - chunkSize + 1);
    try {
      const logs = await rpcCall('eth_getLogs', [{
        address: npmAddress,
        topics: [TRANSFER_TOPIC, fromTopic, toTopic],
        fromBlock: '0x' + fromBlk.toString(16),
        toBlock: '0x' + toBlk.toString(16)
      }]);
      if (logs && logs.length) {
        for (const log of logs) {
          if (log.topics[3]) tokenIds.add(BigInt(log.topics[3]).toString());
        }
      }
      cursor = fromBlk - 1;
    } catch (e) {
      // RPC reject (mungkin range too wide untuk RPC ini) — halve chunk dan retry block range yg sama
      if (chunkSize > MIN_CHUNK) {
        chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
        continue;
      }
      // Udah minimum tapi masih error — skip range ini
      cursor = fromBlk - 1;
    }
  }
  return Array.from(tokenIds);
}

// ── Gauge.rewardToken() → token address (paling akurat) ──
async function resolveRewardToken(gaugeAddress) {
  if (!gaugeAddress) return null;
  for (const sel of ['0xf7c618c1', '0xd1af0c7d']) { // rewardToken, rewardsToken
    try {
      const r = await ethCall(gaugeAddress, sel);
      if (!r || r === '0x') continue;
      const addr = '0x' + r.replace('0x','').slice(-40);
      if (/^0x0+$/.test(addr.replace('0x',''))) continue;
      return addr.toLowerCase();
    } catch {}
  }
  return null;
}

// ── CoinGecko token price by contract address (lebih akurat dari hardcoded id) ──
async function fetchPriceByContract(platform, contractAddr) {
  if (!platform || !contractAddr) return null;
  const cacheKey = `${platform}:${contractAddr.toLowerCase()}`;
  const now = Date.now();
  const cached = _priceCache[cacheKey];
  if (cached && (now - cached.at) < 60_000) return cached.price;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractAddr}&vs_currencies=usd`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const price = d?.[contractAddr.toLowerCase()]?.usd;
    if (typeof price === 'number') {
      _priceCache[cacheKey] = { price, at: now };
      return price;
    }
  } catch {}
  return null;
}

// Cache RPC terakhir yg sukses per-chain — biar gak bayar timeout berulang
// kalau RPC pertama di daftar lagi hang. Self-healing: kalau yg di-cache ikut
// busuk, call berikutnya bakal update ke RPC sehat yg baru.
const _lastGoodRpc = {};

function getRpcs() {
  const ctx = chainCtx.getStore();
  const key = (ctx && ctx.chainKey) || 'base';
  const list = CHAINS[key].rpcs;
  const good = _lastGoodRpc[key];
  if (good && list.includes(good)) {
    return [good, ...list.filter(u => u !== good)];
  }
  return list;
}

function getNpms() {
  const ctx = chainCtx.getStore();
  const key = (ctx && ctx.chainKey) || 'base';
  return CHAINS[key].npms;
}

function getVoter() {
  const ctx = chainCtx.getStore();
  const key = (ctx && ctx.chainKey) || 'base';
  return CHAINS[key].voter;
}

// ── Voter.gauges(pool) → gauge address (0x0 kalau pool gak punya gauge) ──
async function resolveGaugeForPool(poolAddress) {
  const voter = getVoter();
  if (!voter) return null;
  try {
    // gauges(address) = 0xb9a09fd5
    const data = '0xb9a09fd5' + pad(poolAddress.replace('0x','').toLowerCase());
    const r = await ethCall(voter, data);
    const addr = '0x' + r.replace('0x','').slice(-40);
    if (/^0x0+$/.test(addr.replace('0x',''))) return null;
    return addr;
  } catch {
    return null;
  }
}

// ── Gauge.nft() / .nfpm() / .nonfungiblePositionManager() → canonical NPM address ──
// Try semua varian umum, return alamat pertama yg valid.
async function resolveNpmFromGauge(gaugeAddress) {
  if (!gaugeAddress) return null;
  const selectors = ['0x47ccca02', '0x7303e913', '0xb44a2722', '0x791b98bc']; // nft, nfpm, nonfungiblePositionManager, positionManager
  for (const sel of selectors) {
    try {
      const r = await ethCall(gaugeAddress, sel);
      if (!r || r === '0x') continue;
      const addr = '0x' + r.replace('0x','').slice(-40);
      if (/^0x0+$/.test(addr.replace('0x',''))) continue;
      return addr;
    } catch { /* try next */ }
  }
  return null;
}

// Token decimals (sama di Base + Optimism untuk token-token di bawah ini)
const TOKEN_DECIMALS = {
  WETH:  18,
  USDC:  6,
  cbBTC: 8,
  SOL:   9,
  VIRTUAL: 18
};

// ── RPC helpers (with fallback chain, chain-aware via AsyncLocalStorage) ──
async function rpcCall(method, params, opts = {}) {
  // Some methods (eth_getTransactionReceipt) return null kalau RPC node-nya gak punya tx itu —
  // bukan error, tapi means "try next RPC". Set rejectNull = true untuk auto-retry.
  const rejectNull = opts.rejectNull || method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash';
  const ctx = chainCtx.getStore();
  const chainKey = (ctx && ctx.chainKey) || 'base';
  let lastErr;
  for (const url of getRpcs()) {
    // Timeout per-RPC: RPC yg hang (nerima koneksi tapi gak pernah jawab) di-abort
    // 10 detik, bukan ditungguin selamanya. Tanpa ini, satu RPC busuk bikin
    // seluruh function stuck sampai kena limit Vercel.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ac.signal
      });
      clearTimeout(timer);
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status} @ ${url}`); continue; }
      const data = await r.json();
      if (data.error) {
        const msg = (data.error.message || '').toLowerCase();
        if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many')) {
          lastErr = new Error(`RPC: ${data.error.message}`);
          continue;
        }
        throw new Error(`RPC: ${data.error.message}`);
      }
      if (rejectNull && (data.result === null || data.result === undefined)) {
        lastErr = new Error(`null result @ ${url}`);
        continue;
      }
      _lastGoodRpc[chainKey] = url; // inget RPC sehat → dipakai duluan call berikutnya
      return data.result;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  // Kalau semua RPC return null (untuk method yg rejectNull), return null sebagai "genuinely not found"
  if (rejectNull) return null;
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

  const latestHex = await rpcCall('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);

  // Chunked backward scan: 18k blok per chunk (~10 jam di Base @ 2s/block).
  // Max 10 chunks = ~100 jam (~4 hari). Cukup buat posisi yg masih hidup.
  const CHUNK = 18000;
  const MAX_CHUNKS = 10;
  let logs = [];
  let foundAt = -1;
  let scanComplete = true;        // false kalau ada chunk gagal walau udah retry
  const failedRanges = [];

  // eth_getLogs dengan retry (3x, backoff 400/800ms). Tanpa retry, RPC flake
  // bisa diam-diam nge-drop mint event → usdValue undercount → modal salah.
  async function getLogsRetry(fromBlk, toBlk) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await rpcCall('eth_getLogs', [{
          address: npmAddress,
          topics: [eventTopic, tokenIdTopic],
          fromBlock: '0x' + fromBlk.toString(16),
          toBlock: '0x' + toBlk.toString(16)
        }]);
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  for (let c = 0; c < MAX_CHUNKS; c++) {
    const toBlk = latest - (c * CHUNK);
    const fromBlk = Math.max(0, toBlk - CHUNK + 1);
    try {
      const chunk = await getLogsRetry(fromBlk, toBlk);
      if (chunk && chunk.length) {
        logs = chunk.concat(logs); // older first after concat
        if (foundAt < 0) foundAt = c;
      } else if (foundAt >= 0 && c > foundAt) {
        // Sudah ketemu di chunk sebelumnya, dan chunk ini kosong → udah lewat semua mint events
        break;
      }
    } catch (e) {
      // Chunk gagal walau udah retry → scan gak lengkap. Mint event bisa ada di sini,
      // jadi tandai incomplete supaya caller TOLAK hasil (jangan nimpa modal lama).
      scanComplete = false;
      failedRanges.push(`logs ${fromBlk}-${toBlk}`);
    }
    if (fromBlk === 0) break;
  }

  if (!logs.length) {
    // Gak ada log: kalau scan lengkap → emang gak ada mint event (null).
    // Kalau scan-nya gagal → "gak ketauan", jangan dianggap nol.
    return scanComplete ? null : { complete: false, error: 'Scan log RPC gagal — hasil gak lengkap', failedRanges };
  }

  let totalUsd = 0, totalAmount0 = 0n, totalAmount1 = 0n;
  let mintBlock = null, entryPrice = null;
  const s0 = (token0Info.symbol || '').toUpperCase();
  const s1 = (token1Info.symbol || '').toUpperCase();

  // Harga pool historis di blok tertentu, dengan retry.
  async function priceAtBlock(blockNumber) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const slot0Hex = (await ethCallAtBlock(poolAddress, '0x3850c7bd', blockNumber)).replace('0x', '');
        const sqrtPriceX96 = hex2BN(slot0Hex.slice(0, 64));
        const Q96 = BigInt(2) ** BigInt(96);
        const sqrtFloat = Number(sqrtPriceX96) / Number(Q96);
        return sqrtFloat * sqrtFloat * Math.pow(10, token0Info.decimals - token1Info.decimals);
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  for (const log of logs) {
    const data = log.data.replace('0x', '');
    const amount0 = hex2BN(data.slice(64, 128));
    const amount1 = hex2BN(data.slice(128, 192));
    totalAmount0 += amount0;
    totalAmount1 += amount1;

    const amt0H = Number(amount0) / Math.pow(10, token0Info.decimals);
    const amt1H = Number(amount1) / Math.pow(10, token1Info.decimals);

    // Pool price at this block (retry; kalau tetap gagal → tandai incomplete)
    let priceRatio = 0;
    try {
      priceRatio = await priceAtBlock(log.blockNumber);
    } catch (e) {
      scanComplete = false;
      failedRanges.push(`price@${parseInt(log.blockNumber, 16)}`);
    }

    let depositUsd = 0;
    if (s0 === 'USDC' || s0 === 'USDBC') depositUsd = amt0H + (priceRatio ? amt1H / priceRatio : 0);
    else if (s1 === 'USDC' || s1 === 'USDBC') depositUsd = amt1H + amt0H * priceRatio;
    totalUsd += depositUsd;
    if (!mintBlock) {
      mintBlock = parseInt(log.blockNumber, 16);
      entryPrice = (priceRatio > 0) ? priceRatio : null;  // harga pool pas mint pertama
    }
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
    mintCount: logs.length,
    entryPrice,
    complete: scanComplete,
    ...(failedRanges.length ? { failedRanges } : {})
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
  // Uniswap V3 / PancakeSwap V3 ticks() balikin 8 field: feeGrowthOutside0/1 di slot 2/3.
  // Aerodrome/Velodrome SlipStream ticks() balikin 10 field — ada stakedLiquidityNet (slot 2) +
  // rewardGrowthOutside ekstra → feeGrowthOutside0/1 geser ke slot 3/4. Detect dari panjang return data.
  const isSlipstream = hex.length > 8 * 64;
  const fg0 = isSlipstream ? 3 : 2;
  const fg1 = fg0 + 1;
  return {
    feeGrowthOutside0X128: hex2BN(hex.slice(fg0 * 64, (fg0 + 1) * 64)),
    feeGrowthOutside1X128: hex2BN(hex.slice(fg1 * 64, (fg1 + 1) * 64))
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
  // Uniswap V3 pakai unchecked subtraction (mod 2^256) — delta selalu benar walau
  // feeGrowthInside numerik-nya lebih kecil dari snapshot. Itu NORMAL: tiap tick
  // crossing nge-flip feeGrowthOutside, bikin feeGrowthInside "wrap". Perbandingan
  // `>=` mentah salah nge-nol-in fee tiap ada crossing.
  // Yang BENAR perlu di-nol cuma kasus fee udah ke-collect (snapshot lebih maju):
  // hasil mod-subtraction jadi raksasa (> 2^255) → itu yg di-clamp.
  const Q128 = BigInt(1) << BigInt(128);
  const HALF = MASK >> 1n; // 2^255
  const raw0 = (feeGrowthInside0X128 - feeGrowthInside0LastX128 + MASK) % MASK;
  const raw1 = (feeGrowthInside1X128 - feeGrowthInside1LastX128 + MASK) % MASK;
  const delta0 = raw0 < HALF ? raw0 : 0n;
  const delta1 = raw1 < HALF ? raw1 : 0n;

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

// ── Aerodrome SlipStream Gauge: stakedLength(wallet) + stakedByIndex(wallet, i) ──
async function readGaugeStakedLength(gaugeAddress, wallet) {
  // stakedLength(address) = 0xae775c32
  const data = '0xae775c32' + pad(wallet.replace('0x','').toLowerCase());
  const r = await ethCall(gaugeAddress, data);
  return parseInt(r, 16);
}

async function readGaugeStakedByIndex(gaugeAddress, wallet, idx) {
  // stakedByIndex(address,uint256) = 0x38463937
  const data = '0x38463937' + pad(wallet.replace('0x','').toLowerCase()) + pad(toHex(idx));
  const r = await ethCall(gaugeAddress, data);
  return BigInt(r).toString();
}

// ── Enumerate user's NFTs on a NPM, filter by pool match ──
// Mengecek: (a) NFT yg masih di-hold wallet di NPM, dan (b) NFT yg di-stake ke gauge (kalau gauge address ada)
async function findPositionsByPool(walletAddress, poolAddress, poolMeta, gaugeAddress, manualTokenIds) {
  const results = [];
  const seenTokenIds = new Set();
  const candidates = []; // log semua NFT yg di-enumerate (untuk diag kalau gak ketemu match)
  const diag = { npmCounts: {}, gaugeStakedCount: null, gaugeError: null, masterchefStaked: {}, manualTokenIds: [], candidates };

  // Helper: check 1 tokenId di NPM mana → kalau match pool, tambah ke results
  // Match logic per kind:
  //   - uniswap-style (Uniswap V3 / PancakeSwap V3 / Camelot V3): pos.fee = fee tier (100/500/3000/10000), compare ke poolMeta.fee
  //   - slipstream-style (Aerodrome/Velodrome): pos.fee actually = tickSpacing (1/10/50/100/200), compare ke poolMeta.tickSpacing
  async function tryMatch(npm, tokenId, source) {
    // Dedupe per-NPM (tokenId counter beda per NPM contract, jadi tokenId sama bisa exist di 2 NPM beda)
    const key = npm.address.toLowerCase() + ':' + tokenId;
    if (seenTokenIds.has(key)) return;
    seenTokenIds.add(key);
    let pos;
    try { pos = await readPosition(npm.address, tokenId); }
    catch (e) { candidates.push({ tokenId, npm: npm.name, source, error: e.message }); return; }
    const matchToken0 = pos.token0.toLowerCase() === poolMeta.token0;
    const matchToken1 = pos.token1.toLowerCase() === poolMeta.token1;
    const expectedKey = npm.kind === 'slipstream' ? poolMeta.tickSpacing : poolMeta.fee;
    // Fallback: kalau expected key null (mis. pool gak punya field itu), terima any
    const matchFee = expectedKey == null || pos.fee === expectedKey;
    const matched = matchToken0 && matchToken1 && matchFee;
    candidates.push({
      tokenId, npm: npm.name, source,
      token0: pos.token0.toLowerCase(), token1: pos.token1.toLowerCase(), feeOrSpacing: pos.fee, expectedKey,
      matchToken0, matchToken1, matchFee, matched
    });
    if (!matched) return;
    results.push({ tokenId, npmAddress: npm.address, npmName: npm.name, npmKind: npm.kind, source, position: pos });
  }

  // (0) Manual token IDs — untuk kasus vfat zap (NFT di-mint langsung ke proxy, gak pernah di wallet user)
  const hasManual = Array.isArray(manualTokenIds) && manualTokenIds.length > 0;
  if (hasManual) {
    // NPM list = hardcoded getNpms() + NPM canonical hasil resolve dari gauge.
    // Posisi yg di-stake (mis. Velodrome/Aerodrome SlipStream) NPM-nya gak selalu
    // ada di daftar hardcoded — tanpa ini, refresh fast-path gak nemu NFT-nya.
    const manualNpmList = getNpms().slice();
    if (gaugeAddress) {
      try {
        const gaugeNpm = await resolveNpmFromGauge(gaugeAddress);
        if (gaugeNpm && !manualNpmList.some(n => n.address.toLowerCase() === gaugeNpm.toLowerCase())) {
          manualNpmList.push({ name: 'Gauge NPM', address: gaugeNpm, kind: 'slipstream' });
        }
      } catch { /* gauge NPM resolve gagal — lanjut pakai hardcoded aja */ }
    }
    for (const tid of manualTokenIds) {
      const tokenId = String(tid).trim();
      if (!tokenId || !/^\d+$/.test(tokenId)) continue;
      // TokenId counter beda per NPM contract — cek SEMUA NPM, jangan break first.
      // tryMatch akan filter mana yg sesuai pool (token0/token1/fee match).
      const foundInNpms = [];
      for (const npm of manualNpmList) {
        try {
          const r = await ethCall(npm.address, '0x6352211e' + pad(toHex(tokenId)));
          const ownerAddr = ('0x' + r.replace('0x','').slice(-40)).toLowerCase();
          if (ownerAddr && !/^0x0+$/.test(ownerAddr.replace('0x',''))) {
            foundInNpms.push({ npm, ownerAddr });
          }
        } catch { /* not in this NPM, try next */ }
      }
      if (!foundInNpms.length) {
        diag.manualTokenIds.push({ tokenId, error: 'tokenId gak ditemukan di NPM manapun di chain ini' });
        continue;
      }
      // Untuk setiap NPM yg punya tokenId itu, coba match pool. Yang match akan masuk results.
      const masterchefs = getMasterchefs();
      for (const { npm, ownerAddr } of foundInNpms) {
        let source = 'manual';
        const isMasterchef = masterchefs.find(mc => mc.address.toLowerCase() === ownerAddr);
        if (isMasterchef) source = 'masterchef:' + isMasterchef.name.split(' ')[0];
        else if (ownerAddr === walletAddress.toLowerCase()) source = 'wallet';
        else if (gaugeAddress && ownerAddr === gaugeAddress.toLowerCase()) source = 'staked';
        else source = 'manual(owner:' + ownerAddr.slice(0,6) + '...' + ownerAddr.slice(-4) + ')';
        diag.manualTokenIds.push({ tokenId, npm: npm.name, owner: ownerAddr, source });
        await tryMatch(npm, tokenId, source);
      }
    }
    // FAST PATH: user kasih tokenId eksplisit, skip enumeration mahal (balanceOf/MasterChef scan/gauge)
    return { results, diag };
  }

  // (A) Enumerate via NPM ownership (unstaked NFTs masih di wallet)
  for (const npm of getNpms()) {
    let count = 0;
    try { count = await readNftBalance(npm.address, walletAddress); }
    catch { diag.npmCounts[npm.name] = 'err'; continue; }
    diag.npmCounts[npm.name] = count;
    if (!count) continue;
    const limit = Math.min(count, 50);
    for (let i = 0; i < limit; i++) {
      let tokenId;
      try { tokenId = await readTokenOfOwnerByIndex(npm.address, walletAddress, i); }
      catch { continue; }
      await tryMatch(npm, tokenId, 'wallet');
    }
  }

  // (B1) Enumerate via MasterChef staked NFTs.
  //      Primary: scan MasterChef Deposit events filtered by user (works even kalau pakai vfat/router proxy).
  //      Fallback: scan NPM Transfer wallet→masterchef.
  for (const mc of getMasterchefs()) {
    try {
      const npm = getNpms().find(n => n.address.toLowerCase() === mc.npmHint.toLowerCase()) || { name: mc.name+' NPM', address: mc.npmHint, kind: mc.npmKind };
      // Primary: Deposit event scan
      let tokenIds = await scanMasterChefDeposits(mc.address, walletAddress);
      let method = 'deposit-event';
      // Fallback: kalau Deposit event signature beda atau RPC gak support, coba Transfer scan
      if (!tokenIds.length) {
        const fallback = await scanTransfersFromWalletTo(npm.address, walletAddress, mc.address);
        if (fallback.length) { tokenIds = fallback; method = 'transfer-fallback'; }
      }
      diag.masterchefStaked[mc.name] = `${tokenIds.length} (via ${method})`;
      for (const tokenId of tokenIds) {
        // Verify ownerOf still masterchef (kalau udah unstake/withdraw, skip)
        try {
          const ownerResult = await ethCall(npm.address, '0x6352211e' + pad(toHex(tokenId)));
          const owner = ('0x' + ownerResult.replace('0x','').slice(-40)).toLowerCase();
          if (owner !== mc.address.toLowerCase()) continue;
        } catch { continue; }
        await tryMatch(npm, tokenId, 'masterchef:' + mc.name.split(' ')[0]);
      }
    } catch (e) {
      diag.masterchefStaked[mc.name] = 'err: ' + e.message;
    }
  }

  // (B2) Enumerate via gauge stakedByIndex (kalau gauge address dikasih).
  //     NFT yg di-stake ownership-nya pindah ke gauge contract. Untuk baca positions(tokenId),
  //     pakai NPM canonical yg disebut gauge sendiri (gauge.nft() / .nfpm() / ...).
  //     Fallback ke hardcoded slipstream NPM kalau gauge.nft() gak tersedia.
  if (gaugeAddress) {
    try {
      const stakedCount = await readGaugeStakedLength(gaugeAddress, walletAddress);
      diag.gaugeStakedCount = stakedCount;
      const gaugeNpmAddr = await resolveNpmFromGauge(gaugeAddress);
      diag.gaugeNpmResolved = gaugeNpmAddr;
      const fallbackSlipNpm = getNpms().find(n => n.kind === 'slipstream');
      const effectiveNpm = gaugeNpmAddr
        ? { name: 'Gauge NPM', address: gaugeNpmAddr, kind: 'slipstream' }
        : fallbackSlipNpm;
      const limit = Math.min(stakedCount, 50);
      for (let i = 0; i < limit; i++) {
        let tokenId;
        try { tokenId = await readGaugeStakedByIndex(gaugeAddress, walletAddress, i); }
        catch { continue; }
        await tryMatch(effectiveNpm, tokenId, 'staked');
      }
    } catch (e) {
      diag.gaugeError = e.message;
    }
  }

  return { results, diag };
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
async function readFullPosition(npmAddress, tokenId, poolAddress, gaugeAddress, walletAddress, prefetchedPosition, skipDeposit) {
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

  // getOriginalDeposit = chunked eth_getLogs scan — operasi paling berat & paling sering
  // di-throttle/ditolak public RPC (terutama Optimism). Untuk refresh, frontend udah
  // punya modal tersimpan, jadi di-skip biar gak timeout. Cuma dipakai pas search awal.
  let originalDeposit = null;
  if (!skipDeposit) {
    try {
      originalDeposit = await getOriginalDeposit(npmAddress, poolAddress, tokenId, token0Info, token1Info);
    } catch (e) {
      originalDeposit = { error: e.message };
    }
  }

  let aeroEarned = null;
  let rewardSymbol = null, rewardPriceUsd = null, rewardUsd = null;

  // Cek apakah NFT di-stake di MasterChef (PancakeSwap V3) — pakai pendingCake(tokenId) instead of earned()
  let masterchefStaked = null;
  try {
    const ownerR = await ethCall(npmAddress, '0x6352211e' + pad(toHex(tokenId)));
    const owner = ('0x' + ownerR.replace('0x','').slice(-40)).toLowerCase();
    const mc = getMasterchefs().find(m => m.address.toLowerCase() === owner);
    if (mc) masterchefStaked = mc;
  } catch {}

  if (masterchefStaked) {
    // PancakeSwap MasterChef V3: pendingCake(uint256) = 0xce5f39c6
    try {
      const r = await ethCall(masterchefStaked.address, '0xce5f39c6' + pad(toHex(tokenId)));
      const wei = hex2BN(r);
      aeroEarned = Number(wei) / 1e18; // CAKE has 18 decimals
      rewardSymbol = 'CAKE';
      // CAKE token address di Base: 0x305591...13a1, di Arb: 0x1b896893...beb53
      const cakeAddrByChain = {
        base: '0x3055913c90Fcc1A6CE9a358911721eEb942013A1',
        arbitrum: '0x1b896893dfc86bb67Cf57767298b9073D2c1bA2c'
      };
      const ctx = chainCtx.getStore();
      const chainKey = (ctx && ctx.chainKey) || 'base';
      const cakeAddr = cakeAddrByChain[chainKey];
      const platform = CHAINS[chainKey].coingeckoPlatform;
      if (cakeAddr) rewardPriceUsd = await fetchPriceByContract(platform, cakeAddr);
      if (typeof rewardPriceUsd === 'number') rewardUsd = aeroEarned * rewardPriceUsd;
    } catch (e) { aeroEarned = { error: e.message }; }
  } else if (gaugeAddress) {
    try {
      // Build attempt list — gauge implementations beda-beda:
      // 1) earned(address,uint256) — Velo/Aero standard, revert "NA" kalau wallet bukan depositor asli
      // 2) earned(uint256) — variant tokenId-only
      // 3) rewards(uint256) — public mapping getter di Aerodrome SlipStream, never revert (return 0)
      //    Note: rewards() cuma kasih checkpointed accrual; mungkin lebih kecil dari UI realtime,
      //    tapi tetap lebih baik daripada blank "—"
      const attempts = [];
      if (walletAddress) {
        attempts.push({ sel: 'earned(addr,id)', data: '0x3e491d47' + pad(walletAddress.replace('0x','').toLowerCase()) + pad(toHex(tokenId)) });
      }
      attempts.push({ sel: 'earned(id)', data: '0x4d6ed8c4' + pad(toHex(tokenId)) });
      attempts.push({ sel: 'rewards(id)', data: '0xf301af42' + pad(toHex(tokenId)) });
      let earnedResult = null;
      let usedSel = null;
      const errs = [];
      for (const a of attempts) {
        try { earnedResult = await ethCall(gaugeAddress, a.data); usedSel = a.sel; break; }
        catch (e) { errs.push(`${a.sel}: ${e.message}`); }
      }
      if (earnedResult === null) throw new Error('Semua variant earned/rewards revert: ' + errs.join(' | '));
      const earnedWei = hex2BN(earnedResult);
      aeroEarned = Number(earnedWei) / 1e18;
      // Lookup reward token via gauge.rewardToken() (paling akurat).
      // Read symbol dari token contract, lalu fetch price dari CoinGecko BY CONTRACT.
      // Fallback ke hardcoded coingeckoId kalau by-contract gagal.
      const rcfg = getRewardConfig();
      const platform = getCoingeckoPlatform();
      const rewardTokenAddr = await resolveRewardToken(gaugeAddress);
      if (rewardTokenAddr) {
        try {
          const info = await readErc20Info(rewardTokenAddr);
          rewardSymbol = info.symbol || rcfg?.symbol || null;
          // Adjust amount kalau decimals bukan 18
          if (info.decimals && info.decimals !== 18) {
            aeroEarned = Number(earnedWei) / Math.pow(10, info.decimals);
          }
        } catch { rewardSymbol = rcfg?.symbol || null; }
        rewardPriceUsd = await fetchPriceByContract(platform, rewardTokenAddr);
      }
      if (typeof rewardPriceUsd !== 'number' && rcfg) {
        // Fallback to hardcoded coingecko id
        rewardPriceUsd = await fetchRewardPriceUsd(rcfg.coingeckoId);
        if (!rewardSymbol) rewardSymbol = rcfg.symbol;
      }
      if (typeof rewardPriceUsd === 'number') rewardUsd = aeroEarned * rewardPriceUsd;
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
    rewardSymbol,
    rewardAmount: (typeof aeroEarned === 'number') ? aeroEarned : null,
    rewardPriceUsd,
    rewardUsd,
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

  const { mode, tokenId, npmAddress, poolAddress, gaugeAddress, walletAddress, chain, manualTokenIds, basescanKey, lookbackDays, txHash, skipDeposit } = body;
  const chainKey = (chain && CHAINS[chain]) ? chain : 'base';

  return chainCtx.run({ chainKey }, async () => {
    // ── Mode D: parseTx — RPC-only, extract tokenId + pool dari log receipt 1 tx ──
    if (mode === 'parseTx') {
      if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return res.status(400).json({ error: 'parseTx requires: txHash (0x...64 hex)' });
      }
      try {
        let receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
        let actualChain = chainKey;
        // Auto-fallback: kalau gak ketemu di chain selected, coba chain lain
        if (!receipt) {
          for (const otherChain of Object.keys(CHAINS)) {
            if (otherChain === chainKey) continue;
            const r = await chainCtx.run({ chainKey: otherChain }, async () => await rpcCall('eth_getTransactionReceipt', [txHash]));
            if (r) { receipt = r; actualChain = otherChain; break; }
          }
        }
        if (!receipt || !receipt.logs) return res.status(404).json({ error: 'Tx receipt gak ketemu di Base/OP/Arbitrum — cek tx hash + chain' });
        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const INCREASE_TOPIC = '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f';
        const DECREASE_TOPIC = '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4';
        const COLLECT_TOPIC  = '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01';

        // Pakai NPMs dari chain yang sebenarnya (post-fallback)
        const npmAddrs = CHAINS[actualChain].npms.map(n => n.address.toLowerCase());
        const npmByAddr = Object.fromEntries(CHAINS[actualChain].npms.map(n => [n.address.toLowerCase(), n]));

        const tokenIdSet = new Set();
        const eventsByTokenId = {};

        for (const log of receipt.logs) {
          const addr = (log.address || '').toLowerCase();
          if (!npmAddrs.includes(addr)) continue;
          const t0 = log.topics[0];
          if (t0 === TRANSFER_TOPIC && log.topics[3]) {
            const tid = BigInt(log.topics[3]).toString();
            tokenIdSet.add(tid);
            (eventsByTokenId[tid] = eventsByTokenId[tid] || []).push({ type: 'Transfer', npm: addr, from: ('0x' + log.topics[1].slice(-40)).toLowerCase(), to: ('0x' + log.topics[2].slice(-40)).toLowerCase() });
          } else if (t0 === INCREASE_TOPIC && log.topics[1]) {
            const tid = BigInt(log.topics[1]).toString();
            tokenIdSet.add(tid);
            const data = log.data.replace('0x', '');
            (eventsByTokenId[tid] = eventsByTokenId[tid] || []).push({ type: 'IncreaseLiquidity', npm: addr, liquidity: hex2BN(data.slice(0, 64)).toString(), amount0: hex2BN(data.slice(64, 128)).toString(), amount1: hex2BN(data.slice(128, 192)).toString() });
          } else if (t0 === DECREASE_TOPIC && log.topics[1]) {
            const tid = BigInt(log.topics[1]).toString();
            tokenIdSet.add(tid);
            const data = log.data.replace('0x', '');
            (eventsByTokenId[tid] = eventsByTokenId[tid] || []).push({ type: 'DecreaseLiquidity', npm: addr, liquidity: hex2BN(data.slice(0, 64)).toString(), amount0: hex2BN(data.slice(64, 128)).toString(), amount1: hex2BN(data.slice(128, 192)).toString() });
          } else if (t0 === COLLECT_TOPIC && log.topics[1]) {
            const tid = BigInt(log.topics[1]).toString();
            tokenIdSet.add(tid);
            const data = log.data.replace('0x', '');
            (eventsByTokenId[tid] = eventsByTokenId[tid] || []).push({ type: 'Collect', npm: addr, recipient: ('0x' + data.slice(24, 64)).toLowerCase(), amount0: hex2BN(data.slice(64, 128)).toString(), amount1: hex2BN(data.slice(128, 192)).toString() });
          }
        }

        // ERC20 Transfer events — track inflow/outflow per token for user wallet (kalau dikasih)
        const userAddr = (walletAddress || '').toLowerCase();
        const tokenFlows = {}; // { tokenAddr: { amountIn: BigInt, amountOut: BigInt } }
        if (userAddr) {
          for (const log of receipt.logs) {
            if (log.topics[0] !== TRANSFER_TOPIC) continue;
            // ERC721 has topic[3] = tokenId (4 topics); ERC20 has topic[1]+[2] only (3 topics)
            if (log.topics.length !== 3) continue;
            const fromAddr = ('0x' + log.topics[1].slice(-40)).toLowerCase();
            const toAddr = ('0x' + log.topics[2].slice(-40)).toLowerCase();
            const tokenAddr = (log.address || '').toLowerCase();
            if (fromAddr !== userAddr && toAddr !== userAddr) continue;
            const amount = hex2BN(log.data.replace('0x', '').slice(0, 64));
            if (!tokenFlows[tokenAddr]) tokenFlows[tokenAddr] = { amountIn: 0n, amountOut: 0n };
            if (toAddr === userAddr) tokenFlows[tokenAddr].amountIn += amount;
            if (fromAddr === userAddr) tokenFlows[tokenAddr].amountOut += amount;
          }
        }
        // Enrich each token flow with symbol/decimals + human amounts + USD price
        const flows = [];
        const platform = CHAINS[actualChain].coingeckoPlatform;
        for (const [tokenAddr, flow] of Object.entries(tokenFlows)) {
          let info = { symbol: '?', decimals: 18 };
          try {
            info = await chainCtx.run({ chainKey: actualChain }, async () => readErc20Info(tokenAddr));
          } catch {}
          const dec = info.decimals || 18;
          const inHuman = Number(flow.amountIn) / Math.pow(10, dec);
          const outHuman = Number(flow.amountOut) / Math.pow(10, dec);
          const net = inHuman - outHuman;
          // Price USD: USDC/USDbC = 1, else lookup CoinGecko by contract
          const sym = (info.symbol || '').toUpperCase();
          let priceUsd = null;
          if (sym === 'USDC' || sym === 'USDBC' || sym === 'USDT' || sym === 'DAI') priceUsd = 1;
          else priceUsd = await fetchPriceByContract(platform, tokenAddr);
          const valueIn = (typeof priceUsd === 'number') ? inHuman * priceUsd : null;
          const valueOut = (typeof priceUsd === 'number') ? outHuman * priceUsd : null;
          const valueNet = (typeof priceUsd === 'number') ? net * priceUsd : null;
          flows.push({
            address: tokenAddr,
            symbol: info.symbol,
            decimals: dec,
            amountIn: inHuman,
            amountOut: outHuman,
            net,
            priceUsd,
            valueIn,
            valueOut,
            valueNet
          });
        }

        // Resolve pool address(es): pool itu sendiri yang emit Mint (open) / Burn (close).
        // Mint/Burn topic[1] = owner = NPM. pool = log.address. Universal: Uniswap V3 / Aerodrome / Velodrome SlipStream / PancakeSwap V3 / Camelot.
        const MINT_TOPIC = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bae';
        const BURN_TOPIC = '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c';
        const poolByNpm = {};
        const allPoolSet = new Set();
        for (const log of receipt.logs) {
          const t0 = log.topics[0];
          if (t0 !== MINT_TOPIC && t0 !== BURN_TOPIC) continue;
          if (!log.topics[1]) continue;
          const owner = ('0x' + log.topics[1].slice(-40)).toLowerCase();
          const pool = (log.address || '').toLowerCase();
          if (!pool) continue;
          if (npmAddrs.includes(owner) && !poolByNpm[owner]) poolByNpm[owner] = pool;
          allPoolSet.add(pool);
        }
        const singlePool = allPoolSet.size === 1 ? [...allPoolSet][0] : null;

        // For each tokenId, try positions() to get pool info (token0, token1, fee/tickSpacing)
        const results = [];
        for (const tid of tokenIdSet) {
          const evs = eventsByTokenId[tid] || [];
          const npmHit = evs.find(e => e.npm)?.npm;
          let posInfo = null, err = null;
          if (npmHit) {
            try {
              // Pakai chain yg sesuai untuk read position
              posInfo = await chainCtx.run({ chainKey: actualChain }, async () => readPosition(npmHit, tid));
            } catch (e) { err = e.message; }
          }
          results.push({
            tokenId: tid,
            npmAddress: npmHit,
            npmName: npmHit ? npmByAddr[npmHit]?.name : null,
            poolAddress: (npmHit && poolByNpm[npmHit]) || singlePool || null,
            events: evs,
            position: posInfo ? {
              token0: posInfo.token0, token1: posInfo.token1, feeOrSpacing: posInfo.fee,
              liquidity: posInfo.liquidity.toString(),
              tickLower: posInfo.tickLower, tickUpper: posInfo.tickUpper
            } : null,
            positionError: err
          });
        }
        return res.status(200).json({ ok: true, mode: 'parseTx', chain: actualChain, requestedChain: chainKey, txHash, blockNumber: parseInt(receipt.blockNumber, 16), tokenIds: results, tokenFlows: flows });
      } catch (e) {
        return res.status(500).json({ error: 'parseTx failed', detail: e.message });
      }
    }

    // ── Mode C: findClosed (scan recent txs via Basescan, list candidate closed positions) ──
    if (mode === 'findClosed') {
      if (!walletAddress || !basescanKey) {
        return res.status(400).json({ error: 'findClosed requires: walletAddress, basescanKey' });
      }
      const cfg = CHAINS[chainKey];
      if (!cfg.basescan) return res.status(400).json({ error: `Chain ${chainKey} belum support Basescan API` });
      const days = Math.max(1, Math.min(90, parseInt(lookbackDays) || 7));
      try {
        // Dedicated endpoint (basescan.org, optimistic.etherscan.io, arbiscan.io) — gak butuh chainid param
        const url = `${cfg.basescan}?module=account&action=txlist&address=${walletAddress}&page=1&offset=100&sort=desc&apikey=${basescanKey}`;
        const r = await fetch(url);
        const data = await r.json();
        // status '1' = success, '0' = no results or error. Check message untuk membedakan.
        if (data.status === '0' && data.message && data.message !== 'No transactions found') {
          return res.status(500).json({ error: 'Basescan API error', detail: data.message + ' — ' + (typeof data.result === 'string' ? data.result : JSON.stringify(data.result)) });
        }
        const txs = Array.isArray(data.result) ? data.result : [];
        const cutoffTs = Math.floor(Date.now() / 1000) - (days * 86400);
        const known = (cfg.knownDexContracts || []).map(a => a.toLowerCase());
        const candidates = txs
          .filter(t => parseInt(t.timeStamp) >= cutoffTs)
          .filter(t => t.to && t.to !== '') // skip contract creation
          .map(t => ({
            hash: t.hash,
            timeStamp: parseInt(t.timeStamp),
            blockNumber: parseInt(t.blockNumber),
            to: t.to,
            methodId: t.methodId || (t.input || '').slice(0, 10),
            functionName: t.functionName || '',
            value: t.value,
            isError: t.isError === '1',
            isKnownDex: known.includes((t.to || '').toLowerCase())
          }))
          .slice(0, 50);
        return res.status(200).json({ ok: true, mode: 'findClosed', chain: chainKey, walletAddress, lookbackDays: days, candidates });
      } catch (e) {
        return res.status(500).json({ error: 'findClosed failed', detail: e.message });
      }
    }

    // ── Mode B: findByPool (input pool address + wallet, output all matching positions) ──
    if (mode === 'findByPool') {
      if (!poolAddress || !walletAddress) {
        return res.status(400).json({ error: 'findByPool requires: poolAddress, walletAddress' });
      }
      try {
        const poolMeta = await readPoolMeta(poolAddress);
        // SELALU auto-resolve gauge dari Voter chain saat ini (paling akurat).
        // User input cuma fallback kalau Voter return null (pool gak punya gauge resmi).
        let autoResolvedGauge = await resolveGaugeForPool(poolAddress);
        const userGauge = gaugeAddress && /^0x[a-fA-F0-9]{40}$/.test(gaugeAddress) ? gaugeAddress : null;
        let effectiveGauge = autoResolvedGauge || userGauge;
        const { results: matches, diag } = await findPositionsByPool(walletAddress, poolAddress, poolMeta, effectiveGauge, manualTokenIds);
        diag.autoResolvedGauge = autoResolvedGauge;
        diag.effectiveGauge = effectiveGauge;
        if (!matches.length) {
          return res.status(200).json({ ok: true, mode: 'findByPool', chain: chainKey, poolAddress, walletAddress, poolMeta, positions: [], diag, message: `Tidak ada NFT LP milik wallet ini di pool tersebut di chain ${CHAINS[chainKey].name} (wallet maupun staked di gauge).` });
        }
        const positions = [];
        for (const m of matches) {
          try {
            const inner = await readFullPosition(m.npmAddress, m.tokenId, poolAddress, effectiveGauge, walletAddress, m.position, skipDeposit);
            positions.push({ ...inner, chain: chainKey, npmName: m.npmName, npmKind: m.npmKind, source: m.source });
          } catch (e) {
            positions.push({ ok: false, chain: chainKey, tokenId: m.tokenId, npmAddress: m.npmAddress, error: e.message, source: m.source });
          }
        }
        return res.status(200).json({ ok: true, mode: 'findByPool', chain: chainKey, poolAddress, walletAddress, poolMeta, positions, diag });
      } catch (e) {
        return res.status(500).json({ error: 'findByPool failed', detail: e.message, chain: chainKey });
      }
    }

    // ── Mode A (default): tokenId-based read ──
    if (!tokenId || !npmAddress || !poolAddress) {
      return res.status(400).json({ error: 'Required: tokenId, npmAddress, poolAddress (atau pakai mode=findByPool)' });
    }
    try {
      const result = await readFullPosition(npmAddress, tokenId, poolAddress, gaugeAddress, walletAddress);
      return res.status(200).json({ ...result, chain: chainKey });
    } catch (e) {
      return res.status(500).json({ error: 'Position read failed', detail: e.message, chain: chainKey });
    }
  });
};
