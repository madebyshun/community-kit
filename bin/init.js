#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const q = (question) => new Promise(resolve => rl.question(question, resolve))

async function main() {
  console.log('\n🟦 Blue Agent Community Kit — Setup Wizard')
  console.log('────────────────────────────────────────────')
  console.log('Launch your AI-powered Telegram community in 5 minutes.\n')

  // Clone repo
  const dir = await q('📁 Project folder name (default: my-community-bot): ') || 'my-community-bot'

  if (fs.existsSync(dir)) {
    console.log(`\n⚠️  Folder "${dir}" already exists. Using existing folder.`)
  } else {
    console.log('\n📦 Cloning community-kit...')
    execSync(`git clone https://github.com/madebyshun/community-kit ${dir}`, { stdio: 'inherit' })
  }

  process.chdir(dir)

  // Collect config
  console.log('\n🔧 Configure your bot:\n')
  const botToken   = await q('🤖 Telegram Bot Token (from @BotFather): ')
  const ownerId    = await q('👤 Your Telegram ID (from @userinfobot): ')
  const projectName = await q('📛 Project name: ')
  const tokenSymbol = await q('💰 Token symbol (e.g. MYTOKEN): ')
  const tokenContract = await q('📄 Token contract address (0x...): ')

  // Write .env
  const env = `TELEGRAM_BOT_TOKEN=${botToken}
OWNER_TELEGRAM_ID=${ownerId}
REWARD_WALLET_PRIVATE_KEY=
REWARD_WALLET_ADDRESS=
PAYMENT_ADDRESS=
BASESCAN_API_KEY=
BANKR_LLM_KEY=
BANKR_API_KEY=
`
  fs.writeFileSync('.env', env)

  // Update config.json
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
  config.project.name = projectName || 'My Community'
  config.token.symbol = (tokenSymbol || 'TOKEN').toUpperCase()
  config.token.name = `$${(tokenSymbol || 'TOKEN').toUpperCase()}`
  config.token.contract = tokenContract || '0x'
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2))

  // Install & build
  console.log('\n📦 Installing dependencies...')
  execSync('npm install', { stdio: 'inherit' })

  console.log('\n🔨 Building...')
  execSync('npm run build', { stdio: 'inherit' })

  rl.close()

  console.log('\n✅ Setup complete!\n')
  console.log('────────────────────────────────────────────')
  console.log(`🟦 Project: ${projectName}`)
  console.log(`💰 Token: $${tokenSymbol?.toUpperCase()}`)
  console.log('────────────────────────────────────────────')
  console.log('\n🚀 Start your bot:')
  console.log(`   cd ${dir}`)
  console.log('   npm start\n')
  console.log('💡 Then add your bot to your Telegram group and type /start')
  console.log('📖 Full docs: https://github.com/madebyshun/community-kit\n')
}

main().catch(err => {
  console.error('\n❌ Setup failed:', err.message)
  process.exit(1)
})
