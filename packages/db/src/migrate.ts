/* eslint-disable no-console */ // CLI script: console.log is the intended output channel
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { getDb } from './db'

await migrate(getDb(), { migrationsFolder: './drizzle' })

console.log('迁移完成')
