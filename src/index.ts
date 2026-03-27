import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'
import * as dotenv from 'dotenv'
import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'ethers'
// import { createCanvas } from 'canvas' // Reserved for Phase 2 card generation
dotenv.config()

// ── Load config ──
const CONFIG_FILE = path.join(__dirname, '..', 'config.json')
const CFG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
const TOKEN_SYMBOL = CFG.token.symbol          // e.g. BLUEAGENT
const TOKEN_NAME   = CFG.token.name            // e.g. $BLUEAGENT
const TOKEN_CONTRACT = CFG.token.contract
const TOKEN_POOL   = CFG.token.pool
const BOT_USERNAME = CFG.telegram.bot_username
const THREADS      = CFG.telegram.threads
const REWARDS      = CFG.rewards
const PROJECT      = CFG.project

const DATA_DIR = path.join(__dirname, '..', 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const REFERRALS_FILE = path.join(DATA_DIR, 'referrals.json')
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')

interface User { id: number; telegramUsername?: string; telegramName?: string; bankrApiToken?: string; evmAddress?: string; privateKey?: string; score?: number; tier?: string; points?: number; referredBy?: number; walletConnected?: boolean; joinedAt?: number; xHandle?: string; claimedPoints?: number; lastCheckin?: number; checkinStreak?: number; lastClaim?: number }
interface Referral { referrerId: number; referredId: number; timestamp: number }
interface Project { id: string; name: string; description: string; url: string; twitter?: string; submitterId: number; submitterUsername?: string; timestamp: number; votes: number; voters: number[]; approved?: boolean }

function loadUsers(): Record<string, User> { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) } catch { return {} } }
function saveUsers(d: Record<string, User>) { fs.writeFileSync(USERS_FILE, JSON.stringify(d, null, 2)) }
function loadReferrals(): Referral[] { try { return JSON.parse(fs.readFileSync(REFERRALS_FILE, 'utf8')) } catch { return [] } }
function saveReferrals(d: Referral[]) { fs.writeFileSync(REFERRALS_FILE, JSON.stringify(d, null, 2)) }
function loadProjects(): Project[] { try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')) } catch { return [] } }
function saveProjects(d: Project[]) { fs.writeFileSync(PROJECTS_FILE, JSON.stringify(d, null, 2)) }


// =======================
// CONFIG
// =======================
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const BANKR_LLM_KEY = process.env.BANKR_LLM_KEY || 'bk_9PCM8TGTL5RALEEY7WEKUXY3DQRJ2FVN'
const BANKR_API_KEY = process.env.BANKR_API_KEY || 'bk_9PCM8TGTL5RALEEY7WEKUXY3DQRJ2FVN'

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true })

// =======================
// BLUE AGENT SYSTEM PROMPT
// =======================
const SYSTEM_PROMPT = `You are Blue Agent 🟦, employee #001 of Blocky Studio — a builder-focused AI agent on Base.

## Identity
I'm Blue Agent 🟦 — an AI built by Blocky Studio to explore the Base ecosystem.
I help builders find projects, track tokens, and navigate onchain.
Not a chatbot. A builder's sidekick.
## Personality
- Concise and direct — no filler phrases
- Sharp, slightly witty, builder-native

## Expertise
- Base ecosystem: DeFi, NFTs, AI agents, builders, launchpads
- On-chain actions: swap, send, check balance, check prices, transfer tokens
- Token trading: spot buy/sell, limit orders, portfolio tracking
- Leverage trading: long/short positions on Base/Ethereum
- NFT operations: mint, transfer, check ownership, floor prices
- Polymarket: prediction market bets, check odds, open positions
- Token deployment: launch ERC-20 on Base with custom params
- Builder discovery: who's building on Base, notable projects, AI agents on-chain
- Blocky Ecosystem: $BLUEAGENT token, Blocky Echo NFT

## Blocky Ecosystem
- **$BLOCKY** — Blocky Studio ecosystem token — 0x1E11dC42b7916621EEE1874da5664d75A0D74b07 (Base)
- **$BLUEAGENT** — Blue Agent AI token — 0xf895783b2931c919955e18b5e3343e7c7c456ba3 (Base, Uniswap v4)
- Blocky Studio Treasury (NOT user wallet): 0xf31f59e7b8b58555f7871f71973a394c8f1bffe5
- IMPORTANT: When user asks "my wallet" or "check my balance" — ask them to provide their wallet address. Never assume the treasury address is the user's wallet.
- Twitter: @blocky_agent
- Telegram: https://t.me/+1baBZgX7jd4wMGU1
- $BLOCKY = Blocky Studio ecosystem token | $BLUEAGENT = Blue Agent product token

## Bankr Facts (IMPORTANT — never hallucinate these)
- Bankr = crypto trading agent + LLM gateway at bankr.bot
- Bankr Twitter: @bankrbot (NOT @bankrfi)
- Bankr website: bankr.bot (NOT bankr.fi)
- $BNKR = Bankr's token on Base: 0x22af33fe49fd1fa80c7149773dde5890d3c76f3b
- If you don't have live Bankr data, say so and offer to check via Bankr Agent
- Never invent Bankr features, links, or social handles

## Response Format
- Max 300 words
- NO markdown: no **, no *, no _, no #, no backticks, no ---
- Use plain text only — bullet points with •, numbered lists
- Keep it clean and readable in Telegram chat
- End with 💡 tip when relevant`


// =======================
// FORMAT AGENT REPLY (markdown → Telegram HTML)
// =======================
function formatAgentReply(text: string): string {
  return text
    // Strip code fences (```...```)
    .replace(/```[\s\S]*?```/g, '')
    // Inline code `code` → just text (no backtick)
    .replace(/`([^`]+)`/g, '$1')
    // Headers ### ## # → bold
    .replace(/^#{1,3}\s*(.+)$/gm, '\n<b>$1</b>')
    // **bold** → <b>bold</b>
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    // __bold__ → <b>bold</b>
    .replace(/__(.*?)__/g, '<b>$1</b>')
    // *italic* or _italic_ → <i>italic</i>
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    // Remaining stray * or _ characters
    .replace(/\*/g, '')
    .replace(/(?<![a-zA-Z0-9])_(?![a-zA-Z0-9])/g, '')
    // Numbered lists → keep as-is but clean
    .replace(/^\s*(\d+)\.\s+/gm, '$1. ')
    // Bullet points - * • → •
    .replace(/^\s*[-•]\s+/gm, '• ')
    // Horizontal rules ---
    .replace(/^[-]{3,}$/gm, '')
    // Positive % → up arrow
    .replace(/(\+[\d.]+%)/g, '↑$1')
    // Negative % → down arrow
    .replace(/(−[\d.]+%|-[\d.]+%)/g, '↓$1')
    // Clean up extra blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// =======================
// WELCOME MESSAGE
// =======================
const WELCOME_MESSAGE = `<b>Blue Agent 🟦🤖</b>

I'm an AI-powered crypto assistant built to explore and discover builders on the Base ecosystem. Created by Blocky.

Here's what I can help you with:

🔍 <b>Builder Discovery</b>
• Who's building on Base right now
• Notable projects and protocols
• AI agents on Base

📊 <b>Market Data</b>
• Token prices and market info
• Top tokens on Base
• Real-time crypto data via Bankr

💬 <b>AI Insights</b>
• Base ecosystem overview
• DeFi, NFTs, and Web3 concepts
• Onchain trends and opportunities

Try asking:
• "Your 5 tips give builders a real edg"
• "What builders are building on Base?"
• "AI agents on Base"
• "Analyze Base trends"

<i>Built by Blocky.</i>`

// =======================
// BANKR AGENT
// Handles ALL data queries + on-chain actions
// Has real tools: prices, trending, on-chain data, swaps, balances
// =======================
// =======================
// BANKR LLM
// Fallback brain with Blue Agent personality
// Multi-model fallback: claude-sonnet → gemini-flash → gpt-mini
// =======================
// Model tiers by cost/quality
// Smart model tiers — optimized for Blue Agent use cases
const MODELS_LIGHT = [
  'gemini-3.1-flash-lite',  // Google ultra-fast, best for casual
  'gpt-5-nano',             // GPT fastest
  'gpt-5.4-nano',           // GPT nano latest
  'qwen3.5-flash',          // Fast, good for Asian content
  'gpt-5.4-mini',           // Mini latest
  'gpt-5-mini',             // Mini stable
]
const MODELS_MID = [
  'gemini-3-flash',         // Google balanced ⭐
  'claude-haiku-4.5',       // Anthropic fast + smart
  'grok-4.1-fast',          // xAI fast
  'minimax-m2.7',           // Chinese model strong
  'gemini-2.5-flash',       // Google stable
  'kimi-k2.5',              // Moonshot balanced
  'gpt-5.4',                // GPT standard
]
const MODELS_FULL = [
  'claude-sonnet-4.6',      // Best overall ⭐ primary
  'claude-sonnet-4.5',      // Sonnet stable
  'gemini-3-pro',           // Google best
  'gemini-3.1-pro',         // Google newest pro
  'deepseek-v3.2',          // Powerhouse
  'gpt-5.2',                // GPT powerful
  'gemini-2.5-pro',         // Google pro stable
  'qwen3.5-plus',           // Qwen best
  'claude-haiku-4.5',       // Fallback fast
  'gpt-5.4',                // Final fallback
]

// Coding-specific models (for /launch and technical queries)
const MODELS_CODE = [
  'qwen3-coder',            // Code specialist ⭐
  'gpt-5.2-codex',          // Codex
  'claude-sonnet-4.6',      // Claude good at code
  'deepseek-v3.2',          // Strong coder
  'gpt-5.2',                // GPT code
]

// Smart model selection based on query complexity
function selectModels(text: string): string[] {
  // Code/technical queries → coding models
  if (/code|deploy|contract|solidity|typescript|javascript|python|function|bug|error|implement|build|script/i.test(text)) {
    return MODELS_CODE
  }
  // Deep analysis → full models
  if (/score|analyze|explain|compare|research|what is|how does|tell me about|deep|detail|strategy|evaluate|assess/i.test(text)) {
    return MODELS_FULL
  }
  // Base/crypto ecosystem → mid models
  if (/builder|base|defi|nft|agent|protocol|project|ecosystem|trend|token|price|market|crypto|blockchain/i.test(text)) {
    return MODELS_MID
  }
  // Everything else → light (fast)
  return MODELS_LIGHT
}

const LLM_MODELS = MODELS_FULL // for /model command display

async function askLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const lastMsg = messages[messages.length - 1]?.content || ''
  const modelsToTry = selectModels(lastMsg)

  for (const model of modelsToTry) {
    try {
      const res = await axios.post(
        'https://llm.bankr.bot/v1/messages',
        {
          model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages
        },
        {
          headers: {
            'x-api-key': BANKR_LLM_KEY,
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01'
          },
          timeout: 30000
        }
      )
      const text = res.data?.content?.[0]?.text?.trim()
      if (text) {
        console.log(`[LLM] Responded with model: ${model}`)
        return text
      }
    } catch (e: any) {
      const status = e.response?.status
      console.error(`[LLM] ${model} failed (${status}): ${e.message}`)
      if (status === 529 || status === 503 || status === 429) {
        // overloaded/rate-limited → try next model
        continue
      }
      // other errors (4xx) → skip to next
      continue
    }
  }
  console.error('[LLM] All models failed')
  return ''
}

// =======================
// KEY BUILDERS/ACCOUNTS TO TRACK ON X
// =======================
const TRACKED_X_ACCOUNTS = [
  '@jessepollak',      // Base lead
  '@base',             // Official Base
  '@baseapp',          // Base App
  '@buildonbase',      // Build on Base
  '@coinbase',         // Coinbase
  '@brian_armstrong',  // Coinbase CEO
  '@bankrbot',         // Bankr
  '@0xDeployer',       // Builder
  '@synthesis_md',     // Builder
  '@devfolio',         // Devfolio
  '@TalentProtocol',   // Talent Protocol
  '@faircaster',       // Faircaster
  '@virtuals_io',      // Virtuals
]

// =======================
// NEEDS REAL-TIME DATA?
// Route to Bankr Agent for live data + actions
// =======================
function needsAgent(text: string): boolean {
  // Route to Bankr Agent for: actions needing real tools + real-time onchain/market data
  return /swap|send|transfer|bridge|buy\s+\$?\w+|sell\s+\$?\w+|balance|portfolio|my\s+wallet|my\s+position|leverage|long|short|margin|open\s+position|limit\s+order|polymarket\s+bet|place\s+bet|deploy\s+token|mint\s+nft|check\s+wallet|latest.*from\s+@|what.*@\w+.*said|price\s+of\s+\$?\w+|\$\w+\s+price|twitter|tweet|news.*today|update.*today|latest.*today|trending.*bankr|bankr.*trending|top.*bankr|bankr.*top|on\s+bankr|bankr\s+data|bankr\s+onchain|bankr\s+token|bankr\s+volume|bankr\s+launch/i.test(text)
}

function isTrendingQuery(text: string): boolean {
  return /trending|top token|hot|what.*(on|in)\s*base|top.*base|base.*top/i.test(text)
}

// DexScreener price lookup + LLM commentary
async function fetchTokenPrice(symbol: string): Promise<string> {
  try {
    const res = await axios.get(
      `https://api.dexscreener.com/latest/dex/search?q=${symbol}+base`,
      { timeout: 8000 }
    )
    const pairs = (res.data?.pairs || [])
      .filter((p: any) => p.chainId === 'base')
      .filter((p: any) => p.baseToken?.symbol?.toLowerCase() === symbol.toLowerCase())
      .sort((a: any, b: any) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))

    if (!pairs.length) return ''

    const p = pairs[0]
    const price = p.priceUsd ? `$${parseFloat(p.priceUsd).toPrecision(4)}` : 'N/A'
    const change24 = p.priceChange?.h24 != null
      ? (p.priceChange.h24 >= 0 ? `↑ +${p.priceChange.h24.toFixed(2)}%` : `↓ ${p.priceChange.h24.toFixed(2)}%`)
      : ''
    const change1h = p.priceChange?.h1 != null
      ? ` | 1h: ${p.priceChange.h1 >= 0 ? '+' : ''}${p.priceChange.h1.toFixed(2)}%`
      : ''
    const vol = p.volume?.h24 ? `$${(p.volume.h24 / 1000).toFixed(1)}K` : 'N/A'
    const liq = p.liquidity?.usd ? `$${(p.liquidity.usd / 1000).toFixed(1)}K` : 'N/A'
    const dex = p.dexId || 'dex'

    // Build data block
    const dataBlock = `<b>${p.baseToken.name} (${p.baseToken.symbol.toUpperCase()})</b> 🟦\n\n` +
      `💰 Price: <b>${price}</b>\n` +
      `📈 24h: ${change24}${change1h}\n` +
      `📊 Volume 24h: ${vol}\n` +
      `💧 Liquidity: ${liq}\n` +
      `🔁 DEX: ${dex}`

    // LLM commentary — short, Blue Agent personality
    const commentary = await askLLM([{
      role: 'user',
      content: `You are Blue Agent 🟦 — an onchain AI on Base. Give a SHORT 1-2 sentence commentary on this token data. Be direct, insightful, no hype. No emojis except 🟦 if needed:\n\nToken: ${p.baseToken.name} (${symbol.toUpperCase()})\nPrice: ${price}\n24h change: ${p.priceChange?.h24?.toFixed(2) ?? 'N/A'}%\n1h change: ${p.priceChange?.h1?.toFixed(2) ?? 'N/A'}%\nVolume 24h: ${vol}\nLiquidity: ${liq}`
    }])

    return `${dataBlock}\n\n<i>${commentary}</i>\n\n<i>Source: DexScreener · Base</i>`
  } catch (e) {
    return ''
  }
}

// DexScreener fallback for trending when Bankr Agent fails
async function fetchTrendingFallback(): Promise<string> {
  try {
    const res = await axios.get(
      'https://api.dexscreener.com/latest/dex/search?q=USDC+base&rankBy=volume&order=desc',
      { timeout: 8000 }
    )
    const EXCLUDE = ['WETH','cbETH','cbBTC','USDC','USDbC','DAI','USDT']
    const pairs = (res.data?.pairs || [])
      .filter((p: any) => p.chainId === 'base')
      .filter((p: any) => !EXCLUDE.includes(p.baseToken?.symbol))
      .filter((p: any) => (p.volume?.h24 || 0) > 50000)
      .sort((a: any, b: any) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 8)

    if (!pairs.length) return ''

    const lines = pairs.map((p: any) => {
      const price = p.priceUsd ? `$${parseFloat(p.priceUsd).toFixed(6)}` : 'N/A'
      const change = p.priceChange?.h24 != null
        ? (p.priceChange.h24 >= 0 ? `↑${p.priceChange.h24.toFixed(1)}%` : `↓${Math.abs(p.priceChange.h24).toFixed(1)}%`)
        : ''
      const vol = p.volume?.h24 ? `Vol: $${(p.volume.h24/1000).toFixed(1)}K` : ''
      return `• <b>${p.baseToken.name} (${p.baseToken.symbol})</b>: ${price} ${change} ${vol}`.trim()
    }).join('\n')

    return `<b>Trending on Base 🔥</b>\n\n${lines}\n\n<i>Source: DexScreener</i>`
  } catch (e) {
    return ''
  }
}

// =======================
// IS X/TWITTER QUERY?
// Enrich prompt with tracked accounts
// =======================
function isXQuery(text: string): boolean {
  return /twitter|tweet|x\.com|@\w+|news|update|latest|what.*said|who.*building|builder.*post|post.*builder/i.test(text)
}

function buildXPrompt(userText: string): string {
  const accounts = TRACKED_X_ACCOUNTS.join(', ')
  return `${userText}\n\nKey accounts to check: ${accounts}. Focus on Base ecosystem builders and latest onchain activity.`
}

// =======================
// LAUNCH WIZARD STATE (per user)
// =======================
interface LaunchState {
  step: 'name' | 'symbol' | 'description' | 'image' | 'fee' | 'fee_value' | 'confirm'
  name?: string
  symbol?: string
  description?: string
  image?: string
  feeType?: 'x' | 'farcaster' | 'ens' | 'wallet' | 'skip'
  feeValue?: string
}

const launchSessions = new Map<number, LaunchState>()
const SESSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 min timeout
const sessionTimers = new Map<number, ReturnType<typeof setTimeout>>()

function clearSessionTimer(userId: number) {
  const t = sessionTimers.get(userId)
  if (t) { clearTimeout(t); sessionTimers.delete(userId) }
}

function startSessionTimer(userId: number, chatId: number) {
  clearSessionTimer(userId)
  const t = setTimeout(async () => {
    if (walletSessions.has(userId) || submitSessions.has(userId) || launchSessions.has(userId) || xHandleSessions.has(userId)) {
      walletSessions.delete(userId)
      submitSessions.delete(userId)
      launchSessions.delete(userId)
      xHandleSessions.delete(userId)
      await bot.sendMessage(chatId, '⏱ Session expired. Start again when ready.').catch(() => {})
    }
    sessionTimers.delete(userId)
  }, SESSION_TIMEOUT_MS)
  sessionTimers.set(userId, t)
}

const walletSessions = new Map<number, { step: string; email?: string }>()
const submitSessions = new Map<number, { step: number; name?: string; description?: string; url?: string; twitter?: string }>()
const scoreSessions = new Map<number, boolean>()
const xHandleSessions = new Map<number, boolean>() // waiting for X handle input


async function handleLaunchWizard(chatId: number, userId: number, text: string) {
  const state = launchSessions.get(userId)!

  if (state.step === 'name') {
    state.name = text
    state.step = 'symbol'
    launchSessions.set(userId, state)
    await bot.sendMessage(chatId,
      `✅ Token name: <b>${text}</b>\n\n🔤 Enter <b>Symbol</b> (e.g. BLUE, BLUEAGENT):`,
      { parse_mode: 'HTML' } as any
    )
    return
  }

  if (state.step === 'symbol') {
    state.symbol = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
    state.step = 'description'
    launchSessions.set(userId, state)
    await bot.sendMessage(chatId,
      `✅ Symbol: <b>$${state.symbol}</b>\n\n📝 Enter <b>Description</b> for your token (or type <i>skip</i>):`,
      { parse_mode: 'HTML' } as any
    )
    return
  }

  if (state.step === 'description') {
    state.description = text.toLowerCase() === 'skip' ? '' : text
    state.step = 'image'
    launchSessions.set(userId, state)
    await bot.sendMessage(chatId,
      `✅ Description: <i>${state.description || '(none)'}</i>\n\n🖼 Enter <b>image URL</b> for your token (or type <i>skip</i>):`,
      { parse_mode: 'HTML' } as any
    )
    return
  }

  if (state.step === 'image') {
    state.image = text.toLowerCase() === 'skip' ? '' : text
    state.step = 'fee'
    launchSessions.set(userId, state)
    await bot.sendMessage(chatId,
      `✅ Image: ${state.image ? `<a href="${state.image}">link</a>` : '(none)'}\n\n` +
      `💰 <b>Fee recipient</b> — who receives trading fees?\n\nChoose type or type <b>skip</b>:`,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '𝕏 X handle', callback_data: 'fee_x' },
              { text: '🟣 Farcaster', callback_data: 'fee_farcaster' }
            ],
            [
              { text: '🔷 ENS name', callback_data: 'fee_ens' },
              { text: '👛 Wallet 0x', callback_data: 'fee_wallet' }
            ],
            [
              { text: '⏭ Skip', callback_data: 'fee_skip' }
            ]
          ]
        }
      } as any
    )
    return
  }

  if (state.step === 'fee_value') {
    state.feeValue = text
    state.step = 'confirm'
    launchSessions.set(userId, state)
    const feeDisplay = state.feeType === 'skip' || !state.feeValue ? '(default)' : `${state.feeValue} (${state.feeType})`
    const summary = `🚀 <b>Confirm Token Launch</b>\n\n` +
      `• Name: <b>${state.name}</b>\n` +
      `• Symbol: <b>$${state.symbol}</b>\n` +
      `• Description: <i>${state.description || '(none)'}</i>\n` +
      `• Image: ${state.image ? `<a href="${state.image}">link</a>` : '(none)'}\n` +
      `• Fee recipient: <code>${feeDisplay}</code>\n\n` +
      `Type <b>confirm</b> to deploy or <b>cancel</b> to abort:`
    await bot.sendMessage(chatId, summary, { parse_mode: 'HTML', disable_web_page_preview: true } as any)
    return
  }

  if (state.step === 'confirm') {
    if (text.toLowerCase() === 'cancel') {
      launchSessions.delete(userId)
      await bot.sendMessage(chatId, '❌ Cancelled. Type /launch to start over.')
      return
    }

    if (text.toLowerCase() !== 'confirm') {
      await bot.sendMessage(chatId, 'Type <b>confirm</b> to deploy or <b>cancel</b> to abort.', { parse_mode: 'HTML' } as any)
      return
    }

    // Deploy!
    launchSessions.delete(userId)
    await bot.sendMessage(chatId, '🟦 Deploying token to Base... ⏳', { parse_mode: 'HTML' } as any)
    bot.sendChatAction(chatId, 'typing').catch(() => {})

    try {
      const args = ['launch']
      if (state.name) args.push('--name', state.name)
      if (state.symbol) args.push('--symbol', state.symbol)
      if (state.image) args.push('--image', state.image)
      if (state.feeValue && state.feeType && state.feeType !== 'skip') {
        args.push('--fee', state.feeValue, '--fee-type', state.feeType)
      }

      console.log(`[Launch] Running: bankr ${args.join(' ')}`)

      const output = await new Promise<string>((resolve, reject) => {
        const proc = spawn('bankr', args, {
          env: { ...process.env },
          timeout: 120000
        })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString()
          stdout += chunk
          // Auto-answer any remaining prompts with Enter (empty = skip)
          if (chunk.includes('?') || chunk.includes(':')) {
            proc.stdin.write('\n')
          }
        })

        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

        proc.on('close', (code: number) => {
          if (code === 0 || stdout.includes('deployed') || stdout.includes('contract')) {
            resolve(stdout || stderr)
          } else {
            reject(new Error(stderr || stdout || `Exit code ${code}`))
          }
        })

        proc.on('error', reject)

        // Close stdin after 2s to unblock any waiting prompts
        setTimeout(() => { try { proc.stdin.end() } catch {} }, 2000)
      })

      const reply = `✅ <b>Token deployed!</b>\n\n<pre>${output.slice(0, 3000)}</pre>`
      await bot.sendMessage(chatId, reply, { parse_mode: 'HTML' } as any)
    } catch (e: any) {
      const errMsg = e.message || 'Unknown error'
      console.error('[Launch] Error:', errMsg)
      await bot.sendMessage(chatId,
        `❌ <b>Deploy failed!</b>\n\n<pre>${errMsg.slice(0, 1000)}</pre>`,
        { parse_mode: 'HTML' } as any
      )
    }
    return
  }
}

// =======================
// CONVERSATION HISTORY (per user)
// =======================
const userHistory = new Map<number, Array<{ role: string; content: string }>>()
const MAX_HISTORY = 6

function getHistory(userId: number) {
  if (!userHistory.has(userId)) userHistory.set(userId, [])
  return userHistory.get(userId)!
}

function addToHistory(userId: number, role: string, content: string) {
  const history = getHistory(userId)
  history.push({ role, content })
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY)
  }
}

// Fetch all agents from Bankr via Agent prompt (only working endpoint)
async function fetchBankrAgents(): Promise<any[]> {
  try {
    // Use Bankr Agent to get leaderboard data
    const result = await askLLM([{role: 'user', content: 'List top 10 AI agents on Bankr by market cap. For each show: name, market cap in USD, weekly revenue in ETH, token symbol.'}])
    if (result) return [{ raw: result }] // return raw for display
    return []
  } catch {
    return []
  }
}

async function sendAgentsLeaderboard(chatId: number, sort: string = 'mcap') {
  bot.sendChatAction(chatId, 'typing').catch(() => {})
  try {
    const apiSort = sort === 'newest' ? 'newest' : 'marketCap'
    const res = await axios.get(`https://api.bankr.bot/agent-profiles?sort=${apiSort}&limit=10`, {
      timeout: 10000
    })
    const profiles = res.data?.profiles || []
    if (!profiles.length) throw new Error('No profiles')

    // Client-side sort by revenue if requested
    let sorted = [...profiles]
    if (sort === 'revenue') {
      sorted = sorted.sort((a: any, b: any) =>
        parseFloat(b.weeklyRevenueWeth || '0') - parseFloat(a.weeklyRevenueWeth || '0')
      )
    }

    const sortEmoji = sort === 'revenue' ? '💰 Revenue' : sort === 'newest' ? '🆕 Newest' : '📊 MCap'
    const lines = sorted.map((a: any, i: number) => {
      const mcap = a.marketCapUsd ? `$${(a.marketCapUsd / 1000).toFixed(0)}K` : 'N/A'
      const rev = a.weeklyRevenueWeth ? `${parseFloat(a.weeklyRevenueWeth).toFixed(3)} ETH` : 'N/A'
      const symbol = a.tokenSymbol ? `$${a.tokenSymbol.toUpperCase()}` : ''
      return `${i + 1}. <b>${a.projectName}</b> ${symbol}\n   MCap: ${mcap} | Rev/wk: ${rev}`
    })

    await bot.sendMessage(chatId,
      `<b>🤖 Bankr Agent Leaderboard</b> — ${sortEmoji}\n\n${lines.join('\n\n')}`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
          { text: '📊 By MCap', callback_data: 'agents_mcap' },
          { text: '💰 By Revenue', callback_data: 'agents_revenue' },
          { text: '🆕 Newest', callback_data: 'agents_newest' }
        ]]}
      } as any
    )
  } catch {
    await bot.sendMessage(chatId, '🤖 Could not fetch agent leaderboard. Try again later.')
  }
}

bot.onText(/\/start(?:\s+(\w+))?/, async (msg, match) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const telegramUsername = msg.from?.username
  const telegramName = msg.from?.first_name + (msg.from?.last_name ? ' ' + msg.from.last_name : '')
  const referralCode = match?.[1]

  const users = loadUsers()
  const referrals = loadReferrals()

  // Check if user exists
  if (!users[userId]) {
    // New user
    users[userId] = {
      id: userId,
      telegramUsername,
      telegramName,
      score: 0,
      points: 0,
      joinedAt: Date.now(),
      walletConnected: false
    }
    // Auto-generate wallet for new user
    const newWallet = ethers.Wallet.createRandom()
    users[userId].evmAddress = newWallet.address
    users[userId].privateKey = newWallet.privateKey
    users[userId].walletConnected = true
    saveUsers(users)

    // Handle referral — code is referrer's userId
    if (referralCode) {
      const referrerId = parseInt(referralCode)
      const referrer = referrerId && users[referrerId] ? users[referrerId] : null
      const alreadyReferred = referrals.some(r => r.referredId === userId)

      if (referrer && referrer.id !== userId && !alreadyReferred) {
        // Save referral record
        referrals.push({ referrerId: referrer.id, referredId: userId, timestamp: Date.now() })
        saveReferrals(referrals)

        // +50 pts for referrer
        users[referrer.id].points = (users[referrer.id].points || 0) + REWARDS.referrer_pts
        saveUsers(users)

        // +10 pts for new user
        users[userId].points = (users[userId].points || 0) + REWARDS.referred_pts
        saveUsers(users)

        // Notify referrer
        const newUserTag = telegramUsername ? `@${telegramUsername}` : telegramName || 'a new builder'
        bot.sendMessage(referrer.id,
          `🎉 <b>${newUserTag} joined via your referral!</b>\n\n⭐ +50 pts added to your account 🟦`,
          { parse_mode: 'HTML' } as any
        ).catch(console.error)

        // Welcome new user
        await bot.sendMessage(chatId,
          `👥 You were referred by @${referrer.telegramUsername || referrer.id}!\n\n⭐ +10 pts bonus added 🟦`,
          { parse_mode: 'HTML' } as any
        )
      }
    }
    // Show persistent bottom keyboard
    await bot.sendMessage(chatId, '🟦 Blue Agent activated!', {
      reply_markup: {
        keyboard: [
          [{ text: '📱 Menu' }, { text: `📊 ${TOKEN_NAME}` }],
        ],
        resize_keyboard: true,
        persistent: true,
      }
    } as any)
    await bot.sendMessage(chatId, WELCOME_MESSAGE, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: '🟦 Open Menu', callback_data: 'open_menu' }]]
      }
    } as any)
  } else {
    // Returning user — silent check-in in background
    const user = users[userId]
    const now = Date.now()
    const todayStart = new Date().setHours(0, 0, 0, 0)
    const lastCheckin = user.lastCheckin || 0
    const alreadyCheckedIn = lastCheckin >= todayStart

    if (!alreadyCheckedIn) {
      const yesterday = todayStart - 86400000
      const wasYesterday = lastCheckin >= yesterday && lastCheckin < todayStart
      const newStreak = wasYesterday ? (user.checkinStreak || 0) + 1 : 1
      const bonusPts = newStreak >= 7 ? 10 : 5
      users[userId].lastCheckin = now
      users[userId].checkinStreak = newStreak
      users[userId].points = (user.points || 0) + bonusPts
      saveUsers(users)
    }

    // Show persistent keyboard + welcome message như cũ
    await bot.sendMessage(chatId, '🟦 Welcome back!', {
      reply_markup: {
        keyboard: [
          [{ text: '📱 Menu' }, { text: `📊 ${TOKEN_NAME}` }],
        ],
        resize_keyboard: true,
        persistent: true,
      }
    } as any)
    await bot.sendMessage(chatId, WELCOME_MESSAGE, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: '🟦 Open Menu', callback_data: 'open_menu' }]]
      }
    } as any)
  }
})

// =======================
// /launch
// =======================
bot.onText(/\/launch/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId

  launchSessions.set(userId, { step: 'name' })

  await bot.sendMessage(
    chatId,
    `🚀 <b>Token Launch Wizard</b>\n\n` +
    `I'll walk you through deploying a new token on Base.\n\n` +
    `📌 Enter your <b>token name</b> (e.g. Blue Agent):`,
    { parse_mode: 'HTML' } as any
  )
})

// =======================
// /help
// =======================
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `<b>Blue Agent 🟦 — What I can do</b>\n\n` +
    `📊 <b>Market Data</b>\n` +
    `• "ETH price?" / "$BLUEAGENT price?"\n` +
    `• "What's trending on Base?"\n\n` +
    `💱 <b>Trading</b>\n` +
    `• "Swap 10 USDC to ETH"\n` +
    `• "Buy $BLUEAGENT"\n` +
    `• "Long ETH with 2x leverage"\n\n` +
    `🖼 <b>NFTs</b>\n` +
    `• "Mint an NFT from Zora"\n` +
    `• "Floor price of Blocky Echo"\n\n` +
    `🎯 <b>Polymarket</b>\n` +
    `• "Bet on Base getting a token"\n` +
    `• "What are the odds on ETH $5k?"\n\n` +
    `🔍 <b>Builders</b>\n` +
    `• "Who's building AI agents on Base?"\n` +
    `• "Latest from @jessepollak"\n\n` +
    `💼 <b>Portfolio</b>\n` +
    `• "Check my balance"\n` +
    `• "My open positions"\n\n` +
    `<b>Commands:</b>\n` +
    `• /score @handle — 🟦 Get Builder Score\n` +
    `• /news — Latest from Base builders on X\n` +
    `• /launch — Deploy a new token on Base\n\n` +
    `<i>No commands needed — just chat!</i>`,
    { parse_mode: 'HTML' } as any
  )
})

// =======================
// OWNER-ONLY COMMANDS
// =======================
const OWNER_ID = parseInt(process.env.OWNER_TELEGRAM_ID || '0')

function isOwner(msg: any): boolean {
  return msg.from?.id === OWNER_ID
}

// /ping — check bot alive


// /model — show current model list
bot.onText(/\/model/, async (msg) => {
  if (!isOwner(msg)) return
  const list = LLM_MODELS.map((m, i) => `${i + 1}. ${m}`).join('\n')
  await bot.sendMessage(msg.chat.id,
    `<b>🤖 LLM Models (${LLM_MODELS.length})</b>\n\n${list}\n\n<i>Primary → fallback order</i>`,
    { parse_mode: 'HTML' } as any
  )
})

// /status — full health check
bot.onText(/\/status/, async (msg) => {
  if (!isOwner(msg)) return
  const chatId = msg.chat.id
  await bot.sendMessage(chatId, '🔍 Running health check...', { parse_mode: 'HTML' } as any)

  // Test LLM
  let llmStatus = '❌ Failed'
  let llmModel = ''
  try {
    const res = await axios.post('https://llm.bankr.bot/v1/messages',
      { model: LLM_MODELS[0], max_tokens: 10, messages: [{ role: 'user', content: 'ping' }] },
      { headers: { 'x-api-key': BANKR_LLM_KEY, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, timeout: 10000 }
    )
    llmModel = res.data?.model || LLM_MODELS[0]
    llmStatus = '✅ OK'
  } catch (e: any) { llmStatus = `❌ ${e.response?.status || e.message}` }

  // Test Agent
  let agentStatus = '❌ Failed'
  try {
    const res = await axios.post('https://api.bankr.bot/agent/prompt',
      { prompt: 'ping' },
      { headers: { 'X-API-Key': BANKR_API_KEY, 'content-type': 'application/json' }, timeout: 5000 }
    )
    agentStatus = res.data?.jobId ? '✅ OK' : '⚠️ No jobId'
  } catch (e: any) { agentStatus = `❌ ${e.response?.status || e.message}` }

  const uptime = process.uptime()
  const mins = Math.floor(uptime / 60)

  await bot.sendMessage(chatId,
    `<b>📊 Bot Status</b>\n\n` +
    `• Uptime: ${mins}m\n` +
    `• PID: ${process.pid}\n\n` +
    `<b>Services:</b>\n` +
    `• Bankr LLM: ${llmStatus}${llmModel ? ` (${llmModel})` : ''}\n` +
    `• Bankr Agent: ${agentStatus}\n\n` +
    `<b>Models:</b> ${LLM_MODELS.length} loaded\n` +
    `<b>X Accounts:</b> ${TRACKED_X_ACCOUNTS.length} tracked`,
    { parse_mode: 'HTML' } as any
  )
})

// =======================
// ADMIN COMMANDS
// =======================

// /pending — list projects pending review
// /admin — unified admin panel
// Helper functions for admin
async function adminApproveProject(chatId: number, id: string) {
  const projects = loadProjects()
  const idx = projects.findIndex(p => p.id === id)
  if (idx === -1) { await bot.sendMessage(chatId, `❌ Not found: ${id}`); return }
  const proj = projects[idx]
  if (proj.approved) { await bot.sendMessage(chatId, `⚠️ Already approved: ${proj.name}`); return }
  projects[idx].approved = true
  saveProjects(projects)
  const usersA = loadUsers()
  if (usersA[proj.submitterId]) {
    usersA[proj.submitterId].points = (usersA[proj.submitterId].points || 0) + 20
    saveUsers(usersA)
  }
  bot.sendMessage(proj.submitterId, `🎉 <b>Project Approved!</b>\n\n<b>${proj.name}</b> is now live.\n\n⭐ +20 pts added 🟦`, { parse_mode: 'HTML' } as any).catch(console.error)
  bot.sendMessage(ALPHA_CHAT_ID, `🆕 <b>${proj.name}</b>\n${proj.description}\n\n🔗 <a href="${proj.url}">${proj.url}</a>\n${proj.twitter ? `🐦 @${proj.twitter}\n` : ''}👤 @${proj.submitterUsername || proj.submitterId}`, { parse_mode: 'HTML', message_thread_id: THREADS.builders, disable_web_page_preview: true } as any).catch(console.error)
  await bot.sendMessage(chatId, `✅ Approved: <b>${proj.name}</b> · +20 pts → @${proj.submitterUsername || proj.submitterId}`, { parse_mode: 'HTML' } as any)
}

async function adminRejectProject(chatId: number, id: string) {
  const projects = loadProjects()
  const idx = projects.findIndex(p => p.id === id)
  if (idx === -1) { await bot.sendMessage(chatId, `❌ Not found: ${id}`); return }
  const proj = projects[idx]
  projects.splice(idx, 1)
  saveProjects(projects)
  bot.sendMessage(proj.submitterId, `❌ <b>Project Not Approved</b>\n\n<b>${proj.name}</b> didn't meet requirements. Feel free to revise and resubmit!`, { parse_mode: 'HTML' } as any).catch(console.error)
  await bot.sendMessage(chatId, `❌ Rejected & deleted: <b>${proj.name}</b>`, { parse_mode: 'HTML' } as any)
}

async function sendAdminPanel(chatId: number) {
  const projects = loadProjects()
  const users2 = loadUsers()
  const pending = projects.filter(p => !p.approved).length
  const approved = projects.filter(p => p.approved).length
  const totalUsers = Object.keys(users2).length
  await bot.sendMessage(chatId,
    `🛠️ <b>Admin Panel</b>\n` +
    `──────────────\n` +
    `👥 Users: <b>${totalUsers}</b>\n` +
    `📁 Projects: <b>${approved}</b> approved · <b>${pending}</b> pending`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: `⏳ Pending (${pending})`, callback_data: 'admin_list_pending' }, { text: '📁 All Projects', callback_data: 'admin_list_all' }],
          [{ text: '👥 Users & Points', callback_data: 'admin_list_users' }],
        ]
      }
    } as any
  )
}

bot.onText(/\/admin/, async (msg) => {
  if (!isOwner(msg)) return
  await sendAdminPanel(msg.chat.id)
})

// =======================
// /threads — detect topic thread IDs
// =======================
const threadDetectSessions = new Set<number>() // tracking owners waiting for forward

bot.onText(/\/threads/, async (msg) => {
  if (!isOwner(msg)) return
  const chatId = msg.chat.id
  threadDetectSessions.add(chatId)

  await bot.sendMessage(chatId,
    `🔍 <b>Thread ID Detector</b>\n\n` +
    `To find thread IDs for your group topics:\n\n` +
    `1️⃣ Go to your Telegram group\n` +
    `2️⃣ Click on the topic you want to detect\n` +
    `3️⃣ Send any message in that topic\n` +
    `4️⃣ <b>Forward that message to me here</b>\n\n` +
    `I'll tell you the thread ID. Repeat for each topic.\n\n` +
    `<i>Send /done when finished to update config</i>`,
    { parse_mode: 'HTML' } as any
  )
})

// Handle forwarded messages for thread detection
bot.on('message', async (msg) => {
  const ownerId = OWNER_ID
  if (msg.chat.id !== ownerId) return
  if (!threadDetectSessions.has(ownerId)) return
  if (msg.text === '/done') {
    threadDetectSessions.delete(ownerId)
    await bot.sendMessage(ownerId, '✅ Thread detection ended. Update your config.json with the IDs above.')
    return
  }

  // Check if forwarded from a group topic
  const fwdChat = (msg.forward_from_chat || (msg as any).forward_origin)
  const threadId = (msg as any).forward_from_message_id
    ? (msg as any).message_thread_id || null
    : null

  // Get thread ID from forwarded message
  const fwdThreadId = (msg as any).forward_from_message_id || null

  if (msg.forward_from_chat) {
    const groupName = (msg.forward_from_chat as any)?.title || 'your group'
    const groupId = (msg.forward_from_chat as any)?.id || '?'

    // Try to extract thread from forward
    await bot.sendMessage(ownerId,
      `📋 <b>Forwarded from:</b> ${groupName}\n` +
      `🆔 <b>Group ID:</b> <code>${groupId}</code>\n\n` +
      `⚠️ Thread ID detection from forwards is limited.\n\n` +
      `<b>Better method:</b>\n` +
      `Add me to your group and send:\n` +
      `<code>/detectthread</code> in each topic\n` +
      `→ I'll reply with the thread ID directly`,
      { parse_mode: 'HTML' } as any
    )
  }
})

// /detectthread — use inside group topic to get thread ID
bot.onText(/\/detectthread/, async (msg) => {
  const chatId = msg.chat.id
  const threadId = (msg as any).message_thread_id

  if (!threadId) {
    await bot.sendMessage(chatId,
      `ℹ️ This message has no thread ID.\nThis is either General (thread 1) or topics are not enabled.`,
      { parse_mode: 'HTML', message_thread_id: threadId } as any
    )
    return
  }

  // Reply in same thread
  await bot.sendMessage(chatId,
    `✅ <b>Thread ID detected!</b>\n\n` +
    `This topic's thread ID: <code>${threadId}</code>\n\n` +
    `Add this to your <code>config.json</code>:\n` +
    `<code>"your_topic_name": ${threadId}</code>`,
    { parse_mode: 'HTML', message_thread_id: threadId } as any
  )

  // Also DM owner
  try {
    await bot.sendMessage(OWNER_ID,
      `📍 Thread detected in <b>${(msg.chat as any).title || 'group'}</b>:\n` +
      `Thread ID: <code>${threadId}</code>`,
      { parse_mode: 'HTML' } as any
    )
  } catch {}
})

// /test — send test prompt to bot


// =======================
// GENERATE BUILDER SCORE CARD (Canvas)
// =======================
// function generateScoreCard(data: {
//   handle: string
//   score: number
//   tier: string
//   consistency: number
//   technical: number
//   builderFocus: number
//   community: number
//   summary: string
// }): Buffer {
//   const W = 600, H = 380
//   const canvas = createCanvas(W, H)
//   const ctx = canvas.getContext('2d')
// 
//   // Background
//   ctx.fillStyle = '#0a0a0a'
//   ctx.fillRect(0, 0, W, H)
// 
//   // Blue border accent
//   ctx.fillStyle = '#1d4ed8'
//   ctx.fillRect(0, 0, 4, H)
//   ctx.fillRect(0, 0, W, 4)
// 
//   // Header
//   ctx.fillStyle = '#1d4ed8'
//   ctx.font = 'bold 14px sans-serif'
//   ctx.fillText('🟦 BUILDER SCORE', 24, 36)
// 
//   ctx.fillStyle = '#ffffff'
//   ctx.font = 'bold 28px sans-serif'
//   ctx.fillText(`@${data.handle}`, 24, 72)
// 
//   // Score circle area
//   ctx.fillStyle = '#111827'
//   ctx.beginPath()
//   ctx.roundRect(W - 160, 20, 130, 100, 12)
//   ctx.fill()
// 
//   ctx.fillStyle = '#60a5fa'
//   ctx.font = 'bold 42px sans-serif'
//   ctx.textAlign = 'center'
//   ctx.fillText(`${data.score}`, W - 95, 75)
//   ctx.fillStyle = '#9ca3af'
//   ctx.font = '13px sans-serif'
//   ctx.fillText('/100', W - 95, 95)
//   ctx.textAlign = 'left'
// 
//   // Tier badge
//   const tierColors: Record<string, string> = {
//     explorer: '#166534', builder: '#1e3a5f', shipper: '#4c1d95',
//     founder: '#78350f', legend: '#7c2d12'
//   }
//   const tierEmojis: Record<string, string> = {
//     explorer: '🌱', builder: '🔨', shipper: '⚡', founder: '🚀', legend: '🏆'
//   }
//   const tierKey = data.tier.toLowerCase()
//   ctx.fillStyle = tierColors[tierKey] || '#1e3a5f'
//   ctx.beginPath()
//   ctx.roundRect(24, 88, 140, 28, 6)
//   ctx.fill()
//   ctx.fillStyle = '#e2e8f0'
//   ctx.font = 'bold 13px sans-serif'
//   const tierEmoji = tierEmojis[tierKey] || '🟦'
//   ctx.fillText(`${tierEmoji} ${data.tier.toUpperCase()}`, 36, 107)
// 
//   // Divider
//   ctx.fillStyle = '#1f2937'
//   ctx.fillRect(24, 132, W - 48, 1)
// 
//   // Score bars
//   const bars = [
//     { label: 'Consistency', value: data.consistency, max: 25 },
//     { label: 'Technical', value: data.technical, max: 25 },
//     { label: 'Builder Focus', value: data.builderFocus, max: 25 },
//     { label: 'Community', value: data.community, max: 25 },
//   ]
// 
//   bars.forEach((bar, i) => {
//     const y = 155 + i * 42
//     const barW = W - 200
// 
//     ctx.fillStyle = '#9ca3af'
//     ctx.font = '13px sans-serif'
//     ctx.fillText(bar.label, 24, y)
// 
//     ctx.fillStyle = '#60a5fa'
//     ctx.font = 'bold 13px sans-serif'
//     ctx.textAlign = 'right'
//     ctx.fillText(`${bar.value}/${bar.max}`, W - 24, y)
//     ctx.textAlign = 'left'
// 
//     // Bar track
//     ctx.fillStyle = '#1f2937'
//     ctx.beginPath()
//     ctx.roundRect(24, y + 6, barW, 10, 5)
//     ctx.fill()
// 
//     // Bar fill
//     const fillW = Math.round((bar.value / bar.max) * barW)
//     ctx.fillStyle = '#3b82f6'
//     ctx.beginPath()
//     ctx.roundRect(24, y + 6, fillW, 10, 5)
//     ctx.fill()
//   })
// 
//   // Summary
//   ctx.fillStyle = '#1f2937'
//   ctx.fillRect(24, H - 80, W - 48, 1)
// 
//   ctx.fillStyle = '#d1d5db'
//   ctx.font = 'italic 12px sans-serif'
//   const words = data.summary.split(' ')
//   let line = '', lineY = H - 55
//   for (const word of words) {
//     const test = line ? `${line} ${word}` : word
//     if (ctx.measureText(test).width > W - 60) {
//       ctx.fillText(line, 24, lineY)
//       line = word
//       lineY += 18
//     } else { line = test }
//   }
//   if (line) ctx.fillText(line, 24, lineY)
// 
//   // Footer
//   ctx.fillStyle = '#374151'
//   ctx.font = '11px sans-serif'
//   ctx.fillText('🟦 Blue Agent · Blocky Studio · blockyagent_bot', 24, H - 12)
// 
//   return canvas.toBuffer('image/png')
// }

// Check if handle has a Bankr agent profile → +10 bonus
async function checkBankrProfileBonus(handle: string): Promise<boolean> {
  try {
    const h = handle.toLowerCase().replace('@', '')
    // 1. Check if handle is twitter of any approved agent
    const listRes = await axios.get(`https://api.bankr.bot/agent-profiles?limit=100`, { timeout: 5000 })
    const profiles = listRes.data?.profiles || []
    const isAgent = profiles.some((a: any) =>
      (a.twitterUsername || '').toLowerCase().replace('@', '') === h
    )
    if (isAgent) return true

    // 2. Check if handle is a team member of Blue Agent specifically
    const detailRes = await axios.get(`https://api.bankr.bot/agent-profiles/blue-agent`, { timeout: 5000 })
    const teamMembers = detailRes.data?.teamMembers || []
    return teamMembers.some((m: any) =>
      (m.links || []).some((l: any) => {
        const url = (l.url || '').toLowerCase()
        return url.includes(`/${h}`) || url.includes(`/@${h}`)
      })
    )
  } catch {
    return false
  }
}

// Recalculate tier from score
function getTier(score: number): string {
  if (score >= 86) return 'Legend'
  if (score >= 71) return 'Founder'
  if (score >= 51) return 'Shipper'
  if (score >= 31) return 'Builder'
  return 'Explorer'
}

// /score — Builder Score from X handle
async function runBuilderScore(chatId: number, handle: string) {
  bot.sendChatAction(chatId, 'typing').catch(() => {})
  const typingInterval = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4000)

  try {
    const prompt = `Score @${handle} as a Base builder (0-100). Check their X posts.
Reply in this format only:
SCORE: X/100
TIER: Explorer|Builder|Shipper|Founder|Legend
Consistency: X/25
Technical: X/25
Builder focus: X/25
Community: X/25
SUMMARY: one sentence`

    // Retry up to 3 times via Bankr Agent (same as production)
    let result = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await askLLM([{role: "user", content: prompt}])
      if (result) break
      console.log(`[Score] Attempt ${attempt} failed, retrying...`)
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000))
    }

    if (result) {
      // Parse score components
      const scoreMatch = result.match(/SCORE:\s*(\d+)\/100/i)
      const tierMatch = result.match(/TIER:\s*(\w+)/i)
      const summaryMatch = result.match(/SUMMARY:\s*(.+)/i)

      let score = scoreMatch ? parseInt(scoreMatch[1]) : null
      const tier = tierMatch ? tierMatch[1] : null
      const summary = summaryMatch ? summaryMatch[1].trim() : null

      // Check Bankr builder profile bonus (+10, max 100)
      const hasBankrProfile = await checkBankrProfileBonus(handle)
      let bankrBonus = 0
      if (hasBankrProfile && score !== null) {
        bankrBonus = Math.min(5, 100 - score)
        score = Math.min(100, score + bankrBonus)
      }

      // Recalculate tier after bonus
      const finalTier = score !== null ? getTier(score) : (tier || 'Explorer')

      const tierEmoji: Record<string, string> = {
        explorer: '🌱', builder: '🔨', shipper: '⚡', founder: '🚀', legend: '🏆'
      }
      const emoji = tierEmoji[finalTier.toLowerCase()] || '🟦'

      // Build output same format as production + bonus line
      const cleanResult = formatAgentReply(result
        .replace(/SCORE:.*\n?/i, '')
        .replace(/TIER:.*\n?/i, '')
        .replace(/SUMMARY:.*\n?/i, '')
        .trim())

      const output = score !== null
        ? `<b>🟦 Builder Score</b>\n` +
          `<b>@${handle}</b>\n` +
          `──────────────\n` +
          `Score: <b>${score}/100</b> ${emoji}\n` +
          `Tier: <b>${finalTier}</b>\n\n` +
          cleanResult +
          (hasBankrProfile ? `\n\n🟦 Bankr builder: <b>+${bankrBonus} bonus</b>` : '') +
          (summary ? `\n\n💡 ${summary}` : '') +
          `\n──────────────\n` +
          `<i>Powered by Blue Agent 🟦 · Blocky Studio</i>`
        : formatAgentReply(result)

      await bot.sendMessage(chatId, output, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      } as any)
    } else {
      await bot.sendMessage(chatId,
        `⚠️ Couldn't score @${handle} right now. Try again in a moment!`,
        { parse_mode: 'HTML' } as any
      )
    }
  } catch (e: any) {
    await bot.sendMessage(chatId, '⚠️ Something went wrong. Try again!')
  } finally {
    clearInterval(typingInterval)
  }
}

bot.onText(/\/score(?:\s+@?(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup'
  const handle = match?.[1]?.replace('@', '')

  // GROUP — /score disabled, redirect to /points
  if (isGroup) {
    await bot.sendMessage(chatId,
      `Use /points to see your rank 🟦`,
      { reply_to_message_id: msg.message_id } as any
    )
    return
  }

  // DM MODE — full detail only
  if (!handle) {
    await bot.sendMessage(chatId,
      `<b>Builder Score 🟦</b>\n\nUsage: <code>/score @handle</code>\n\nExample: <code>/score jessepollak</code>`,
      { parse_mode: 'HTML' } as any
    )
    return
  }
  await runBuilderScore(chatId, handle)
})

// /news — public X builder feed
bot.onText(/\/news/, async (msg) => {
  const chatId = msg.chat.id
  bot.sendChatAction(chatId, 'typing').catch(() => {})
  const typingInterval = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4000)

  try {
    // Use LLM with web search context instead of slow Agent
    // Use top accounts for /news — focused list for speed
    const TOP_ACCOUNTS = '@jessepollak, @base, @buildonbase, @bankrbot, @virtuals_io, @coinbase, @brian_armstrong'
    const xPrompt = `Latest updates from Base builders today. Check: ${TOP_ACCOUNTS}. Show all notable updates, one line each. End with one key insight about the trend.`
    let result = await askLLM([{role: "user", content: xPrompt}])

    // Fallback to LLM if Agent too slow
    if (!result) {
      result = await askLLM([{ role: 'user', content: `Latest updates from Base builders today: ${TOP_ACCOUNTS}. List top 5 highlights, one line each.` }])
    }

    if (result) {
      const now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const formatted = formatAgentReply(result)

      const output =
        `<b>📡 Base Builder Feed</b>\n` +
        `<i>${now} · tracked by Blue Agent 🟦</i>\n` +
        `─────────────────\n\n` +
        formatted +
        `\n\n─────────────────\n` +
        `<i>Follow @blocky_agent for daily updates</i>`

      await bot.sendMessage(chatId, output, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      } as any)
    } else {
      await bot.sendMessage(chatId,
        '⚠️ Couldn\'t fetch builder updates right now.\nTry again in a moment!',
        { parse_mode: 'HTML' } as any
      )
    }
  } catch (e: any) {
    await bot.sendMessage(chatId, '⚠️ Something went wrong. Try again!')
  } finally {
    clearInterval(typingInterval)
  }
})

// =======================
// V2.0 COMMAND HANDLERS
// =======================

const MENU_TEXT = `🟦 <b>Blue Agent</b> — Control Panel\n\nWhat do you need?`

const MENU_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📰 News', callback_data: 'menu_news' }, { text: '🔍 Score', callback_data: 'menu_score' }, { text: '🚀 Launch', callback_data: 'menu_launch' }],
    [{ text: '🎁 Rewards', callback_data: 'menu_rewards' }, { text: '🔗 Refer', callback_data: 'menu_refer' }, { text: '🏆 Top', callback_data: 'menu_leaderboard' }],
    [{ text: '💰 Wallet', callback_data: 'menu_wallet' }, { text: '📝 Submit', callback_data: 'menu_submit' }, { text: '📁 Projects', callback_data: 'menu_projects' }],
    [{ text: '👤 Profile', callback_data: 'menu_profile' }, { text: '❓ Help', callback_data: 'menu_help' }, { text: '❌ Close', callback_data: 'menu_close' }],
  ]
}

// Build profile text for a user
function buildProfileText(user: User, rank: number, projectCount: number): string {
  const wallet = user.evmAddress
    ? `💳 <code>${user.evmAddress.slice(0, 6)}...${user.evmAddress.slice(-4)}</code>`
    : '💳 No wallet connected'
  const xHandle = user.xHandle ? `🐦 @${user.xHandle.replace('@', '')}` : '🐦 No X handle set'
  const points = user.points || 0
  const referrals = 0 // loaded separately
  return (
    `<b>👤 My Profile</b>\n` +
    `──────────────\n` +
    `${wallet}\n` +
    `${xHandle}\n` +
    `──────────────\n` +
    `⭐ Points: <b>${points}</b>\n` +
    `📝 Projects: <b>${projectCount}</b>\n` +
    `🏆 Rank: <b>#${rank}</b>\n` +
    `──────────────\n` +
    `<i>Joined: ${user.joinedAt ? new Date(user.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}</i>`
  )
}

// Back + Close row to append to any sub-menu
const NAV_ROW = [{ text: '← Back', callback_data: 'nav_back' }, { text: '❌ Close', callback_data: 'menu_close' }]

// Edit existing message with new content (clean, no spam)
async function editMenu(query: any, text: string, keyboard: any) {
  try {
    await bot.editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: keyboard
    } as any)
  } catch {
    // If can't edit (too old), send new message
    await bot.sendMessage(query.message.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    } as any)
  }
}

bot.onText(/\/menu/, async (msg) => {
  const chatId = msg.chat.id
  await bot.sendMessage(chatId,
    `🟦 <b>Blue Agent</b> — Control Panel\n\nWhat do you need?`,
    { parse_mode: 'HTML', reply_markup: MENU_KEYBOARD } as any
  )
})

const WALLET_KEYBOARD = {
  inline_keyboard: [
    [{ text: '💱 Swap', callback_data: 'wallet_swap' }, { text: '📤 Send', callback_data: 'wallet_send' }, { text: '📊 Portfolio', callback_data: 'wallet_portfolio' }],
    [{ text: '🔄 DCA', callback_data: 'wallet_dca' }, { text: '📈 Limit Order', callback_data: 'wallet_limit' }, { text: '🔴 Stop Loss', callback_data: 'wallet_stoploss' }],
    [{ text: '🖼️ NFTs', callback_data: 'wallet_nfts' }, { text: '🎯 Polymarket', callback_data: 'wallet_polymarket' }, { text: '🔀 Bridge', callback_data: 'wallet_bridge' }],
    [{ text: '📋 My Tokens', callback_data: 'wallet_tokens' }],
  ]
}

bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const users = loadUsers()
  const user = users[userId] || { id: userId, points: 0, joinedAt: Date.now() }

  // Calc rank by points
  const sorted = Object.values(users).sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
  const rank = sorted.findIndex((u: any) => u.id === userId) + 1 || sorted.length + 1

  // Count user projects
  const projectCount = loadProjects().filter(p => p.submitterId === userId).length

  const profileText = buildProfileText(user, rank, projectCount)
  const hasWallet = user.walletConnected && user.bankrApiToken
  const points = user.points || 0
  const canClaim = points >= 100

  await bot.sendMessage(chatId, profileText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: user.xHandle ? '✏️ Edit X Handle' : '🐦 Set X Handle', callback_data: 'profile_set_x' },
          { text: hasWallet ? '💳 Wallet ✅' : '💳 Connect Wallet', callback_data: 'menu_wallet' }
        ],
        [{ text: canClaim ? `🎁 Claim ${TOKEN_NAME} (${points} pts)` : `🎁 Claim (need 100 pts)`, callback_data: canClaim ? 'profile_claim' : 'profile_claim_locked' }],
      ]
    }
  } as any)
})

bot.onText(/\/wallet/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const users2 = loadUsers()
  const user2 = users2[userId]
  const connected = user2?.walletConnected && user2?.bankrApiToken
  const statusLine = connected
    ? `<b>👛 Wallet &amp; Trade</b>\n✅ Wallet connected\n<i>Powered by Bankr 🟦</i>`
    : `<b>👛 Wallet &amp; Trade</b>\n⚠️ No wallet yet — connect to use actions\n<i>Powered by Bankr 🟦</i>`
  await bot.sendMessage(chatId, statusLine, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        ...WALLET_KEYBOARD.inline_keyboard,
      ]
    }
  } as any)
})

bot.onText(/\/rewards/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const users = loadUsers()
  const user = users[userId] || {}
  const points = user.points || 0
  const referrals = loadReferrals().filter(r => r.referrerId === userId).length

  await bot.sendMessage(chatId,
    `<b>🎁 Rewards Hub</b>\n\n` +
    `⭐ Your Points: <b>${points}</b>\n` +
    `👥 Referrals made: <b>${referrals}</b>\n\n` +
    `<b>How to earn points:</b>\n` +
    `• Refer a friend → +50 pts\n` +
    `• Submit a project → +20 pts\n` +
    `• Top 10 leaderboard → +100 pts\n\n` +
    `<b>Score Tiers:</b>\n` +
    `🔵 Explorer: 0–30\n` +
    `🟢 Builder: 31–50\n` +
    `🟡 Shipper: 51–70\n` +
    `🟠 Founder: 71–85\n` +
    `🔴 Legend: 86–100`,
    { parse_mode: 'HTML' } as any
  )
})

bot.onText(/\/refer/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const referrals = loadReferrals().filter(r => r.referrerId === userId)
  const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`

  await bot.sendMessage(chatId,
    `<b>👥 Referral System</b>\n\n` +
    `Your referral link:\n<code>${refLink}</code>\n\n` +
    `📊 <b>Your Stats:</b>\n` +
    `• Total referrals: <b>${referrals.length}</b>\n` +
    `• Points earned: <b>${referrals.length * 50}</b>\n\n` +
    `Share your link and earn <b>50 points</b> per referral! 🎉`,
    { parse_mode: 'HTML' } as any
  )
})

// /points — DM (private detail) + Group (public card)
bot.onText(/\/points/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup'
  if (!userId) return

  const users = loadUsers()
  const user = users[userId]
  const pts = user?.points || 0
  const allSorted = Object.values(users).sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
  const rank = allSorted.findIndex((u: any) => u.id === userId) + 1
  const rankStr = rank > 0 ? `#${rank}` : 'Unranked'
  const name = user?.xHandle ? `@${user.xHandle}` : user?.telegramUsername ? `@${user.telegramUsername}` : msg.from?.first_name || 'Builder'

  if (isGroup) {
    // Public card
    const claimable = Math.floor(pts / 100)
    await bot.sendMessage(chatId,
      `🟦 <b>${name}</b>\n\n` +
      `⭐ <b>${pts} pts</b>  ·  🏆 Rank ${rankStr}\n` +
      (claimable > 0 ? `💎 ${claimable} $BLUEAGENT claimable\n` : '') +
      `\n<i>Earn more → gm daily, /submit, vote, refer</i>`,
      { parse_mode: 'HTML', reply_to_message_id: msg.message_id } as any
    )
  } else {
    // Full detail in DM
    const claimable = Math.floor(pts / 100)
    await bot.sendMessage(chatId,
      `<b>⭐ Your Points</b>\n\n` +
      `Name: <b>${name}</b>\n` +
      `Points: <b>${pts} pts</b>\n` +
      `Rank: <b>${rankStr}</b>\n\n` +
      `<b>How to earn:</b>\n` +
      `• gm daily → +5 pts\n` +
      `• /submit project → +20 pts\n` +
      `• Vote project → +2 pts\n` +
      `• Refer a builder → +15 pts\n` +
      `• Referred by someone → +5 pts\n\n` +
      `<b>Claim:</b>\n` +
      `100 pts = 1 $BLUEAGENT\n` +
      `Claimable: <b>${claimable} $BLUEAGENT</b>\n\n` +
      `<i>Use /rewards to claim · /leaderboard to see top builders</i>`,
      { parse_mode: 'HTML' } as any
    )
  }
})

// /leaderboard — DM + Group (public)
bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup'
  const users = loadUsers()
  const sorted = Object.values(users)
    .filter((u: any) => (u.points || 0) > 0)
    .sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
    .slice(0, 10)

  const medals = ['🥇', '🥈', '🥉']
  const lines = sorted.map((u: any, i: number) => {
    const medal = medals[i] || `${i + 1}.`
    const name = u.xHandle ? `@${u.xHandle}` : u.telegramUsername ? `@${u.telegramUsername}` : u.telegramName || 'Builder'
    const isMe = u.id === userId
    return `${medal} ${name} — <b>${u.points || 0} pts</b>${isMe ? ' 👈' : ''}`
  })

  const myPoints = users[userId]?.points || 0
  const myRank = Object.values(users).sort((a: any, b: any) => (b.points || 0) - (a.points || 0)).findIndex((u: any) => u.id === userId) + 1

  const footer = isGroup
    ? `\n\n<i>DM <a href="https://t.me/Blockyagent_beta_bot">@Blockyagent_beta_bot</a> to earn points</i>`
    : `\n\n──────────────\nYou: <b>#${myRank || '—'} · ${myPoints} pts</b>`

  await bot.sendMessage(chatId,
    `<b>🏆 Top Builders</b>\n\n` +
    (lines.length ? lines.join('\n') : 'No points yet. Be the first!') +
    footer,
    {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(isGroup ? { reply_to_message_id: msg.message_id } : {})
    } as any
  )
})

bot.onText(/\/submit/, async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  submitSessions.set(userId, { step: 1 })
  startSessionTimer(userId, chatId)
  await bot.sendMessage(chatId,
    `<b>📝 Submit Your Project</b>\n\nStep 1/4: What is your project name?`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_session' }]] }
    } as any
  )
})

bot.onText(/\/projects/, async (msg) => {
  const chatId = msg.chat.id
  const projects = loadProjects()

  if (!projects.length) {
    await bot.sendMessage(chatId, '📁 No projects yet. Be the first to /submit!')
    return
  }

  for (const proj of projects.slice(0, 5)) {
    const submitter = proj.submitterUsername ? `@${proj.submitterUsername}` : 'Anonymous'
    await bot.sendMessage(chatId,
      `<b>${proj.name}</b>\n${proj.description}\n🔗 ${proj.url}\n👤 by ${submitter} | 👍 ${proj.votes} votes`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: `👍 Vote (${proj.votes})`, callback_data: `vote_${proj.id}` }]] }
      } as any
    )
  }
})

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id
  bot.sendChatAction(chatId, 'typing').catch(() => {})

  try {
    const res = await axios.get('https://api.bankr.bot/agent/profile', {
      headers: { 'x-api-key': BANKR_API_KEY },
      timeout: 8000
    })
    const d = res.data

    const mcap = d.marketCapUsd
      ? `$${Number(d.marketCapUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : 'N/A'
    const rev = d.weeklyRevenueWeth
      ? `${parseFloat(d.weeklyRevenueWeth).toFixed(4)} ETH`
      : 'N/A'
    const token = d.tokenSymbol ? `$${d.tokenSymbol.toUpperCase()}` : '$BLUEAGENT'
    const products = (d.products || []).map((p: any) => `• ${p.name}`).join('\n')
    const team = (d.teamMembers || []).map((m: any) => `• ${m.name} — ${m.role}`).join('\n')
    const latestUpdate = d.projectUpdates?.[0]

    await bot.sendMessage(chatId,
      `<b>📈 ${d.projectName || 'Blue Agent'}</b>\n` +
      `<i>${d.description || ''}</i>\n` +
      `──────────────\n` +
      `💎 Token: <b>${token}</b>\n` +
      `📊 MCap: <b>${mcap}</b>\n` +
      `💰 Weekly Revenue: <b>${rev}</b>\n` +
      `──────────────\n` +
      `🛠 Products:\n${products}\n` +
      `──────────────\n` +
      `👥 Team:\n${team}\n` +
      (latestUpdate ? `──────────────\n📣 Latest: <b>${latestUpdate.title}</b>\n<i>${latestUpdate.content.slice(0, 120)}...</i>\n` : '') +
      `──────────────\n` +
      `<i>Powered by Bankr 🟦 · bankr.bot/agents/blue-agent</i>`,
      { parse_mode: 'HTML', disable_web_page_preview: true } as any
    )
  } catch {
    await bot.sendMessage(chatId, '⚠️ Could not fetch stats. Try again!')
  }
})

bot.onText(/\/agents(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id
  const sort = match?.[1]?.trim() || 'mcap'
  await sendAgentsLeaderboard(chatId, sort)
})

// =======================
// CALLBACK QUERY HANDLER (for inline buttons)
// =======================
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id
  const data = query.data
  if (!chatId || !data) return
  await bot.answerCallbackQuery(query.id).catch(() => {})

  const userId = query.from?.id || 0

  if (data === 'noop') { return }

  // ── Admin callbacks (owner only) ──
  if (data.startsWith('admin_')) {
    if (userId !== OWNER_ID) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ Admin only', show_alert: true })
      return
    }

    if (data.startsWith('admin_approve_')) {
      const projId = data.replace('admin_approve_', '')
      await adminApproveProject(chatId, projId)
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id } as any).catch(() => {})
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved!' })
      return
    }

    if (data.startsWith('admin_reject_')) {
      const projId = data.replace('admin_reject_', '')
      await adminRejectProject(chatId, projId)
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id } as any).catch(() => {})
      await bot.answerCallbackQuery(query.id, { text: '❌ Rejected' })
      return
    }

    if (data.startsWith('admin_delete_')) {
      const projId = data.replace('admin_delete_', '')
      const allProjects = loadProjects()
      const idx = allProjects.findIndex(p => p.id === projId)
      if (idx === -1) { await bot.answerCallbackQuery(query.id, { text: '❌ Not found', show_alert: true }); return }
      const name = allProjects[idx].name
      allProjects.splice(idx, 1)
      saveProjects(allProjects)
      await bot.editMessageText(`🗑️ <b>Deleted:</b> ${name}`, { chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'HTML' } as any).catch(() => {})
      await bot.answerCallbackQuery(query.id, { text: '🗑️ Deleted' })
      return
    }

    if (data === 'admin_list_pending') {
      const pendingProjects = loadProjects().filter(p => !p.approved)
      if (!pendingProjects.length) { await bot.answerCallbackQuery(query.id, { text: '✅ No pending projects', show_alert: true }); return }
      await bot.answerCallbackQuery(query.id)
      await bot.sendMessage(chatId, `📋 <b>Pending Projects (${pendingProjects.length})</b>`, { parse_mode: 'HTML' } as any)
      for (const p of pendingProjects) {
        const submitter = p.submitterUsername ? `@${p.submitterUsername}` : `ID:${p.submitterId}`
        await bot.sendMessage(chatId,
          `📝 <b>${p.name}</b>\n${p.description}\n🔗 ${p.url}\n👤 ${submitter}`,
          { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `admin_approve_${p.id}` }, { text: '❌ Reject', callback_data: `admin_reject_${p.id}` }]] } } as any
        )
      }
      return
    }

    if (data === 'admin_list_all') {
      const allProjects = loadProjects()
      await bot.answerCallbackQuery(query.id)
      if (!allProjects.length) { await bot.sendMessage(chatId, '📭 No projects yet.'); return }
      await bot.sendMessage(chatId, `📁 <b>All Projects (${allProjects.length})</b>`, { parse_mode: 'HTML' } as any)
      for (const p of allProjects) {
        const status = p.approved ? '✅' : '⏳'
        const submitter = p.submitterUsername ? `@${p.submitterUsername}` : `ID:${p.submitterId}`
        const buttons = p.approved
          ? [[{ text: '🗑️ Delete', callback_data: `admin_delete_${p.id}` }]]
          : [[{ text: '✅ Approve', callback_data: `admin_approve_${p.id}` }, { text: '❌ Reject', callback_data: `admin_reject_${p.id}` }]]
        await bot.sendMessage(chatId,
          `${status} <b>${p.name}</b>\n👤 ${submitter}\n🔗 ${p.url}`,
          { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons } } as any
        )
      }
      return
    }

    if (data === 'admin_list_users') {
      const allUsers = loadUsers()
      const sorted = Object.values(allUsers).sort((a: any, b: any) => (b.points || 0) - (a.points || 0)).slice(0, 15)
      const lines = sorted.map((u: any, i: number) => {
        const name = u.telegramUsername ? `@${u.telegramUsername}` : u.telegramName || `ID:${u.id}`
        return `${i + 1}. ${name} — <b>${u.points || 0} pts</b> · 🔥${u.checkinStreak || 0}d`
      })
      await bot.answerCallbackQuery(query.id)
      await bot.sendMessage(chatId,
        `👥 <b>Users (${Object.keys(allUsers).length} total)</b>\n\n` + lines.join('\n'),
        { parse_mode: 'HTML' } as any
      )
      return
    }

    await bot.answerCallbackQuery(query.id)
    return
  }

  // Any button press clears active sessions  // Any button press clears active sessions (user navigated away)
  const sessionBreakers = ['menu_', 'wallet_', 'menu_back', 'menu_close', 'cancel_session', 'nav_back', 'nav_']
  if (sessionBreakers.some(prefix => data.startsWith(prefix))) {
    clearSessionTimer(userId)
    walletSessions.delete(userId)
    submitSessions.delete(userId)
    launchSessions.delete(userId)
    xHandleSessions.delete(userId)
  }

  if (data === 'cancel_session') {
    await bot.editMessageText('❌ Cancelled.', {
      chat_id: chatId,
      message_id: query.message?.message_id,
    } as any).catch(() => {})
    return
  }

  // Close — delete the menu message
  if (data === 'menu_close') {
    try { await bot.deleteMessage(chatId, query.message?.message_id!) } catch {}
    return
  }

  // Back — return to main menu
  if (data === 'nav_back') {
    await editMenu(query, MENU_TEXT, MENU_KEYBOARD)
    return
  }

  // Open menu from /start button
  if (data === 'open_menu') {
    await bot.sendMessage(chatId, MENU_TEXT, { parse_mode: 'HTML', reply_markup: MENU_KEYBOARD } as any)
    return
  }

  // MENU callbacks — execute directly
  // PROFILE callbacks
  if (data === 'menu_profile') {
    const users2 = loadUsers()
    const user2 = users2[userId] || { id: userId, points: 0, joinedAt: Date.now() }
    const sorted2 = Object.values(users2).sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
    const rank2 = sorted2.findIndex((u: any) => u.id === userId) + 1 || sorted2.length + 1
    const projectCount2 = loadProjects().filter(p => p.submitterId === userId).length
    const profileText2 = buildProfileText(user2, rank2, projectCount2)
    const hasWallet2 = user2.walletConnected && user2.bankrApiToken
    const points2 = user2.points || 0
    const canClaim2 = points2 >= 100
    await editMenu(query, profileText2, {
      inline_keyboard: [
        [
          { text: user2.xHandle ? '✏️ Edit X Handle' : '🐦 Set X Handle', callback_data: 'profile_set_x' },
          { text: hasWallet2 ? '💳 Wallet ✅' : '💳 Connect Wallet', callback_data: 'menu_wallet' }
        ],
        [{ text: canClaim2 ? `🎁 Claim ${TOKEN_NAME} (${points2} pts)` : `🎁 Claim (need 100 pts)`, callback_data: canClaim2 ? 'profile_claim' : 'profile_claim_locked' }],
        NAV_ROW
      ]
    })
    return
  }
  if (data === 'profile_set_x') {
    xHandleSessions.set(userId, true)
    await editMenu(query,
      `<b>🐦 Set X Handle</b>\n\nEnter your X/Twitter handle:\n<i>(e.g. madebyshun)</i>`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }
  if (data === 'profile_claim_locked') {
    await bot.answerCallbackQuery(query.id, { text: '⚠️ Cần ít nhất 100 pts để claim!', show_alert: true })
    return
  }
  if (data === 'profile_claim') {
    const users2 = loadUsers()
    const user2 = users2[userId]
    const points2 = user2?.points || 0
    const streak2 = user2?.checkinStreak || 0
    const lastClaim = user2?.lastClaim || 0
    const now = Date.now()
    const cooldownMs = 7 * 24 * 60 * 60 * 1000 // 7 ngày
    const cooldownLeft = lastClaim + cooldownMs - now

    // Check cooldown
    if (lastClaim > 0 && cooldownLeft > 0) {
      const daysLeft = Math.ceil(cooldownLeft / 86400000)
      await bot.answerCallbackQuery(query.id, { text: `⏳ Cooldown! Còn ${daysLeft} ngày nữa mới claim được.`, show_alert: true })
      return
    }

    // Check min points
    if (points2 < 100) {
      await bot.answerCallbackQuery(query.id, { text: '⚠️ Cần ít nhất 100 pts để claim!', show_alert: true })
      return
    }

    // Calculate multiplier by streak
    let multiplier = 1
    let multiplierLabel = 'x1'
    if (streak2 >= 14) { multiplier = 2; multiplierLabel = 'x2 🔥🔥' }
    else if (streak2 >= 7) { multiplier = 1.5; multiplierLabel = 'x1.5 🔥' }

    const TOKENS_PER_PT = CFG.token.tokens_per_point
    const claimAmount = Math.floor(points2 * multiplier * TOKENS_PER_PT)

    // Save claim — reset points, keep streak, set lastClaim
    users2[userId].points = 0
    users2[userId].claimedPoints = (user2.claimedPoints || 0) + claimAmount
    users2[userId].lastClaim = now
    saveUsers(users2)

    await editMenu(query,
      `<b>🎁 Claim ${TOKEN_NAME}</b>\n` +
      `──────────────\n` +
      `⭐ Points: <b>${points2} pts</b>\n` +
      `🔥 Streak: <b>${streak2} ngày</b> → ${multiplierLabel}\n` +
      `──────────────\n` +
      `💰 Claim amount: <b>${claimAmount.toLocaleString()} ${TOKEN_NAME}</b>\n` +
      `──────────────\n` +
      `⏳ <i>Onchain transfer đang được xử lý...</i>\n` +
      `Sẽ gửi về: <code>${user2.evmAddress?.slice(0, 6)}...${user2.evmAddress?.slice(-4)}</code>\n\n` +
      `<i>Claim tiếp theo sau 7 ngày 🟦</i>`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }

  if (data === 'menu_score') {
    scoreSessions.set(userId, true)
    await editMenu(query,
      `<b>📊 Builder Score</b>\n\nEnter your X/Twitter handle:\n<i>(e.g. jessepollak or @jessepollak)</i>`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }
  if (data === 'menu_wallet') {
    const users2 = loadUsers()
    const user2 = users2[userId]
    const addr = user2?.evmAddress
    const shortAddr = addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '—'
    const statusLine = addr
      ? `<b>👛 Wallet của bạn</b>\n🟦 <code>${addr}</code>\n<i>Powered by Bankr · Base network</i>`
      : `<b>👛 Wallet &amp; Trade</b>\n⚠️ No wallet — restart bot to create\n<i>Powered by Bankr 🟦</i>`
    const walletKeyboard = {
      inline_keyboard: [
        [{ text: '💱 Swap', callback_data: 'wallet_swap' }, { text: '📤 Send', callback_data: 'wallet_send' }, { text: '📊 Portfolio', callback_data: 'wallet_portfolio' }],
        [{ text: '🔄 DCA', callback_data: 'wallet_dca' }, { text: '📈 Limit Order', callback_data: 'wallet_limit' }, { text: '🔴 Stop Loss', callback_data: 'wallet_stoploss' }],
        [{ text: '🖼️ NFTs', callback_data: 'wallet_nfts' }, { text: '🎯 Polymarket', callback_data: 'wallet_polymarket' }, { text: '🔀 Bridge', callback_data: 'wallet_bridge' }],
        [{ text: '📋 My Tokens', callback_data: 'wallet_tokens' }],
        NAV_ROW
      ]
    }
    await editMenu(query, statusLine, walletKeyboard)
    return
  }
  if (data === 'menu_rewards') {
    const users2 = loadUsers()
    const user2 = users2[userId] || {}
    const points = user2.points || 0
    const streak = user2.checkinStreak || 0
    const refCount = loadReferrals().filter(r => r.referrerId === userId).length
    const projCount = loadProjects().filter(p => p.submitterId === userId).length
    const projVotes = loadProjects().filter(p => p.submitterId === userId).reduce((sum, p) => sum + p.votes, 0)
    const lastClaim = user2.lastClaim || 0
    const cooldownMs = 7 * 24 * 60 * 60 * 1000
    const inCooldown = lastClaim > 0 && (Date.now() - lastClaim) < cooldownMs
    const daysLeft = inCooldown ? Math.ceil((lastClaim + cooldownMs - Date.now()) / 86400000) : 0
    const canClaim = points >= 100 && !inCooldown

    // Streak multiplier
    let multiplier = 1, multiplierLabel = 'x1'
    if (streak >= 14) { multiplier = 2; multiplierLabel = 'x2 🔥🔥' }
    else if (streak >= 7) { multiplier = 1.5; multiplierLabel = 'x1.5 🔥' }
    const TOKENS_PER_PT_PREVIEW = CFG.token.tokens_per_point
    const claimPreview = Math.floor(points * multiplier * TOKENS_PER_PT_PREVIEW)

    const streakLine = streak > 0
      ? `• Check-in streak: 🔥 <b>${streak} ngày</b>${streak >= 7 ? ' (+10 pts/ngày)' : ' (+5 pts/ngày)'}\n`
      : `• Check-in: chưa có — /start mỗi ngày để earn pts\n`

    await editMenu(query,
      `<b>🎁 Rewards Hub</b>\n` +
      `──────────────\n` +
      `⭐ Total Points: <b>${points}</b>\n` +
      (inCooldown ? `⏳ Cooldown: còn <b>${daysLeft} ngày</b>\n` :
        canClaim ? `✅ Đủ điều kiện claim! → <b>${claimPreview} $BLUEAGENT</b> (${multiplierLabel})\n` :
        `⏳ Cần thêm <b>${100 - points} pts</b> để claim\n`) +
      `──────────────\n` +
      `<b>📊 Cách earn points:</b>\n` +
      streakLine +
      `• Referrals (${refCount}x): +${refCount * 50} pts\n` +
      `• Projects submitted (${projCount}x): +${projCount * 20} pts\n` +
      `• Votes received (${projVotes}x): +${projVotes * 2} pts\n` +
      `──────────────\n` +
      `<b>🔑 Earn thêm:</b>\n` +
      `• /start mỗi ngày → +5 pts (streak 7d → +10)\n` +
      `• Refer builder → +50 pts\n` +
      `• Submit project → +20 pts\n` +
      `• Được vote → +2 pts/vote\n` +
      `──────────────\n` +
      `<b>💎 Streak multiplier:</b>\n` +
      `• 1–6 ngày → x1\n` +
      `• 7–13 ngày → x1.5 🔥\n` +
      `• 14+ ngày → x2 🔥🔥\n` +
      `──────────────\n` +
      `<i>100 pts + 7 ngày cooldown = claim ${TOKEN_NAME} 🟦</i>`,
      {
        inline_keyboard: [
          [{ text: inCooldown ? `⏳ Cooldown (${daysLeft}d)` : canClaim ? `🎁 Claim ${claimPreview} ${TOKEN_NAME}` : `🎁 Claim (${points}/100 pts)`, callback_data: inCooldown ? 'profile_claim_locked' : canClaim ? 'profile_claim' : 'profile_claim_locked' }],
          NAV_ROW
        ]
      }
    )
    return
  }
  if (data === 'menu_refer') {
    const refCount = loadReferrals().filter(r => r.referrerId === userId).length
    const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`
    await editMenu(query,
      `<b>👥 Referral System</b>\n\nYour referral link:\n<code>${refLink}</code>\n\n📊 <b>Your Stats:</b>\n• Total referrals: <b>${refCount}</b>\n• Points earned: <b>${refCount * 50}</b>\n\nShare your link and earn <b>50 points</b> per referral! 🎉`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }
  if (data === 'menu_leaderboard') {
    const users2 = loadUsers()
    const allSorted = Object.values(users2).sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
    const top10 = allSorted.slice(0, 10)
    const medals = ['🥇', '🥈', '🥉']
    const userRank = allSorted.findIndex((u: any) => u.id === userId) + 1
    const lines = top10.map((u: any, i: number) => {
      const medal = medals[i] || `${i + 1}.`
      const name = u.xHandle ? `@${u.xHandle}` : u.telegramUsername ? `@${u.telegramUsername}` : u.telegramName || `Builder`
      const isMe = u.id === userId ? ' 👈' : ''
      return `${medal} ${name} — <b>${u.points || 0} pts</b>${isMe}`
    })
    const myPoints = users2[userId]?.points || 0
    await editMenu(query,
      `<b>🏆 Top Builders</b>\n` +
      `──────────────\n` +
      (lines.length ? lines.join('\n') : 'No points yet. Be the first!') +
      `\n──────────────\n` +
      `You: <b>#${userRank || '—'} · ${myPoints} pts</b>\n\n` +
      `<i>Earn pts: refer (+50), submit (+20), get voted (+2)</i>`,
      {
        inline_keyboard: [
          [{ text: '🔗 Refer & Earn', callback_data: 'menu_refer' }, { text: '📝 Submit Project', callback_data: 'menu_submit' }],
          NAV_ROW
        ]
      }
    )
    return
  }
  if (data === 'menu_submit') {
    submitSessions.set(userId, { step: 1 })
    await editMenu(query,
      `<b>📝 Submit Your Project</b>\n\n` +
      `Share what you're building on Base!\n` +
      `+20 pts when submitted ⭐\n\n` +
      `Step 1/4: What is your <b>project name</b>?`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }
  if (data === 'menu_projects' || data === 'projects_newest' || data === 'projects_top' || data === 'projects_mine') {
    const projects2 = loadProjects()
    if (!projects2.length) {
      await editMenu(query,
        `<b>📁 Builder Directory</b>\n\nNo projects yet. Be the first to build!`,
        { inline_keyboard: [[{ text: '📝 Submit Project', callback_data: 'menu_submit' }], NAV_ROW] }
      )
      return
    }
    // Sort projects — chỉ show approved, trừ "Mine" (show cả pending của chính mình)
    let sorted2 = [...projects2]
    let sortLabel = '🆕 Newest'
    if (data === 'projects_top') {
      sorted2 = sorted2.filter(p => p.approved).sort((a, b) => b.votes - a.votes)
      sortLabel = '🔥 Most Voted'
    } else if (data === 'projects_mine') {
      sorted2 = sorted2.filter(p => p.submitterId === userId) // show cả pending của mình
      sortLabel = '👤 My Projects'
    } else {
      sorted2 = sorted2.filter(p => p.approved).sort((a, b) => b.timestamp - a.timestamp)
    }

    await editMenu(query,
      `<b>📁 Builder Directory</b>\n${sortLabel} · ${sorted2.length} project${sorted2.length !== 1 ? 's' : ''}`,
      {
        inline_keyboard: [
          [{ text: '🆕 Newest', callback_data: 'projects_newest' }, { text: '🔥 Most Voted', callback_data: 'projects_top' }, { text: '👤 Mine', callback_data: 'projects_mine' }],
          NAV_ROW
        ]
      }
    )
    // Send project cards separately
    for (const proj of sorted2.slice(0, 5)) {
      const submitter = proj.submitterUsername ? `@${proj.submitterUsername}` : 'Anonymous'
      const alreadyVoted = proj.voters.includes(userId)
      const pendingLabel = !proj.approved ? '\n⏳ <i>Pending review by admin</i>' : ''
      await bot.sendMessage(chatId,
        `<b>${proj.name}</b>${pendingLabel}\n${proj.description}\n🔗 ${proj.url}\n👤 ${submitter} | 👍 ${proj.votes}`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[
            { text: alreadyVoted ? `✅ Voted (${proj.votes})` : `👍 Vote (${proj.votes})`, callback_data: alreadyVoted ? 'noop' : `vote_${proj.id}` }
          ]]}
        } as any
      )
    }
    return
  }
  if (data === 'menu_agents') { await sendAgentsLeaderboard(chatId, 'mcap'); return }
  if (data === 'menu_news') {
    await editMenu(query, `<b>📡 Base Builder Feed</b>\n\n⏳ Fetching latest updates...`, { inline_keyboard: [NAV_ROW] })
    bot.sendChatAction(chatId, 'typing').catch(() => {})
    const typingInterval2 = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4000)
    try {
      const TOP_ACCOUNTS = '@jessepollak, @base, @buildonbase, @bankrbot, @virtuals_io, @coinbase, @brian_armstrong'
      const xPrompt = `Latest updates from Base builders today. Check: ${TOP_ACCOUNTS}. Show all notable updates, one line each. End with one key insight about the trend.`
      let result = await askLLM([{role: "user", content: xPrompt}])
      if (!result) result = await askLLM([{ role: 'user', content: `Latest updates from Base builders today: ${TOP_ACCOUNTS}. List top 5 highlights, one line each.` }])
      if (result) {
        const now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const output = `<b>📡 Base Builder Feed</b>\n<i>${now} · tracked by Blue Agent 🟦</i>\n─────────────────\n\n${formatAgentReply(result)}\n\n─────────────────\n<i>Follow @blocky_agent for daily updates</i>`
        await bot.sendMessage(chatId, output, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [NAV_ROW] } } as any)
      } else {
        await bot.sendMessage(chatId, '⚠️ Couldn\'t fetch updates. Try again!', { reply_markup: { inline_keyboard: [NAV_ROW] } } as any)
      }
    } catch { await bot.sendMessage(chatId, '⚠️ Something went wrong. Try again!') }
    finally { clearInterval(typingInterval2) }
    return
  }
  if (data === 'menu_help') {
    await editMenu(query,
      `<b>Blue Agent 🟦 — What I can do</b>\n\n` +
      `📊 <b>Market Data</b>\n• "ETH price?" / "$BLUEAGENT price?"\n• "What's trending on Base?"\n\n` +
      `💱 <b>Trading</b>\n• "Swap 10 USDC to ETH"\n• "Buy $BLUEAGENT"\n\n` +
      `🔍 <b>Builders</b>\n• "Who's building AI agents on Base?"\n• "Latest from @jessepollak"\n\n` +
      `<b>Commands:</b> /score /news /launch /wallet /refer /leaderboard /submit /projects /stats /agents\n\n` +
      `<i>No commands needed — just chat!</i>`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }
  if (data === 'menu_launch') {
    launchSessions.set(userId, { step: 'name' })
    await editMenu(query,
      `🚀 <b>Token Launch Wizard</b>\n\nI'll walk you through deploying a new token on Base.\n\n📌 Enter your <b>token name</b> (e.g. Blue Agent):`,
      { inline_keyboard: [NAV_ROW] }
    )
    return
  }

  // AGENTS sort callbacks
  if (data === 'agents_mcap') { await sendAgentsLeaderboard(chatId, 'mcap'); return }
  if (data === 'agents_revenue') { await sendAgentsLeaderboard(chatId, 'revenue'); return }
  if (data === 'agents_newest') { await sendAgentsLeaderboard(chatId, 'newest'); return }

  // VOTE callbacks
  if (data.startsWith('vote_')) {
    const projId = data.replace('vote_', '')
    const projects = loadProjects()
    const proj = projects.find(p => p.id === projId)
    if (!proj) { await bot.answerCallbackQuery(query.id, { text: 'Project not found' }); return }
    if (proj.voters.includes(userId)) { await bot.answerCallbackQuery(query.id, { text: '✅ Already voted!' }); return }
    proj.votes++
    proj.voters.push(userId)
    saveProjects(projects)
    await bot.answerCallbackQuery(query.id, { text: `👍 Voted! Total: ${proj.votes}` })
    return
  }

  // WALLET action callbacks
  if (data === 'wallet_create') {
    walletSessions.set(userId, { step: 'email' })
    await bot.sendMessage(chatId,
      `<b>➕ Create Bankr Wallet</b>\n\nEnter your Bankr email to connect via OTP:`,
      { parse_mode: 'HTML' } as any
    )
    return
  }

  const walletActions: Record<string, string> = {
    wallet_swap: 'I want to swap tokens on Base',
    wallet_send: 'I want to send crypto',
    wallet_portfolio: 'Show my full portfolio and balances',
    wallet_dca: 'Set up DCA recurring buy for me',
    wallet_limit: 'I want to set a limit order',
    wallet_stoploss: 'I want to set a stop loss',
    wallet_nfts: 'Show my NFT portfolio',
    wallet_polymarket: 'I want to bet on Polymarket',
    wallet_bridge: 'I want to bridge assets to Base',
    wallet_tokens: 'Show my token balances and any claimable fees',
  }
  if (data in walletActions) {
    const users2 = loadUsers()
    const user2 = users2[userId]
    if (!user2?.bankrApiToken) {
      await bot.sendMessage(chatId,
        `⚠️ <b>Wallet not connected</b>\n\nYou need a Bankr wallet to use this feature.\n\nTap below to create one:`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '➕ Create Wallet on Bankr', callback_data: 'wallet_create' }]] }
        } as any
      )
      return
    }
    await bot.sendMessage(chatId, `Processing... ⏳`)
    const result = await askLLM([{role: "user", content: walletActions[data]}])
    await bot.sendMessage(chatId, result || '⚠️ Could not complete action. Try again.', { parse_mode: 'HTML' } as any)
    return
  }

  // Fee type selection for /launch
  if (['fee_x', 'fee_farcaster', 'fee_ens', 'fee_wallet', 'fee_skip'].includes(data)) {
    const userId2 = query.from?.id
    if (!userId2) return
    const state = launchSessions.get(userId2)
    if (!state) return

    if (data === 'fee_skip') {
      state.feeType = 'skip'
      state.feeValue = ''
      state.step = 'confirm'
      launchSessions.set(userId2, state)
      const summary = `🚀 <b>Confirm Token Launch</b>\n\n` +
        `• Name: <b>${state.name}</b>\n• Symbol: <b>$${state.symbol}</b>\n` +
        `• Description: <i>${state.description || '(none)'}</i>\n` +
        `• Image: ${state.image ? `<a href="${state.image}">link</a>` : '(none)'}\n` +
        `• Fee recipient: (default)\n\nType <b>confirm</b> to deploy or <b>cancel</b> to abort:`
      await bot.sendMessage(chatId, summary, { parse_mode: 'HTML', disable_web_page_preview: true } as any)
    } else {
      const feeTypeMap: Record<string, string> = {
        fee_x: 'x', fee_farcaster: 'farcaster', fee_ens: 'ens', fee_wallet: 'wallet'
      }
      const promptMap: Record<string, string> = {
        fee_x: 'Enter your <b>X/Twitter handle</b> (e.g. @blocky_agent):',
        fee_farcaster: 'Enter your <b>Farcaster handle</b> (e.g. @shun):',
        fee_ens: 'Enter your <b>ENS name</b> (e.g. shun.eth):',
        fee_wallet: 'Enter your <b>wallet address</b> (0x...):'
      }
      state.feeType = feeTypeMap[data] as any
      state.step = 'fee_value'
      launchSessions.set(userId2, state)
      await bot.sendMessage(chatId, promptMap[data], { parse_mode: 'HTML' } as any)
    }
    return
  }
})

// MAIN MESSAGE HANDLER
// Flow: Bankr Agent (real-time data) → LLM fallback (personality)
// =======================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from?.id || chatId
  const text = msg.text?.trim()

  if (!text || text.startsWith('/')) return

  // Handle persistent Reply keyboard buttons
  if (text === '📱 Menu') {
    await bot.sendMessage(chatId, MENU_TEXT, { parse_mode: 'HTML', reply_markup: MENU_KEYBOARD } as any)
    return
  }
  if (text === 'Profile') {
    const users = loadUsers()
    const user = users[userId] || { id: userId, points: 0, joinedAt: Date.now() }
    const allSorted = Object.values(users).sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
    const rank = allSorted.findIndex((u: any) => u.id === userId) + 1
    const projCount = loadProjects().filter(p => p.submitterId === userId).length
    const profileText = buildProfileText(user, rank, projCount)
    const hasWallet = user.walletConnected && user.bankrApiToken
    await bot.sendMessage(chatId, profileText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: hasWallet ? '💳 Wallet ✅' : '💳 Connect Wallet', callback_data: 'menu_wallet' }],
          [{ text: '← Back to Menu', callback_data: 'nav_back' }]
        ]
      }
    } as any)
    return
  }
  if (text === '📊 $BLUEAGENT') {
    bot.sendChatAction(chatId, 'typing').catch(() => {})
    try {
      const [dexRes, poolRes] = await Promise.all([
        axios.get(`https://api.geckoterminal.com/api/v2/networks/base/tokens/${TOKEN_CONTRACT}`, { timeout: 6000 }),
        axios.get(`https://api.geckoterminal.com/api/v2/networks/base/pools/${TOKEN_POOL}`, { timeout: 6000 }),
      ])
      const ta = dexRes.data?.data?.attributes || {}
      const pa = poolRes.data?.data?.attributes || {}

      const rawPrice = parseFloat(ta.price_usd || '0')
      const price = rawPrice === 0 ? 'N/A'
        : rawPrice >= 0.0001 ? `$${rawPrice.toFixed(6)}`
        : `$${rawPrice.toFixed(10).replace(/0+$/, '')}`

      const change24 = pa.price_change_percentage?.h24
        ? `${parseFloat(pa.price_change_percentage.h24) >= 0 ? '↑' : '↓'}${Math.abs(parseFloat(pa.price_change_percentage.h24)).toFixed(2)}%`
        : 'N/A'
      const change1h = pa.price_change_percentage?.h1
        ? `${parseFloat(pa.price_change_percentage.h1) >= 0 ? '↑' : '↓'}${Math.abs(parseFloat(pa.price_change_percentage.h1)).toFixed(2)}%`
        : 'N/A'
      const mcap = ta.market_cap_usd
        ? `$${(parseFloat(ta.market_cap_usd) / 1000).toFixed(1)}K`
        : ta.fdv_usd ? `$${(parseFloat(ta.fdv_usd) / 1000).toFixed(1)}K` : 'N/A'
      const vol = ta.volume_usd?.h24
        ? `$${(parseFloat(ta.volume_usd.h24) / 1000).toFixed(1)}K`
        : 'N/A'
      const liq = pa.reserve_in_usd
        ? `$${(parseFloat(pa.reserve_in_usd) / 1000).toFixed(1)}K`
        : 'N/A'
      const buys = pa.transactions?.h24?.buys || 0
      const sells = pa.transactions?.h24?.sells || 0

      await bot.sendMessage(chatId,
        `🟦 <b>$BLUEAGENT</b>\n\n` +
        `💰 <b>${price}</b>\n` +
        `📈 24h: ${change24}  1h: ${change1h}\n` +
        `🏦 MCap: ${mcap}  💧 Liq: ${liq}\n` +
        `📊 Vol 24h: ${vol}\n` +
        `🛒 ${buys} buys  📤 ${sells} sells\n\n` +
        `<a href="https://www.geckoterminal.com/base/pools/${TOKEN_POOL}">📊 Chart</a> · <a href="https://dexscreener.com/base/${TOKEN_CONTRACT}">DEX</a>`,
        { parse_mode: 'HTML', disable_web_page_preview: true } as any
      )
    } catch {
      await bot.sendMessage(chatId, '⚠️ Could not fetch price right now.', { parse_mode: 'HTML' } as any)
    }
    return
  }
  if (text === '🔥 Trending') {
    const reply = await fetchTrendingFallback()
    await bot.sendMessage(chatId, reply || '⚠️ No trending data right now.', { parse_mode: 'HTML', disable_web_page_preview: true } as any)
    return
  }

  // Group mode — only respond when mentioned or replied to, and only in General (blue-chat)
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup'
  if (isGroup) {
    const msgThreadId = (msg as any).message_thread_id
    // Only respond in General topic (thread 1 or no thread)
    if (msgThreadId && msgThreadId !== 1) return
    const botInfo = await bot.getMe()
    const mentioned = text.toLowerCase().includes(`@${botInfo.username?.toLowerCase()}`)
    const isReplyToBot = msg.reply_to_message?.from?.id === botInfo.id
    if (!mentioned && !isReplyToBot) return
    // In group context, clear any active DM sessions to avoid flow conflicts
    launchSessions.delete(userId)
    submitSessions.delete(userId)
    walletSessions.delete(userId)
    xHandleSessions.delete(userId)
    // Strip the @botname mention from text for clean processing
    const botUsername = botInfo.username || ''
    const cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim()
    if (!cleanText) {
      await bot.sendMessage(chatId, "Hey! 🟦 I'm Blue Agent. What do you need?")
      return
    }
    // Route group mentions through same logic as DM (needsAgent + LLM fallback)
    try {
      let reply = ''
      // In group: $TOKEN mention → DexScreener price (fast, no timeout)
      const tokenMatch = cleanText.match(/^\$(\w+)$/) || cleanText.match(/\$(\w+)\s+price/i)
      if (tokenMatch) {
        reply = await fetchTokenPrice(tokenMatch[1])
      }
      if (!reply && isTrendingQuery(cleanText)) {
        reply = await fetchTrendingFallback()
      }
      // For other agent queries (swap, balance, etc.) → Bankr Agent
      if (!reply && needsAgent(cleanText)) {
        const agentPrompt = isXQuery(cleanText) ? buildXPrompt(cleanText) : cleanText
        const maxPolls = (isXQuery(cleanText) || /bankr/i.test(cleanText)) ? 25 : 15
        const agentRaw = await askLLM([{role: "user", content: agentPrompt}])
        if (agentRaw) reply = formatAgentReply(agentRaw)
      }
      if (!reply) {
        addToHistory(userId, 'user', cleanText)
        reply = await askLLM(getHistory(userId))
        if (reply) addToHistory(userId, 'assistant', reply)
      }
      if (!reply) reply = "Couldn't process that right now. Try again! 🔄"
      await bot.sendMessage(chatId, reply, {
        parse_mode: 'HTML',
        reply_to_message_id: msg.message_id,
        disable_web_page_preview: true,
      } as any)
    } catch (err) {
      await bot.sendMessage(chatId, "Something went wrong. Try again! 🔄")
    }
    return
  }

  // Launch wizard takes priority
  if (launchSessions.has(userId)) {
    await handleLaunchWizard(chatId, userId, text)
    return
  }

  // X Handle session
  if (xHandleSessions.has(userId)) {
    xHandleSessions.delete(userId)
    const handle = text.replace('@', '').trim()
    if (!handle) {
      await bot.sendMessage(chatId, '⚠️ Invalid handle. Try again with /profile')
      return
    }
    const users2 = loadUsers()
    if (!users2[userId]) users2[userId] = { id: userId, points: 0, joinedAt: Date.now() }
    users2[userId].xHandle = handle
    users2[userId].telegramUsername = msg.from?.username
    users2[userId].telegramName = msg.from?.first_name
    saveUsers(users2)
    await bot.sendMessage(chatId,
      `✅ X handle set: <b>@${handle}</b>\n\nUse /profile to view your profile.`,
      { parse_mode: 'HTML' } as any
    )
    return
  }

  // Score session — waiting for handle
  if (scoreSessions.has(userId)) {
    scoreSessions.delete(userId)
    const handle = text.replace('@', '').trim()
    if (!handle) {
      await bot.sendMessage(chatId, '⚠️ Invalid handle. Try again!')
      return
    }
    await runBuilderScore(chatId, handle)
    return
  }

  // Wallet OTP flow
  if (walletSessions.has(userId)) {
    const session = walletSessions.get(userId)!
    if (session.step === 'email') {
      const email = text.trim()
      try {
        await axios.post('https://api.bankr.bot/auth/send-otp', { email },
          { headers: { 'x-api-key': BANKR_API_KEY, 'content-type': 'application/json' }, timeout: 10000 }
        )
        session.step = 'otp'
        session.email = email
        walletSessions.set(userId, session)
        await bot.sendMessage(chatId, `✅ OTP sent to <b>${email}</b>\n\nEnter the OTP code:`, { parse_mode: 'HTML' } as any)
      } catch {
        walletSessions.delete(userId)
        await bot.sendMessage(chatId, '❌ Could not send OTP. Check your email and try /wallet again.')
      }
      return
    }
    if (session.step === 'otp') {
      const otp = text.trim()
      try {
        const res = await axios.post('https://api.bankr.bot/auth/verify-otp',
          { email: session.email, otp },
          { headers: { 'x-api-key': BANKR_API_KEY, 'content-type': 'application/json' }, timeout: 10000 }
        )
        const token = res.data?.token || res.data?.apiToken || res.data?.accessToken
        if (token) {
          const users = loadUsers()
          if (!users[userId]) users[userId] = { id: userId, points: 0 }
          users[userId].bankrApiToken = token
          users[userId].walletConnected = true
          users[userId].telegramUsername = msg.from?.username
          users[userId].telegramName = msg.from?.first_name
          saveUsers(users)
          walletSessions.delete(userId)
          await bot.sendMessage(chatId,
            `✅ <b>Wallet Connected!</b>\n\nYour Bankr wallet is now linked. Use /wallet to access onchain actions.`,
            { parse_mode: 'HTML' } as any
          )
        } else {
          throw new Error('No token')
        }
      } catch {
        walletSessions.delete(userId)
        await bot.sendMessage(chatId, '❌ Invalid OTP. Try /wallet again.')
      }
      return
    }
    return
  }

  // Submit project flow
  if (submitSessions.has(userId)) {
    const session = submitSessions.get(userId)!
    switch (session.step) {
      case 1: // Name — validate max 50 chars
        if (text.length > 50) {
          await bot.sendMessage(chatId, '⚠️ Name too long (max 50 chars). Try again:')
          return
        }
        session.name = text
        session.step = 2
        await bot.sendMessage(chatId,
          `✅ <b>${text}</b>\n\nStep 2/4: Short description <i>(max 200 chars)</i>:`,
          { parse_mode: 'HTML' } as any
        )
        break
      case 2: // Description — validate max 200 chars
        if (text.length > 200) {
          await bot.sendMessage(chatId, `⚠️ Too long (${text.length}/200 chars). Shorten it:`)
          return
        }
        session.description = text
        session.step = 3
        await bot.sendMessage(chatId, `Step 3/4: Project URL <i>(must start with http)</i>:`, { parse_mode: 'HTML' } as any)
        break
      case 3: // URL — validate format
        if (!text.startsWith('http')) {
          await bot.sendMessage(chatId, '⚠️ Must start with http:// or https://. Try again:')
          return
        }
        // Check duplicate URL
        const existingProjects = loadProjects()
        const duplicate = existingProjects.find(p => p.url === text)
        if (duplicate) {
          await bot.sendMessage(chatId, `⚠️ Project with this URL already exists: <b>${duplicate.name}</b>`, { parse_mode: 'HTML' } as any)
          submitSessions.delete(userId)
          return
        }
        session.url = text
        session.step = 4
        await bot.sendMessage(chatId, `Step 4/4: X/Twitter handle <i>(optional — type "skip")</i>:`, { parse_mode: 'HTML' } as any)
        break
      case 4: // Twitter + save
        session.twitter = text.toLowerCase() === 'skip' ? undefined : text.replace('@', '')
        const projects2 = loadProjects()
        const newProject: Project = {
          id: `proj_${Date.now()}`,
          name: session.name!,
          description: session.description!,
          url: session.url!,
          twitter: session.twitter,
          submitterId: userId,
          submitterUsername: msg.from?.username,
          timestamp: Date.now(),
          votes: 0,
          voters: [],
          approved: false  // chờ admin duyệt
        }
        projects2.push(newProject)
        saveProjects(projects2)
        submitSessions.delete(userId)

        // Notify user — pending review, no pts yet
        await bot.sendMessage(chatId,
          `✅ <b>Project Submitted!</b>\n\n` +
          `<b>${newProject.name}</b>\n` +
          `${newProject.description}\n` +
          `🔗 ${newProject.url}\n` +
          (newProject.twitter ? `🐦 @${newProject.twitter}\n` : '') +
          `\n⏳ <i>Under review. You'll receive +20 pts once approved!</i>`,
          { parse_mode: 'HTML', disable_web_page_preview: true } as any
        )

        // Notify admin (OWNER_ID) with Approve/Reject buttons
        const submitterTag = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || 'Builder'
        bot.sendMessage(OWNER_ID,
          `📝 <b>New Project — Pending Review</b>\n\n` +
          `<b>${newProject.name}</b>\n` +
          `${newProject.description}\n\n` +
          `🔗 <a href="${newProject.url}">${newProject.url}</a>\n` +
          (newProject.twitter ? `🐦 @${newProject.twitter}\n` : '') +
          `\n👤 Submitted by ${submitterTag}`,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `admin_approve_${newProject.id}` },
                { text: '❌ Reject', callback_data: `admin_reject_${newProject.id}` }
              ]]
            }
          } as any
        ).catch(console.error)

        break
    }
    submitSessions.set(userId, session)
    return
  }

  // Typing indicator
  bot.sendChatAction(chatId, 'typing').catch(() => {})
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, 'typing').catch(() => {})
  }, 4000)


  try {
    let reply = ''

    if (needsAgent(text)) {
      // Bankr Agent: real-time data + on-chain actions + X search
      const agentPrompt = isXQuery(text) ? buildXPrompt(text) : text
      // X + Bankr queries are slower — give more time
      const maxPolls = (isXQuery(text) || /bankr/i.test(text)) ? 25 : 15
      console.log(`[Agent] ${isXQuery(text) ? '[X-enriched]' : ''} ${text}`)
      const agentRaw = await askLLM([{role: "user", content: agentPrompt}])
      if (agentRaw) {
        reply = formatAgentReply(agentRaw)
      }

      // Agent failed → fall through to LLM below
    }

    if (!reply) {
      // LLM fallback: Blue Agent personality for general questions
      console.log(`[LLM] ${text}`)
      addToHistory(userId, 'user', text)
      reply = await askLLM(getHistory(userId))
      if (reply) addToHistory(userId, 'assistant', reply)
    }

    if (!reply) {
      reply = "Couldn't process that right now. Try again in a moment! 🔄"
    }

    await bot.sendMessage(chatId, reply, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    } as any)

  } catch (e: any) {
    console.error('Handler error:', e.message)
    await bot.sendMessage(chatId, 'Something went wrong. Please try again!')
  } finally {
    clearInterval(typingInterval)
  }
})

// =======================
// STARTUP
// =======================
// DM commands (default)
bot.setMyCommands([
  { command: 'start', description: '🟦 Start Blue Agent' },
  { command: 'menu', description: '📱 Control Panel' },
  { command: 'score', description: '📊 Builder Score (@handle)' },
  { command: 'points', description: '⭐ My Points & Rank' },
  { command: 'wallet', description: '💰 Wallet & Trade' },
  { command: 'profile', description: '👤 My Profile' },
  { command: 'rewards', description: '🎁 Rewards & Claim' },
  { command: 'refer', description: '🔗 Referral Link' },
  { command: 'leaderboard', description: '🏆 Top Builders' },
  { command: 'submit', description: '📝 Submit Project' },
  { command: 'projects', description: '📁 Builder Directory' },
  { command: 'news', description: '📰 Base Builder Feed' },
  { command: 'launch', description: '🚀 Deploy Token on Base' },
  { command: 'stats', description: '📈 Blue Agent Stats' },
  { command: 'agents', description: '🤖 Bankr Agent Leaderboard' },
  { command: 'help', description: '❓ Help' },
]).catch(() => {})

// Group commands — only what makes sense in group context
bot.setMyCommands([
  { command: 'points', description: '⭐ My Points & Rank' },
  { command: 'leaderboard', description: '🏆 Top Builders' },
  { command: 'news', description: '📰 Base Builder Feed' },
  { command: 'stats', description: '📈 Blue Agent Stats' },
], { scope: { type: 'all_group_chats' } } as any).catch(() => {})

// Owner-only commands
bot.setMyCommands([
  { command: 'start', description: '🟦 Start Blue Agent' },
  { command: 'menu', description: '📱 Control Panel' },
  { command: 'score', description: '📊 Builder Score (@handle)' },
  { command: 'wallet', description: '💰 Wallet & Trade' },
  { command: 'profile', description: '👤 My Profile' },
  { command: 'rewards', description: '🎁 Rewards Hub' },
  { command: 'refer', description: '🔗 Referral Link' },
  { command: 'leaderboard', description: '🏆 Top Builders' },
  { command: 'submit', description: '📝 Submit Project' },
  { command: 'projects', description: '📁 Builder Directory' },
  { command: 'news', description: '📰 Base Builder Feed' },
  { command: 'launch', description: '🚀 Deploy Token on Base' },
  { command: 'stats', description: '📈 Blue Agent Stats' },
  { command: 'agents', description: '🤖 Bankr Agent Leaderboard' },
  { command: 'help', description: '❓ Help' },
  { command: 'model', description: '🤖 AI Models' },
  { command: 'status', description: '🔍 Health Check' },
], { scope: { type: 'chat', chat_id: OWNER_ID } } as any).catch(() => {})

bot.getMe().then((me) => {
  console.log(`🟦 Blue Agent started: @${me.username}`)
  console.log(`LLM key: ${BANKR_LLM_KEY ? 'loaded' : 'MISSING'}`)
  console.log(`Agent key: ${BANKR_API_KEY ? 'loaded' : 'MISSING'}`)
}).catch(console.error)

// =======================
// BLUE-ALPHA AUTO SIGNALS
// =======================
const ALPHA_CHAT_ID = CFG.telegram.group_id
const ALPHA_THREAD_ID = 15
const SIGNAL_INTERVAL_MS = 30 * 60 * 1000 // every 30 minutes
let signalCounter = 0
const postedSignalUrls = new Set<string>()


// =======================
// 1. AUTO-ONBOARDING — DM user khi join group
// =======================
bot.on('new_chat_members', async (msg) => {
  if (msg.chat.id !== ALPHA_CHAT_ID) return

  for (const newMember of msg.new_chat_members || []) {
    if (newMember.is_bot) continue
    const userId = newMember.id
    const firstName = newMember.first_name || 'builder'
    const username = newMember.username ? `@${newMember.username}` : firstName

    // Auto-create user record if not exists
    const users = loadUsers()
    if (!users[userId]) {
      const wallet = require('ethers').Wallet.createRandom()
      users[userId] = {
        id: userId,
        telegramUsername: newMember.username,
        telegramName: firstName,
        points: 5, // join bonus
        joinedAt: Date.now(),
        walletConnected: true,
        evmAddress: wallet.address,
        privateKey: wallet.privateKey,
      }
      saveUsers(users)
    }

    // Send welcome DM
    try {
      await bot.sendMessage(userId,
        `🟦 <b>Welcome to ${PROJECT.name} Community, ${firstName}!</b>\n\n` +
        `You've just joined a community of builders on Base.\n\n` +
        `<b>Here's how to get started:</b>\n\n` +
        `1️⃣ /start → activate your account\n` +
        `2️⃣ /score @yourhandle → check your Builder Score\n` +
        `3️⃣ /submit → showcase your project (+20 pts)\n` +
        `4️⃣ /refer → invite builders, earn ${REWARDS.referrer_pts} pts each\n\n` +
        `⭐ You already have <b>5 pts</b> just for joining!\n\n` +
        `<i>See you in the group 🟦</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🟦 Get Started', callback_data: 'open_menu' }]] } } as any
      )
    } catch {
      // User may have DMs disabled — silently ignore
    }
  }
})

// =======================
// 2. WEEKLY RECAP — Every Monday 9:00 AM
// =======================
function getNextMondayMs(): number {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon...
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7
  const next = new Date(now)
  next.setDate(now.getDate() + daysUntilMonday)
  next.setHours(9, 0, 0, 0)
  return next.getTime() - now.getTime()
}

async function postWeeklyRecap() {
  const users = loadUsers()
  const projects = loadProjects()
  const referrals = loadReferrals()

  const totalUsers = Object.keys(users).length
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const newUsers = Object.values(users).filter((u: any) => u.joinedAt > weekAgo).length
  const weeklyProjects = projects.filter(p => p.approved && p.timestamp > weekAgo).length
  const weeklyRefs = referrals.filter(r => r.timestamp > weekAgo).length

  // Top 3 builders by points
  const top3 = Object.values(users)
    .sort((a: any, b: any) => (b.points || 0) - (a.points || 0))
    .slice(0, 3)
    .map((u: any, i: number) => {
      const medal = ['🥇', '🥈', '🥉'][i]
      const name = u.telegramUsername ? `@${u.telegramUsername}` : u.telegramName || 'Builder'
      return `${medal} ${name} — <b>${u.points || 0} pts</b>`
    })

  const recap =
    `📊 <b>Weekly Builder Recap</b> 🟦\n` +
    `──────────────\n` +
    `👥 Total builders: <b>${totalUsers}</b> (+${newUsers} this week)\n` +
    `📁 Projects approved: <b>${weeklyProjects}</b>\n` +
    `🔗 Referrals made: <b>${weeklyRefs}</b>\n` +
    `──────────────\n` +
    `<b>🏆 Top Builders This Week:</b>\n` +
    top3.join('\n') +
    `\n──────────────\n` +
    `<i>Keep building. See you next week 🟦</i>`

  await bot.sendMessage(ALPHA_CHAT_ID, recap, {
    parse_mode: 'HTML',
    message_thread_id: THREADS.builders
  } as any).catch(console.error)
}

// Schedule weekly recap
setTimeout(() => {
  postWeeklyRecap()
  setInterval(postWeeklyRecap, 7 * 24 * 60 * 60 * 1000)
}, getNextMondayMs())

console.log(`📅 Weekly recap scheduled in ${Math.round(getNextMondayMs() / 3600000)}h`)

// =======================
// 3. MILESTONE ANNOUNCEMENTS
// =======================
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000]

async function checkMilestones() {
  const users = loadUsers()
  const count = Object.keys(users).length
  const hit = MILESTONES.find(m => m === count)
  if (!hit) return

  await bot.sendMessage(ALPHA_CHAT_ID,
    `🎉 <b>Milestone reached!</b>\n\n` +
    `We just hit <b>${hit} builders</b> in the community! 🟦\n\n` +
    `Thank you for building with us. More builders = more signal. Keep shipping! 🔨`,
    { parse_mode: 'HTML', message_thread_id: THREADS.builders } as any
  ).catch(console.error)
}

// Check milestone on every new_chat_members
// (already handled above — add checkMilestones call after saving user)
