import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    include: ['source/**/*.test.ts'],
    exclude: ['output/**'],
  },
  resolve: {
    alias: [
      { find: /^@core\/(.*)/, replacement: path.resolve(__dirname, './source/core/$1') },
      { find: /^@adapters\/(.*)/, replacement: path.resolve(__dirname, './source/adapters/$1') },
      { find: /^@health\/(.*)/, replacement: path.resolve(__dirname, './source/health/$1') },
      { find: /^@retention\/(.*)/, replacement: path.resolve(__dirname, './source/retention/$1') },
    ],
  },
})
