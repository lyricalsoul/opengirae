import { listCommands } from '../loader'

const token = process.env.TELEGRAM_TOKEN
if (!token) throw new Error('TELEGRAM_TOKEN is not set')

const byName = new Map<string, { command: string; description: string }>()
for (const cmd of listCommands()) {
  if (!cmd.guards.includes('all')) continue
  const { name, description } = cmd.module.info
  if (byName.has(name)) console.warn(`duplicate command name "${name}", keeping the last one loaded`)
  byName.set(name, { command: name, description: description.slice(0, 256) })
}

const commands = [...byName.values()].sort((a, b) => a.command.localeCompare(b.command))
console.log(`Setting ${commands.length} commands:`, commands.map(c => c.command).join(', '))

const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ commands }),
})
const json: any = await res.json()
if (!json.ok) throw new Error(`setMyCommands failed: ${json.description}`)

console.log('Done')
process.exit(0)
