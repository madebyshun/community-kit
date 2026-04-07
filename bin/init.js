#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const q = (question) => new Promise(resolve => rl.question(question, resolve))

const TEMPLATES = {
  '1': { key: 'token-community', label: '🪙  Token Community  — Points, rewards, leaderboard, token claim' },
  '2': { key: 'gaming-guild',    label: '🎮  Gaming Guild      — Quests, raffle, mini-games, leaderboard' },
  '3': { key: 'builder-dao',     label: '🏗️   Builder DAO       — Proposals, bounties, project directory' },
  '4': { key: 'ai-agent',        label: '🤖  AI Agent          — Gem signals, alpha feed, trade tracking' },
  '5': { key: 'blank',           label: '📦  Blank             — Start from scratch' },
}

const REPO_URL = 'https://github.com/madebyshun/community-kit'

async function pickTemplate(flagTemplate) {
  if (flagTemplate && Object.values(TEMPLATES).find(t => t.key === flagTemplate)) {
    return flagTemplate
  }

  console.log('\n📋 Choose a template:\n')
  for (const [num, t] of Object.entries(TEMPLATES)) {
    console.log(`   ${num}. ${t.label}`)
  }
  console.log('')

  const choice = await q('Enter number (default: 1): ') || '1'
  const picked = TEMPLATES[choice.trim()]
  if (!picked) {
    console.log('Invalid choice, using token-community.')
    return 'token-community'
  }
  return picked.key
}

async function main() {
  const args = process.argv.slice(2)
  const flagTemplate = args.find((a, i) => args[i - 1] === '--template')
  const flagDir = args.find((a, i) => args[i - 1] === '--dir') || null
  const isDemo = args.includes('--demo')

  console.log('\n🟦  Blue Agent Community Kit')
  console.log('─────────────────────────────────────────────')
  console.log('    Launch your AI-powered Telegram community')
  console.log('    in 5 minutes.\n')

  if (isDemo) {
    await runDemo()
    rl.close()
    return
  }

  // Pick template
  const templateKey = await pickTemplate(flagTemplate)
  const templatePath = path.join(__dirname, '..', 'templates', `${templateKey}.json`)
  const templateCfg = JSON.parse(fs.readFileSync(templatePath, 'utf8'))
  console.log(`\n✅ Template: ${templateKey}\n`)

  // Pick folder
  const defaultDir = flagDir || `my-${templateKey}-bot`
  const dir = await q(`📁 Folder name (default: ${defaultDir}): `) || defaultDir

  // Clone or use existing
  if (fs.existsSync(dir)) {
    console.log(`\n⚠️  Folder "${dir}" exists — using it.`)
  } else {
    console.log('\n📦 Cloning community-kit...')
    const result = spawnSync('git', ['clone', REPO_URL, dir], { stdio: 'inherit' })
    if (result.status !== 0) {
      console.error('❌ Clone failed. Check your internet connection.')
      process.exit(1)
    }
  }

  process.chdir(dir)

  // Collect config
  console.log('\n🔧 Configure your bot:\n')
  const botToken     = await q('🤖 Telegram Bot Token (from @BotFather): ')
  const ownerId      = await q('👤 Your Telegram ID (from @userinfobot): ')
  const projectName  = await q(`📛 Project name (default: ${templateCfg.project.name}): `) || templateCfg.project.name
  const tokenSymbol  = await q(`💰 Token symbol (default: ${templateCfg.token.symbol}): `) || templateCfg.token.symbol
  const tokenContract = await q('📄 Token contract address (0x... or skip): ') || templateCfg.token.contract
  const groupId      = await q('👥 Telegram Group ID (from @userinfobot in group, or skip): ') || String(templateCfg.telegram.group_id)

  // Write .env
  const env = [
    `TELEGRAM_BOT_TOKEN=${botToken}`,
    `OWNER_TELEGRAM_ID=${ownerId}`,
    `REWARD_WALLET_PRIVATE_KEY=`,
    `REWARD_WALLET_ADDRESS=`,
    `PAYMENT_ADDRESS=`,
    `BASESCAN_API_KEY=`,
    `BANKR_LLM_KEY=`,
    `BANKR_API_KEY=`,
  ].join('\n') + '\n'
  fs.writeFileSync('.env', env)

  // Build config from template
  const config = JSON.parse(JSON.stringify(templateCfg))
  delete config._template
  delete config._description
  config.project.name = projectName
  config.token.symbol = tokenSymbol.toUpperCase()
  config.token.name = `$${tokenSymbol.toUpperCase()}`
  config.token.contract = tokenContract
  config.telegram.group_id = parseInt(groupId) || -1000000000000
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2))

  // Install & build
  console.log('\n📦 Installing dependencies...')
  spawnSync('npm', ['install'], { stdio: 'inherit' })

  console.log('\n🔨 Building...')
  spawnSync('npm', ['run', 'build'], { stdio: 'inherit' })

  rl.close()

  // Success screen
  console.log('\n')
  console.log('─────────────────────────────────────────────')
  console.log('✅  Setup complete!')
  console.log('─────────────────────────────────────────────')
  console.log(`🟦  Project  : ${projectName}`)
  console.log(`💰  Token    : $${tokenSymbol.toUpperCase()}`)
  console.log(`🎨  Template : ${templateKey}`)
  console.log('─────────────────────────────────────────────')
  console.log('\n🚀  Start your bot:\n')
  console.log(`   cd ${dir}`)
  console.log('   npm start\n')
  console.log('💡  Then add your bot to your Telegram group and type /start')
  console.log('\n─────────────────────────────────────────────')
  console.log('⭐  If this helped you, star the repo:')
  console.log(`   ${REPO_URL}`)
  console.log('\n🔼  Ready to unlock more features?')
  console.log('   Type /pricing in your bot → upgrade anytime')
  console.log('   Or DM @blocky_agent on Telegram')
  console.log('─────────────────────────────────────────────\n')
}

async function runDemo() {
  console.log('\n🎮 Demo Mode — running with fake data\n')

  const demoConfig = {
    project: { name: 'Demo Community', emoji: '🟦', twitter: '@demo', telegram_community: 'https://t.me/demo', website: 'https://demo.xyz' },
    token: { symbol: 'DEMO', name: '$DEMO', contract: '0x0000000000000000000000000000000000000000', pool: '0x', chain: 'base', tokens_per_point: 1000 },
    telegram: { group_id: -1000000000000, bot_username: 'demobot', threads: { alpha: 0, trades: 0, feed: 0, meme: 0, builders: 0 } },
    rewards: { checkin_pts: 5, checkin_streak_bonus_pts: 10, streak_bonus_days: 7, referrer_pts: 50, referred_pts: 10, submit_project_pts: 20, claim_min_pts: 100, claim_cooldown_days: 7, streak_multiplier: { tier1_days: 7, tier1_mult: 1.5, tier2_days: 14, tier2_mult: 2.0 } },
    tier: 'pro',
    features: { gem_signals: true, raffle: true, price_alerts: true, scheduled_posts: true, mini_games: true, trade_tracker: true, whale_alert: true, token_claim: true, broadcast_dm: true, flash_quests: true, bounties: true, proposal_voting: true, x_quests: false, analytics_export: false, token_gate: false, custom_branding: false },
    auto_posts: { alpha_signals_interval_ms: 0, trending_interval_ms: 0, trades_enabled: false }
  }

  const demoUsers = {}
  const names = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'iris', 'jack']
  names.forEach((name, i) => {
    demoUsers[String(1000 + i)] = {
      id: 1000 + i, telegramUsername: name, points: Math.floor(Math.random() * 2000) + 100,
      joinedAt: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      checkinStreak: Math.floor(Math.random() * 14), lastCheckin: Date.now() - 86400000,
      evmAddress: `0x${Math.random().toString(16).slice(2).padEnd(40, '0')}`
    }
  })

  if (!fs.existsSync('data')) fs.mkdirSync('data')
  fs.writeFileSync('config.demo.json', JSON.stringify(demoConfig, null, 2))
  fs.writeFileSync('data/users.demo.json', JSON.stringify(demoUsers, null, 2))

  console.log('✅ Demo config written: config.demo.json')
  console.log(`✅ Fake users seeded: ${names.length} users with random points`)
  console.log('\n📊 Demo leaderboard preview:')
  const sorted = Object.values(demoUsers).sort((a, b) => b.points - a.points)
  sorted.slice(0, 5).forEach((u, i) => {
    console.log(`   ${i + 1}. @${u.telegramUsername} — ${u.points} pts`)
  })
  console.log('\n💡 To run with demo config:')
  console.log('   DEMO_MODE=true npm start\n')
}

main().catch(err => {
  console.error('\n❌ Setup failed:', err.message)
  rl.close()
  process.exit(1)
})
