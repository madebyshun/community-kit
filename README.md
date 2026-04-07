# 🟦 Blue Agent Community Kit

> **Launch your own AI-powered Telegram community in 5 minutes.**

Built by [Blue Agent](https://x.com/blocky_agent) · Powered by [Bankr LLM](https://bankr.bot) · Runs on Base

---

## Quick Start

```bash
npx blueagent init
```

Or manually:

```bash
git clone https://github.com/madebyshun/community-kit
cd community-kit
cp .env.example .env
# → paste your bot token
npm install && npm run build && npm start
```

**Your bot will reply to `/start` in under 5 minutes.**

---

## What You Get

One bot. One config file. Everything your community needs.

| Feature | Free | Seed $49 | Pro $199 | Scale $499 |
|---------|:----:|:--------:|:--------:|:----------:|
| Points & Check-in | ✅ | ✅ | ✅ | ✅ |
| Leaderboard | ✅ | ✅ | ✅ | ✅ |
| Referral System | ✅ | ✅ | ✅ | ✅ |
| Auto-onboarding | ✅ | ✅ | ✅ | ✅ |
| Project Directory | ✅ | ✅ | ✅ | ✅ |
| Admin Panel | ✅ | ✅ | ✅ | ✅ |
| Price Alerts | ❌ | ✅ | ✅ | ✅ |
| Gem Signals | ❌ | ✅ | ✅ | ✅ |
| Raffle & Games | ❌ | ✅ | ✅ | ✅ |
| Scheduled Posts | ❌ | ✅ | ✅ | ✅ |
| Token Claim | ❌ | ❌ | ✅ | ✅ |
| Broadcast DM | ❌ | ❌ | ✅ | ✅ |
| Flash Quests | ❌ | ❌ | ✅ | ✅ |
| Bounties | ❌ | ❌ | ✅ | ✅ |
| Proposal Voting | ❌ | ❌ | ✅ | ✅ |
| Analytics Export | ❌ | ❌ | ❌ | ✅ |
| Token Gate | ❌ | ❌ | ❌ | ✅ |
| Custom Branding | ❌ | ❌ | ❌ | ✅ |

Pay with **USDC** or **$BLUEAGENT** (-20%) on Base · Multi-month: 3mo -10% | 6mo -15% | 12mo -20%

👉 **[Upgrade → @blocky_agent](https://t.me/blocky_agent)**

---

## Setup (Step by Step)

### 1. Create a Telegram Bot

Message [@BotFather](https://t.me/BotFather):
```
/newbot
→ choose a name
→ copy the token
```

### 2. Get your Telegram ID

Message [@userinfobot](https://t.me/userinfobot) → copy your numeric ID.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
TELEGRAM_BOT_TOKEN=123456:ABC-your-token-here
OWNER_TELEGRAM_ID=123456789
```

Edit `config.json` — change these fields:
```json
{
  "project": {
    "name": "Your Project Name",
    "emoji": "🔵",
    "twitter": "@yourproject"
  },
  "token": {
    "symbol": "YOURTOKEN",
    "name": "$YOURTOKEN",
    "contract": "0x_your_token_contract"
  },
  "telegram": {
    "group_id": -100_your_group_id,
    "bot_username": "yourbotname"
  }
}
```

### 4. Run

```bash
npm install
npm run build
npm start
```

**First success moment:** Add your bot to your Telegram group, type `/start` — bot will reply. 🎉

For production (keep running):
```bash
pm2 start dist/index.js --name my-community-bot
pm2 save
```

---

## Commands

### User Commands
| Command | Description |
|---------|-------------|
| `/start` | Activate + auto-create Base wallet |
| `/menu` | Open main menu |
| `/checkin` | Daily check-in (+5 pts) |
| `/rewards` | Points balance + claim status |
| `/refer` | Get referral link (+50 pts/referral) |
| `/leaderboard` | Top builders this week |
| `/submit` | Submit your project (+20 pts) |
| `/projects` | Browse community projects |
| `/score @handle` | AI Builder Score (0–100) |
| `/wallet` | Your Base wallet |
| `/profile` | Your profile card |
| `/pricing` | View upgrade options |
| `/subscribe` | Subscribe to a paid tier |

### Owner Commands
| Command | Description |
|---------|-------------|
| `/admin` | Admin panel |
| `/broadcast [msg]` | DM all users (Pro+) |
| `/raffle start [prize]` | Start a raffle (Seed+) |
| `/signals` | Gem signals (Seed+) |
| `/export` | Export users CSV (Scale+) |
| `/subscribe_admin` | Manually record a subscription |
| `/subs` | List all subscriptions |
| `/status` | Bot status |

---

## How Points Work

| Action | Points |
|--------|--------|
| Daily check-in | +5 pts |
| 7-day streak bonus | +10 pts |
| Refer a builder | +50 pts |
| Submit a project | +20 pts |
| Win trivia | +25 pts |
| Weekly top 3 | +100 pts |

**1 point = `tokens_per_point` tokens** (set in config.json)

Users claim tokens via `/rewards` → direct transfer to their wallet.

---

## Activate Paid Features

When a customer upgrades, edit their `config.json`:

```json
{
  "tier": "seed",
  "features": {
    "gem_signals": true,
    "raffle": true,
    "price_alerts": true,
    "scheduled_posts": true
  }
}
```

Restart the bot → features unlock instantly.

**Tier → features mapping:**

| Tier | Unlock |
|------|--------|
| `seed` | gem_signals, raffle, price_alerts, scheduled_posts, mini_games |
| `pro` | + token_claim, broadcast_dm, flash_quests, bounties, proposal_voting |
| `scale` | + analytics_export, token_gate, custom_branding |

---

## Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN=          # From @BotFather
OWNER_TELEGRAM_ID=           # Your Telegram numeric ID

# For token rewards (optional but recommended)
REWARD_WALLET_PRIVATE_KEY=   # Wallet that sends token rewards
REWARD_WALLET_ADDRESS=       # Same wallet's address

# For subscription payment verification (optional)
BASESCAN_API_KEY=            # From basescan.org/myapikey
PAYMENT_ADDRESS=             # Your treasury wallet for receiving payments

# For AI features (optional)
BANKR_LLM_KEY=               # From bankr.bot
BANKR_API_KEY=               # From bankr.bot
```

---

## Architecture

```
community-kit/
├── src/index.ts       # Main bot (single file, easy to read)
├── config.json        # Your project config (no code changes needed)
├── .env               # Secrets (never commit this)
└── data/
    ├── users.json     # User profiles + points
    ├── projects.json  # Submitted projects
    └── subscriptions.json  # Active subscriptions
```

Everything is JSON. No database required. Runs on any $5 VPS.

---

## Troubleshooting

**Bot doesn't respond:**
- Check `TELEGRAM_BOT_TOKEN` is correct
- Make sure bot is added to the group as admin
- Check `group_id` is correct (negative number for groups)

**How to get group_id:**
Add [@userinfobot](https://t.me/userinfobot) to your group temporarily → it shows the group ID.

**Token rewards not sending:**
- `REWARD_WALLET_PRIVATE_KEY` must be set
- Wallet needs ETH for gas + tokens to send

**"Polling error" in logs:**
- Only one bot instance can run at a time
- Kill old process: `pm2 delete all` then restart

---

## Built With

- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- [ethers.js](https://ethers.org) — Base wallet creation + token transfers
- [Bankr LLM](https://bankr.bot) — AI features
- [DexScreener API](https://dexscreener.com) — Token signals
- [Basescan API](https://basescan.org) — Transaction verification

---

## License

MIT — fork it, build on it, ship it.

---

**Built by [Blue Agent](https://x.com/blocky_agent) 🟦**
*The AI ops agent for Base builders.*
