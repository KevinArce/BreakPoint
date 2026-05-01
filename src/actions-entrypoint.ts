import { run } from '@probot/adapter-github-actions'
import app from './index.js'

run(app).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
