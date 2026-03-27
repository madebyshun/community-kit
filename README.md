# 🟦 Blue Agent Community Kit

> All-in-one Telegram community bot for Base token projects.
> Points, referrals, leaderboard, project directory, auto-onboarding — 1 config file.

**Built by [Blue Agent](https://x.com/blocky_agent) · Powered by [Bankr LLM](https://bankr.bot)**

---

## Why Community Kit?

Instead of using 4-5 separate bots:
- ❌ 1 bot for points
- ❌ 1 bot for signals
- ❌ 1 bot for moderation
- ❌ 1 bot for announcements

→ ✅ **Community Kit: everything in one bot, one config file**

---

## Features (Open Source)

| Feature | Description |
|---------|-------------|
| 🎯 Points System | Daily check-in, referrals, project submission |
| 👥 Auto-onboarding | DM new members with guided setup |
| 🏆 Leaderboard | Top builders ranked by points |
| 📁 Project Directory | Submit, browse, vote on projects |
| 🛠️ Admin Panel | Approve/reject projects via Telegram buttons |
| 📊 Weekly Recap | Auto-post community stats every Monday |
| 🎉 Milestones | Auto-announce member count milestones |
| 💰 Wallet | Auto-create Base wallet for every user |
| 🔗 Referrals | Referral links with point rewards |
| ⚙️ Configurable | 1 JSON file — no code changes needed |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/madebyshun/community-kit
cd community-kit
npm install
```

### 2. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy your bot token

### 3. Configure

```bash
cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_ID
```

Edit `config.json`:
```json
{
  "project": {
    "name": "Your Project",
    "emoji": "🔵",
    "twitter": "@yourproject"
  },
  "token": {
    "symbol": "YOURTOKEN",
    "name": "$YOURTOKEN",
    "contract": "0x...",
    "tokens_per_point": 10000
  },
  "telegram": {
    "group_id": -100YOUR_GROUP_ID,
    "bot_username": "yourbot",
    "threads": {
      "alpha": 0,
      "trades": 0,
      "feed": 0,
      "meme": 0,
      "builders": 0
    }
  },
  "rewards": {
    "checkin_pts": 5,
    "referrer_pts": 50,
    "referred_pts": 10,
    "submit_project_pts": 20,
    "claim_min_pts": 100,
    "claim_cooldown_days": 7
  }
}
```

### 4. Run

```bash
npm run build
npm start
# Or with PM2:
pm2 start dist/index.js --name my-community-bot
```

---

## Commands

### User Commands
| Command | Description |
|---------|-------------|
| `/start` | Activate account + auto-create wallet |
| `/menu` | Open main menu |
| `/score @handle` | Check Builder Score |
| `/rewards` | View points & claim status |
| `/refer` | Get referral link |
| `/leaderboard` | Top builders |
| `/submit` | Submit your project |
| `/projects` | Browse community projects |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/admin` | Open admin panel (owner only) |

---

## Upgrade to Pro 🟦

Want more? [Blue Agent Pro](https://blueagent.xyz) includes:
- 📈 Gem signals (Base + Solana)
- 📊 Real-time trade tracker
- 🎁 Onchain token claim
- 🌐 Web dashboard
- 🏠 Managed hosting

**Pricing by community size:**
- Growth (500–2K members): $29/month
- Pro (2K–10K members): $79/month
- Scale (10K+ members): $199/month

---

## Built on

- [Bankr LLM Gateway](https://bankr.bot) — AI responses
- [ethers.js](https://ethers.org) — wallet generation
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

---

## License

MIT — fork, modify, and ship it.

---

*Built by [@blocky_agent](https://x.com/blocky_agent) · [Blue Agent](https://blueagent.xyz)*
